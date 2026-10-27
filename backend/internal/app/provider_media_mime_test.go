package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func jiasuMP4DownloadFixture() []byte {
	clip := syntheticVideoMP4(1280, 720, 5042)
	header := mp4Box("ftyp", []byte("isom\x00\x00\x02\x00isomiso2avc1mp41"))
	return append(header, clip[16:]...)
}

func TestNormalizedMediaMimeTypeDetectsGenericBinaryVideo(t *testing.T) {
	clip := jiasuMP4DownloadFixture()
	for _, declared := range []string{"", "application/octet-stream", "binary/octet-stream", "Binary/Octet-Stream; charset=UTF-8"} {
		t.Run(declared, func(t *testing.T) {
			if actual := normalizedMediaMimeType(declared, clip); actual != "video/mp4" {
				t.Fatalf("normalized MIME = %q, want video/mp4", actual)
			}
		})
	}
	if actual := normalizedMediaMimeType("video/webm", clip); actual != "video/webm" {
		t.Fatalf("specific media MIME changed: %q", actual)
	}
	if actual := normalizedMediaMimeType("binary/octet-stream", make([]byte, 64)); actual != "application/octet-stream" {
		t.Fatalf("unknown binary was assigned a media type: %q", actual)
	}
}

func TestJiasuExtensionlessVideoDownloadPersistsMP4(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	clip := jiasuMP4DownloadFixture()
	query := "mime_type=video_mp4&token=synthetic%2Fsignature&cd=0%7C1"
	for _, declared := range []string{"binary/octet-stream", "application/octet-stream", "video/mp4"} {
		t.Run(declared, func(t *testing.T) {
			cdn := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != "/video/unsigned-name/" || request.URL.RawQuery != query {
					t.Error("signed result URL was changed to add an extension")
				}
				if request.Header.Get("Authorization") != "" {
					t.Error("channel credentials leaked to CDN")
				}
				writer.Header().Set("Content-Type", declared)
				_, _ = writer.Write(clip)
			}))
			defer cdn.Close()
			adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
			body, err := json.Marshal(map[string]any{"id": "existing-task", "status": "completed", "result_urls": []string{cdn.URL + "/video/unsigned-name/?" + query}})
			if err != nil {
				t.Fatal(err)
			}
			state, err := adapter.ParsePoll(context.Background(), protocol.PollContext{TaskID: "existing-task"}, body)
			if err != nil {
				t.Fatal(err)
			}
			result, err := finishProtocolResult(context.Background(), providerConfig{BaseURL: "https://provider.example", APIKey: "synthetic-key"}, "video", "existing-task", state.Result, defaultVideoPollPolicy())
			if err != nil {
				t.Fatal(err)
			}
			video := result["video"].(map[string]any)
			if video["mimeType"] != "video/mp4" || !strings.HasPrefix(stringField(video, "dataUrl"), "data:video/mp4;base64,") {
				t.Fatalf("downloaded MIME = %v, want video/mp4", video["mimeType"])
			}
			svc := newResourceTestService(t)
			svc.localResourceStorage = true
			stored, err := svc.persistGeneratedMediaResult("user-1", result)
			if err != nil {
				t.Fatal(err)
			}
			video = stored["video"].(map[string]any)
			resourceID := strings.TrimPrefix(stringField(video, "storageKey"), "resource:")
			resource, err := svc.repo.ResourceForUser("user-1", resourceID)
			if err != nil {
				t.Fatal(err)
			}
			if resource.Kind != "video" || resource.MimeType != "video/mp4" || filepath.Ext(resource.ObjectKey) != ".mp4" {
				t.Fatalf("stored media type/extension = %q, %q, %q", resource.Kind, resource.MimeType, filepath.Ext(resource.ObjectKey))
			}
			data, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
			if err != nil || !bytes.Equal(data, clip) {
				t.Fatalf("stored video bytes changed: %v", err)
			}
		})
	}
}
