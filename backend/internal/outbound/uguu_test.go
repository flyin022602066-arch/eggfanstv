package outbound

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type uguuTestTransport func(*http.Request) (*http.Response, error)

func (transport uguuTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func uguuTestPNG(t *testing.T) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func uguuTestResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestUguuLargeUploadsHaveDedicatedTimeout(t *testing.T) {
	host := NewUguuImageHost(nil)
	if host.client.Timeout != 15*time.Minute {
		t.Fatalf("upload timeout = %s, want 15m", host.client.Timeout)
	}
}

func TestUguuRetriesTransientUploadsWithoutChangingBytes(t *testing.T) {
	for _, transient := range []string{"timeout", "eof", "http503"} {
		t.Run(transient, func(t *testing.T) {
			data := uguuTestPNG(t)
			calls := 0
			host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				reader, err := request.MultipartReader()
				if err != nil {
					t.Fatal(err)
				}
				part, err := reader.NextPart()
				if err != nil {
					t.Fatal(err)
				}
				actual, err := io.ReadAll(part)
				if err != nil || !bytes.Equal(actual, data) {
					t.Fatal("retry changed reference bytes")
				}
				if calls == 1 {
					switch transient {
					case "timeout":
						return nil, context.DeadlineExceeded
					case "eof":
						return nil, io.ErrUnexpectedEOF
					default:
						return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: io.NopCloser(strings.NewReader("unavailable")), Header: make(http.Header)}, nil
					}
				}
				return uguuTestResponse(`{"success":true,"files":[{"url":"https://h.uguu.se/retried.png"}]}`), nil
			})})
			result, err := host.Upload(context.Background(), "owner", data)
			if err != nil || calls != 2 || result.URL != "https://h.uguu.se/retried.png" {
				t.Fatalf("transient upload did not recover: calls=%d result=%#v err=%v", calls, result, err)
			}
		})
	}
}

func TestUguuDoesNotRetryRejectedOrCancelledUploads(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusForbidden, http.StatusRequestEntityTooLarge} {
		calls := 0
		host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("rejected")), Header: make(http.Header)}, nil
		})})
		if _, err := host.Upload(context.Background(), "owner", uguuTestPNG(t)); err == nil || calls != 1 {
			t.Fatalf("HTTP %d: calls=%d err=%v", status, calls, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		cancel()
		return nil, context.DeadlineExceeded
	})})
	if _, err := host.Upload(ctx, "owner", uguuTestPNG(t)); !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("cancelled upload retried: calls=%d err=%v", calls, err)
	}
}

func TestUguuUploadsRealMultipartAndCachesByUserAndContents(t *testing.T) {
	data := uguuTestPNG(t)
	var calls atomic.Int32
	host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodGet {
			return uguuTestResponse("image byte"), nil
		}
		calls.Add(1)
		if request.URL.String() != "https://uguu.se/upload" || request.Method != http.MethodPost {
			t.Fatal("unexpected upload endpoint")
		}
		for _, header := range []string{"Authorization", "Cookie", "X-Desktop-Token", "X-Canvas-Upstream-Headers"} {
			if request.Header.Get(header) != "" {
				t.Fatalf("credentials leaked through %s", header)
			}
		}
		reader, err := request.MultipartReader()
		if err != nil {
			t.Fatal(err)
		}
		part, err := reader.NextPart()
		if err != nil || part.FormName() != "files[]" || part.FileName() != "reference.png" {
			t.Fatal("invalid Uguu multipart file")
		}
		actual, err := io.ReadAll(part)
		if err != nil || !bytes.Equal(actual, data) {
			t.Fatal("image bytes were changed")
		}
		return uguuTestResponse(`{"success":true,"files":[{"url":"https://h.uguu.se/reference.png"}]}`), nil
	})})
	var workers sync.WaitGroup
	for index := 0; index < 8; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			result, err := host.Upload(context.Background(), "user-1", data)
			if err != nil || result.URL != "https://h.uguu.se/reference.png" || result.UploadedAt.IsZero() || result.ExpiresAt.Sub(result.UploadedAt) != 3*time.Hour {
				t.Errorf("upload failed: %v", err)
			}
		}()
	}
	workers.Wait()
	if calls.Load() != 1 {
		t.Fatal("concurrent identical images were uploaded repeatedly")
	}
	first, err := host.Upload(context.Background(), "user-1", data)
	if err != nil {
		t.Fatal(err)
	}
	again, err := host.Upload(context.Background(), "user-1", data)
	if err != nil || first != again || calls.Load() != 1 {
		t.Fatal("cache reuse extended the original URL expiry or uploaded again")
	}
	if _, err := host.Upload(context.Background(), "user-2", data); err != nil || calls.Load() != 2 {
		t.Fatal("image cache crossed user scopes")
	}
	host.mu.Lock()
	for _, cached := range host.uploads {
		cached.expiresAt = time.Now().Add(-time.Second)
	}
	host.mu.Unlock()
	if _, err := host.Upload(context.Background(), "user-1", data); err != nil || calls.Load() != 3 {
		t.Fatal("expired temporary URL was reused")
	}
}

