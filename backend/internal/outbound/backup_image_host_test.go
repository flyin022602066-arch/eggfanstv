package outbound

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type failoverTestHost struct {
	mu     sync.Mutex
	result TemporaryImageURL
	err    error
	calls  int
	data   []byte
}

func (host *failoverTestHost) Upload(ctx context.Context, _ string, data []byte) (TemporaryImageURL, error) {
	host.mu.Lock()
	defer host.mu.Unlock()
	host.calls++
	host.data = append([]byte(nil), data...)
	return host.result, host.err
}
func (host *failoverTestHost) URLAvailable(context.Context, string) (bool, error) {
	return host.err == nil, host.err
}
func (host *failoverTestHost) InvalidateURL(string)           {}
func (host *failoverTestHost) AcceptsURL(address string) bool { return host.result.URL == address }

func TestImageFailoverOriginalOrderAndDeduplication(t *testing.T) {
	data := uguuTestPNG(t)
	now := time.Now().UTC()
	primary := &failoverTestHost{result: TemporaryImageURL{URL: "https://h.uguu.se/primary.png", UploadedAt: now, ExpiresAt: now.Add(time.Hour)}}
	pone := &failoverTestHost{result: TemporaryImageURL{URL: "https://u.pone.rs/reference.png", UploadedAt: now, ExpiresAt: now.Add(time.Hour)}}
	leopard := &failoverTestHost{result: TemporaryImageURL{URL: "https://leopard.hosting.pecon.us/dl/abc/reference.png", UploadedAt: now, ExpiresAt: now.Add(time.Hour)}}
	host := NewImageFailoverHost(primary, pone, leopard)
	result, err := host.Upload(context.Background(), "owner", data)
	if err != nil || result.URL != primary.result.URL || pone.calls != 0 || leopard.calls != 0 {
		t.Fatalf("primary preference changed: %+v %v", result, err)
	}
	host.InvalidateURL(result.URL)
	primary.err = temporaryUploadHTTPError{status: 502}
	pone.err = errors.New("Pone HTTP 503")
	var workers sync.WaitGroup
	for index := 0; index < 8; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			result, err := host.Upload(context.Background(), "owner", data)
			if err != nil || result.URL != leopard.result.URL {
				t.Errorf("fallback failed: %+v %v", result, err)
			}
		}()
	}
	workers.Wait()
	if pone.calls != 1 || leopard.calls != 1 || !bytes.Equal(data, leopard.data) {
		t.Fatalf("original or dedup broken: %d/%d", pone.calls, leopard.calls)
	}
}

func TestImageFailoverDoesNotBypassCancellationOrRejection(t *testing.T) {
	for _, failure := range []error{context.Canceled, temporaryUploadHTTPError{status: 400}, errors.New("invalid image")} {
		primary := &failoverTestHost{err: failure}
		backup := &failoverTestHost{}
		_, err := NewImageFailoverHost(primary, backup).Upload(context.Background(), "owner", uguuTestPNG(t))
		if !errors.Is(err, failure) || backup.calls != 0 {
			t.Fatalf("non-transient failure bypassed: %v", err)
		}
	}
}

func TestBackupImageHostsNativeMultipartAndDirectLink(t *testing.T) {
	data := uguuTestPNG(t)
	for _, name := range []string{"pone", "leopard"} {
		t.Run(name, func(t *testing.T) {
			address := "https://u.pone.rs/reference.png"
			endpoint := "https://pone.rs/upload"
			field := "files[]"
			payload := `{"success":true,"files":[{"url":"` + address + `"}]}`
			if name == "leopard" {
				address = "https://leopard.hosting.pecon.us/dl/abc/reference.png"
				endpoint = "https://leopard.hosting.pecon.us/upload.php"
				field = "uploadContent"
				payload = `{"upload":{"downloadURL":"` + address + `","deleteURL":"secret"}}`
			}
			client := &http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
				for _, header := range []string{"Authorization", "Cookie", "X-Desktop-Token", "X-Canvas-Upstream-Headers"} {
					if request.Header.Get(header) != "" {
						t.Fatalf("credential leaked: %s", header)
					}
				}
				if request.Method == http.MethodGet {
					if request.URL.String() != address || request.Header.Get("Range") != "bytes=0-511" {
						t.Fatal("wrong direct-link check")
					}
					response := uguuTestResponse(string(data))
					response.Header.Set("Content-Type", "image/png")
					return response, nil
				}
				if request.URL.String() != endpoint {
					t.Fatalf("wrong endpoint: %s", request.URL)
				}
				if err := request.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				uploaded, _, err := request.FormFile(field)
				if err != nil {
					t.Fatal(err)
				}
				defer uploaded.Close()
				actual, _ := io.ReadAll(uploaded)
				if !bytes.Equal(data, actual) {
					t.Fatal("original image changed")
				}
				if name == "leopard" && (request.FormValue("public") != "no" || request.FormValue("json") != "true") {
					t.Fatal("privacy/json fields missing")
				}
				return uguuTestResponse(payload), nil
			})}
			host := NewPoneImageHost(client)
			if name == "leopard" {
				host = NewLeopardImageHost(client)
			}
			result, err := host.Upload(context.Background(), "owner", data)
			if err != nil || result.URL != address || result.ExpiresAt.Sub(result.UploadedAt) != 24*time.Hour {
				t.Fatalf("invalid result: %+v %v", result, err)
			}
		})
	}
}

func TestBackupImageHostRejectsHTMLAndUnsafeURLs(t *testing.T) {
	for _, address := range []string{"https://u.pone.rs.attacker.example/a.png", "http://u.pone.rs/a.png", "https://secret@u.pone.rs/a.png", "https://u.pone.rs/", "https://u.pone.rs/a.png?token=secret", "https://leopard.hosting.pecon.us/upload.php", "https://u.pone.rs:444/a.png", "https://u.pone.rs/a.png#secret", "https://127.0.0.1/a.png"} {
		if IsBackupImageURL(address) {
			t.Fatalf("unsafe URL accepted: %s", address)
		}
	}
	host := NewPoneImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodPost {
			return uguuTestResponse(`{"success":true,"files":[{"url":"https://u.pone.rs/a.png"}]}`), nil
		}
		response := uguuTestResponse("<html>download page</html>")
		response.Header.Set("Content-Type", "text/html")
		return response, nil
	})})
	if _, err := host.Upload(context.Background(), "owner", uguuTestPNG(t)); err == nil {
		t.Fatal("download page accepted as original image")
	}
}

func TestImageFailoverPreservesFailureDetails(t *testing.T) {
	primary := &failoverTestHost{err: temporaryUploadHTTPError{status: 502}}
	host := NewImageFailoverHost(primary, &failoverTestHost{err: errors.New("Pone HTTP 503")}, &failoverTestHost{err: errors.New("Leopard HTTP 504")})
	if ready, err := host.URLAvailable(context.Background(), "https://h.uguu.se/old.png"); err != nil || ready {
		t.Fatalf("transient error blocked refresh: %v %v", ready, err)
	}
	_, err := host.Upload(context.Background(), "owner", uguuTestPNG(t))
	for _, expected := range []string{"502", "503", "504", "视频请求尚未发送"} {
		if err == nil || !strings.Contains(err.Error(), expected) {
			t.Fatalf("missing failure %s: %v", expected, err)
		}
	}
}
