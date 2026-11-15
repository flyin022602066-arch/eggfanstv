package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNonoNineImageReferenceModeAndUpstreamRejection(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, modelName := range []string{"按条特惠seedance-2.5-720P 满血", "按条福利seedance-2.5-720P", "按条seedance-2.5-720P 只支持参考图"} {
		for _, reject := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/reject=%t", modelName, reject), func(t *testing.T) {
				creates, polls, downloads := 0, 0, 0
				prompt := strings.Repeat("原始提示词", 360)
				images := make([]Media, 9)
				for index := range images {
					images[index] = Media{URL: fmt.Sprintf("https://h.uguu.se/original-%d.png", index), Width: 3840, Height: 2160, Bytes: 11 * 1024 * 1024}
				}
				var server *httptest.Server
				server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					writer.Header().Set("Content-Type", "application/json")
					switch request.URL.Path {
					case "/prod-api/v1/videos":
						creates++
						if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer synthetic-key" {
							t.Error("nono submission method or credentials changed")
						}
						var body map[string]any
						if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
							t.Error(err)
						}
						params, _ := body["params"].(map[string]any)
						if body["model"] != modelName || body["prompt"] != prompt || body["spec"] != "720p" || body["count"] != float64(1) || params["duration"] != float64(30) || params["ratio"] != "16:9" || params["resolution"] != "720p" {
							t.Error("original nono model, prompt, or generation settings changed")
						}
						urls, _ := body["image_urls"].([]any)
						if len(urls) != len(images) {
							t.Errorf("image references truncated or duplicated: %d", len(urls))
						} else {
							for index, media := range images {
								if urls[index] != media.URL {
									t.Errorf("original image %d changed or reordered", index)
								}
							}
						}
						for _, field := range []string{"face", "native_face", "generate_audio", "reference_images", "content", "referenceMode"} {
							if _, exists := body[field]; exists {
								t.Errorf("unexpected parameter %s", field)
							}
						}
						if body["reference_mode"] != "omni" {
							t.Errorf("nine references used %v instead of omni", body["reference_mode"])
						}
						if reject || body["reference_mode"] != "omni" {
							writer.WriteHeader(http.StatusBadRequest)
							_, _ = writer.Write([]byte(`{"error":{"code":"invalid_request","message":"所选素材用途的 IMAGE 数量超出上限"}}`))
							return
						}
						_, _ = writer.Write([]byte(`{"id":"nono-original-task","status":"queued"}`))
					case "/prod-api/v1/videos/nono-original-task":
						polls++
						_ = json.NewEncoder(writer).Encode(map[string]any{"id": "nono-original-task", "status": "completed", "results": []any{map[string]any{"url": server.URL + "/result.mp4", "type": "VIDEO"}}})
					case "/result.mp4":
						downloads++
						writer.Header().Set("Content-Type", "video/mp4")
						_, _ = writer.Write([]byte("synthetic video"))
					default:
						t.Errorf("unexpected endpoint %s", request.URL.Path)
						writer.WriteHeader(http.StatusNotFound)
					}
				}))
				defer server.Close()
				input := Input{Mode: "video", Prompt: prompt, ReferenceImages: images, Config: Config{InterfaceType: "nono-video", Model: modelName, APIKey: "synthetic-key", BaseURL: server.URL + "/prod-api/v1", VideoSeconds: "30", Size: "16:9", VQuality: "720p"}}
				policy := DefaultVideoPollPolicy()
				policy.Sleep = func(context.Context, time.Duration) error { return nil }
				result, err := RunVideoTaskWithPolicy(context.Background(), input, policy)
				if creates != 1 {
					t.Fatalf("submission retried: %d creates", creates)
				}
				if reject {
					failure := ClassifyError(err)
					if err == nil || failure.ProviderMessage != "所选素材用途的 IMAGE 数量超出上限" || failure.ProviderCode != "invalid_request" || failure.HTTPStatus != http.StatusBadRequest || polls != 0 || downloads != 0 {
						t.Fatalf("upstream rejection hidden or resubmitted: %v polls=%d downloads=%d", err, polls, downloads)
					}
				} else if err != nil || result == nil || polls != 1 || downloads != 1 {
					t.Fatalf("nine-image reference request failed: %v polls=%d downloads=%d", err, polls, downloads)
				}
			})
		}
	}
}