func TestUguuRejectsInvalidResponsesAndDoesNotCacheFailures(t *testing.T) {
	for _, body := range []string{
		`{"success":false,"files":[]}`,
		`{"success":true,"files":[]}`,
		`{"success":true,"files":[{"url":"http://h.uguu.se/image.png"}]}`,
		`{"success":true,"files":[{"url":"https://127.0.0.1/image.png"}]}`,
		`{"success":true,"files":[{"url":"https://uguu.se.attacker.example/image.png"}]}`,
		`{"success":true,"files":[{"url":"https://secret@h.uguu.se/image.png"}]}`,
		`<html>gateway unavailable</html>`,
		strings.Repeat("x", (64<<10)+1),
	} {
		t.Run(fmtTestName(body), func(t *testing.T) {
			attempts := 0
			host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(_ *http.Request) (*http.Response, error) {
				attempts++
				return uguuTestResponse(body), nil
			})})
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := host.Upload(context.Background(), "user-1", uguuTestPNG(t)); err == nil {
					t.Fatal("invalid upload response accepted")
				}
			}
			if attempts != 2 {
				t.Fatal("failed upload was cached")
			}
		})
	}
}

func TestUguuReuploadsCachedURLDeletedBeforeExpiry(t *testing.T) {
	uploads := 0
	checks := 0
	host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodGet {
			checks++
			if request.Header.Get("Range") != "bytes=0-0" || request.Header.Get("Authorization") != "" {
				t.Error("URL check did not isolate credentials or limit download")
			}
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("deleted")), Header: make(http.Header)}, nil
		}
		uploads++
		url := "https://h.uguu.se/old.png"
		if uploads > 1 {
			url = "https://h.uguu.se/new.png"
		}
		return uguuTestResponse(`{"success":true,"files":[{"url":"` + url + `"}]}`), nil
	})})
	first, err := host.Upload(context.Background(), "owner", uguuTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	latest, err := host.Upload(context.Background(), "owner", uguuTestPNG(t))
	if err != nil || latest.URL == first.URL || uploads != 2 || checks == 0 {
		t.Fatalf("deleted cached URL reused: uploads=%d checks=%d latest=%#v err=%v", uploads, checks, latest, err)
	}
}

func fmtTestName(body string) string {
	if len(body) > 100 {
		return "oversized"
	}
	return body
}

func TestUguuValidatesFilesAndPreservesCancellation(t *testing.T) {
	host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})})
	for _, data := range [][]byte{nil, []byte("not an image"), make([]byte, MaxTemporaryImageBytes+1)} {
		if _, err := host.Upload(context.Background(), "user-1", data); err == nil {
			t.Fatal("invalid image accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	host.client.Transport = uguuTestTransport(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	completed := make(chan error, 1)
	go func() { _, err := host.Upload(ctx, "user-1", uguuTestPNG(t)); completed <- err }()
	<-started
	cancel()
	if err := <-completed; !errors.Is(err, context.Canceled) {
		t.Fatalf("upload lost cancellation: %v", err)
	}
}

func TestUguuMediaMultipartAndLimits(t *testing.T) {
	for _, file := range []struct{ mimeType, filename string }{{"video/mp4", "reference.mp4"}, {"audio/mpeg", "reference.mp3"}, {"audio/wav", "reference.wav"}} {
		t.Run(file.mimeType, func(t *testing.T) {
			data := []byte("mock media bytes " + file.mimeType)
			calls := 0
			host := NewUguuImageHost(&http.Client{Transport: uguuTestTransport(func(request *http.Request) (*http.Response, error) {
				if request.Method == http.MethodGet {
					return uguuTestResponse("media byte"), nil
				}
				calls++
				reader, err := request.MultipartReader()
				if err != nil {
					t.Fatal(err)
				}
				part, err := reader.NextPart()
				if err != nil || part.FormName() != "files[]" || part.FileName() != file.filename {
					t.Fatal("wrong media multipart")
				}
				actual, err := io.ReadAll(part)
				if err != nil || !bytes.Equal(actual, data) || request.Header.Get("Authorization") != "" {
					t.Fatal("media bytes or credential isolation changed")
				}
				return uguuTestResponse(`{"success":true,"files":[{"url":"https://h.uguu.se/media.mp4"}]}`), nil
			})})
			for attempt := 0; attempt < 2; attempt++ {
				if _, err := host.UploadMedia(context.Background(), "owner", data, file.mimeType); err != nil {
					t.Fatal(err)
				}
			}
			if calls != 1 {
				t.Fatal("media upload was not reused")
			}
			for _, invalid := range []struct {
				data     []byte
				mimeType string
			}{{nil, file.mimeType}, {data, "text/plain"}, {make([]byte, MaxTemporaryMediaBytes+1), file.mimeType}} {
				if _, err := host.UploadMedia(context.Background(), "owner", invalid.data, invalid.mimeType); err == nil {
					t.Fatal("invalid file accepted")
				}
			}
			if calls != 1 {
				t.Fatal("invalid file reached network")
			}
		})
	}
}
