package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTowoSubmissionWithoutFaceProcessing(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, test := range []struct {
		name     string
		status   int
		response string
		category FailureCategory
	}{
		{
			name:     "model channel unavailable",
			status:   http.StatusServiceUnavailable,
			response: `{"error":{"code":"model_not_found","message":"No available channel for model seedance-2.5 under group sd2.5: the model is claimed by a task plugin, which has no enabled channel serving it (distributor)"},"request_id":"request-towo-rejected"}`,
			category: CategoryModelMissing,
		},
		{
			name:     "unconfirmed server error",
			status:   http.StatusServiceUnavailable,
			response: `{"error":{"code":"server_error","message":"Service temporarily unavailable"}}`,
			category: CategorySubmissionUncertain,
		},
		{
			name:     "accepted original reference",
			status:   http.StatusOK,
			response: `{"id":"towo-original","status":"queued"}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			creates, polls, downloads := 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Error("Towo request lost authentication")
				}
				switch {
				case request.Method == http.MethodPost && request.URL.Path == "/v1/videos":
					creates++
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["model"] != "seedance-2.5" || body["seconds"] != float64(30) {
						t.Errorf("Towo model or duration changed: %#v", body)
					}
					for _, field := range []string{"face", "native_face", "videoSd2FaceMask"} {
						if _, exists := body[field]; exists {
							t.Errorf("Towo received an unsupported face parameter: %s", field)
						}
					}
					images, _ := body["reference_images"].([]any)
					if len(images) != 1 || images[0].(map[string]any)["image_url"] != "https://h.uguu.se/original.png" {
						t.Errorf("Towo lost the unprocessed reference: %#v", images)
					}
					writer.Header().Set("Content-Type", "application/json")
					writer.WriteHeader(test.status)
					_, _ = writer.Write([]byte(test.response))
				case request.Method == http.MethodGet && request.URL.Path == "/v1/videos/towo-original":
					polls++
					_, _ = writer.Write([]byte(`{"id":"towo-original","status":"completed"}`))
				case request.Method == http.MethodGet && request.URL.Path == "/v1/videos/towo-original/content":
					downloads++
					writer.Header().Set("Content-Type", "video/mp4")
					_, _ = writer.Write([]byte("original video"))
				default:
					t.Errorf("unexpected Towo request: %s %s", request.Method, request.URL.Path)
					writer.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			policy := DefaultVideoPollPolicy()
			policy.Sleep = func(context.Context, time.Duration) error { return nil }
			result, err := RunVideoTaskWithPolicy(context.Background(), Input{
				Mode: "video", Prompt: "a conversation",
				Config:          Config{BaseURL: server.URL, APIKey: "synthetic-key", InterfaceType: "towo-sd25-video", Model: "seedance-2.5", VideoSeconds: "30", Size: "16:9", VQuality: "720p"},
				ReferenceImages: []Media{{URL: "https://h.uguu.se/original.png"}},
			}, policy)
			if creates != 1 {
				t.Fatalf("submission was skipped or repeated: %d", creates)
			}
			if test.category != "" {
				failure := ClassifyError(err)
				if err == nil || failure.Category != test.category || failure.Uncertain != (test.category == CategorySubmissionUncertain) || polls != 0 || downloads != 0 {
					t.Fatalf("wrong rejection classification: failure=%#v polls=%d downloads=%d", failure, polls, downloads)
				}
				if test.category == CategoryModelMissing && (failure.ProviderCode != "model_not_found" || failure.RequestID != "request-towo-rejected") {
					t.Fatalf("upstream rejection details were lost: %#v", failure)
				}
				return
			}
			if err != nil || result == nil || polls != 1 || downloads != 1 {
				t.Fatalf("original-reference generation failed: err=%v polls=%d downloads=%d", err, polls, downloads)
			}
		})
	}
}
