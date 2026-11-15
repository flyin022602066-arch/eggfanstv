package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestKanhaiAndNonoSubmitPollDownloadAndResume(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, protocolID := range []string{"kanhai-video", "nono-video"} {
		t.Run(protocolID, func(t *testing.T) {
			creates, polls, downloads := 0, 0, 0
			prefix, modelName := "/openapi/v1", "vs-sd 2.5-a"
			if protocolID == "nono-video" {
				prefix, modelName = "/prod-api/v1", "按条特惠seedance-2.5-720P 满血"
			}
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != "/signed-result.mp4" && request.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Error("lost site authentication")
				}
				switch {
				case request.Method == "POST" && request.URL.Path == prefix+"/videos":
					creates++
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["model"] != modelName || body["prompt"] != "final edited prompt" {
						t.Errorf("identity/prompt changed: %#v", body)
					}
					for _, field := range []string{"face", "native_face", "generate_audio", "seconds", "reference_images", "content"} {
						if _, exists := body[field]; exists {
							t.Errorf("foreign field %s", field)
						}
					}
					if protocolID == "nono-video" {
						params, _ := body["params"].(map[string]any)
						if body["reference_mode"] != "omni" {
							t.Errorf("wrong nono reference mode: %#v", body["reference_mode"])
						}
						if body["spec"] != "720p" || body["count"] != float64(1) || params["duration"] != float64(30) || params["ratio"] != "16:9" || params["resolution"] != "720p" {
							t.Errorf("wrong nono params: %#v", body)
						}
					} else {
						if _, exists := body["reference_mode"]; exists {
							t.Error("nono reference mode leaked into Kanhai")
						}
						if body["duration"] != float64(30) || request.Header.Get("Idempotency-Key") != "stable-synthetic-task" {
							t.Errorf("wrong Kanhai params: %#v", body)
						}
					}
					images, _ := body["image_urls"].([]any)
					if len(images) != 2 || images[0] != "https://h.uguu.se/first.png" || images[1] != "https://h.uguu.se/second.png" {
						t.Errorf("reference order: %#v", images)
					}
					writer.WriteHeader(http.StatusAccepted)
					_, _ = writer.Write([]byte(`{"id":"site-task","task_id":"site-task","upstream_task_id":"never-query-this","status":"queued"}`))
				case request.Method == "GET" && request.URL.Path == prefix+"/videos/site-task":
					polls++
					if polls == 1 {
						_, _ = writer.Write([]byte(`{"id":"site-task","status":"in_progress"}`))
						return
					}
					if protocolID == "nono-video" {
						_ = json.NewEncoder(writer).Encode(map[string]any{"id": "site-task", "status": "completed", "results": []any{map[string]any{"type": "VIDEO", "url": server.URL + "/signed-result.mp4?signature=a%2Bb"}}})
						return
					}
					_, _ = writer.Write([]byte(`{"id":"site-task","status":"completed"}`))
				case request.Method == "GET" && request.URL.Path == prefix+"/videos/site-task/content":
					http.Redirect(writer, request, server.URL+"/signed-result.mp4?signature=a%2Bb", http.StatusTemporaryRedirect)
				case request.Method == "GET" && request.URL.Path == "/signed-result.mp4":
					downloads++
					if request.URL.Query().Get("signature") != "a+b" {
						t.Error("signed URL modified")
					}
					writer.Header().Set("Content-Type", "video/mp4")
					_, _ = writer.Write([]byte("synthetic mp4 result"))
				default:
					t.Errorf("wrong endpoint %s %s", request.Method, request.URL.Path)
					writer.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			input := Input{Mode: "video", Prompt: "final edited prompt", Config: Config{BaseURL: server.URL + prefix, APIKey: "synthetic-key", InterfaceType: protocolID, Model: modelName, VideoSeconds: "30", Size: "16:9", VQuality: "720p"}, ReferenceImages: []Media{{URL: "https://h.uguu.se/first.png"}, {URL: "https://h.uguu.se/second.png"}}}
			policy := DefaultVideoPollPolicy()
			policy.Sleep = func(context.Context, time.Duration) error { return nil }
			ctx := WithSubmissionKey(context.Background(), "stable-synthetic-task")
			result, err := RunVideoTaskWithPolicy(ctx, input, policy)
			if err != nil || result == nil || creates != 1 || polls != 2 || downloads != 1 {
				t.Fatalf("create/poll/download: err=%v creates=%d polls=%d downloads=%d", err, creates, polls, downloads)
			}
			ctx = WithCallMeta(ctx, CallMeta{ProviderRequestID: "site-task"})
			result, err = RunVideoTaskWithPolicy(ctx, input, policy)
			if err != nil || result == nil || creates != 1 || downloads != 2 {
				t.Fatalf("resume recreated task or lost result: %v creates=%d downloads=%d", err, creates, downloads)
			}
			mediaPolicy := MediaHydrationPolicyFor(ctx, input)
			if !mediaPolicy.RequireURL || !mediaPolicy.PublicOnly {
				t.Fatal("local assets bypassed public upload")
			}
		})
	}
}
