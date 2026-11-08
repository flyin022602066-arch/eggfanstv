package asset

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRetrieveSunoMediaStoresOriginalAndReplaysWithoutDownload(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, repo, _ := newTestDomain(t)
	database, _ := repo.DB().DB()
	t.Cleanup(func() { _ = database.Close() })
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" || request.Header.Get("X-Desktop-Token") != "" {
			t.Error("credentials forwarded to media server")
		}
		writer.Header().Set("Content-Type", "application/octet-stream")
		_, _ = writer.Write([]byte("RIFF0000WAVEfmt original audio"))
	}))
	defer server.Close()
	request := SunoMediaRequest{Identity: "creation-result", URL: server.URL + "/song?signature=private-fixture", ClipID: "clip-a", Kind: "audio", DurationMs: 247000}
	first, err := svc.RetrieveSunoMedia(context.Background(), "owner", request, 1024)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.RetrieveSunoMedia(context.Background(), "owner", request, 1024)
	if err != nil || first.ID != second.ID || calls != 1 || first.MimeType != "audio/wav" || first.DurationMs != 247000 {
		t.Fatalf("replay=%#v err=%v calls=%d", second, err, calls)
	}
	request.Identity = "wav-result"
	wav, err := svc.RetrieveSunoMedia(context.Background(), "owner", request, 1024)
	if err != nil || wav.ID == first.ID || calls != 2 {
		t.Fatalf("result variants collided: %v", err)
	}
	other, err := svc.RetrieveSunoMedia(context.Background(), "other-owner", request, 1024)
	if err != nil || other.ID == first.ID || calls != 3 {
		t.Fatalf("owner isolation failed: %v", err)
	}
}

func TestRetrieveSunoMediaRejectsErrorsOversizeAndPrivateTargets(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, repo, _ := newTestDomain(t)
	database, _ := repo.DB().DB()
	t.Cleanup(func() { _ = database.Close() })
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/json":
			writer.Header().Set("Content-Type", "audio/mpeg")
			_, _ = writer.Write([]byte("{\"error\":\"unavailable\"}"))
		case "/large":
			_, _ = writer.Write([]byte("ID3" + strings.Repeat("x", 100)))
		case "/redirect":
			http.Redirect(writer, request, "http://192.168.1.10/private", http.StatusFound)
		default:
			writer.WriteHeader(http.StatusForbidden)
		}
	}))
	defer server.Close()
	for _, name := range []string{"json", "large", "expired", "redirect"} {
		_, err := svc.RetrieveSunoMedia(context.Background(), "owner", SunoMediaRequest{Identity: name, URL: server.URL + "/" + name + "?secret=not-for-logs", ClipID: name, Kind: "audio"}, 32)
		if err == nil {
			t.Errorf("%s accepted invalid media", name)
		} else if strings.Contains(err.Error(), "not-for-logs") || strings.Contains(err.Error(), server.URL) {
			t.Errorf("%s leaked media URL", name)
		}
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	_, err := svc.RetrieveSunoMedia(context.Background(), "owner", SunoMediaRequest{Identity: "private", URL: "http://127.0.0.1/song", ClipID: "private", Kind: "audio"}, 1024)
	if err == nil {
		t.Fatal("private target allowed")
	}
	resources, _ := svc.Resources("owner", 100)
	if len(resources) != 0 {
		t.Fatalf("invalid media persisted: %d", len(resources))
	}
}
