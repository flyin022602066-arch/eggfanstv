package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type nonoConcurrentReferencePort struct {
	started chan string
	release chan struct{}
	fail    string
	active  atomic.Int32
}

func (*nonoConcurrentReferencePort) Prepare(context.Context, string, *Input) (bool, error) {
	return false, nil
}

func (*nonoConcurrentReferencePort) CompressJiasu(context.Context, string, *Input) (bool, error) {
	return false, nil
}

func (port *nonoConcurrentReferencePort) Upload(ctx context.Context, _ string, media *Media) error {
	port.active.Add(1)
	defer port.active.Add(-1)
	port.started <- media.ID
	if media.ID == port.fail {
		return errors.New("synthetic Uguu upload failure")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-port.release:
		media.URL = "https://h.uguu.se/" + media.ID + ".png"
		media.DataURL = ""
		return nil
	}
}

func TestNonoReferencesUploadConcurrentlyAndPreserveOrder(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	port := &nonoConcurrentReferencePort{started: make(chan string, 9), release: make(chan struct{})}
	ctx = WithRuntime(ctx, Runtime{References: port})
	input := Input{Mode: "video", Config: Config{InterfaceType: "nono-video"}}
	for index := 0; index < 9; index++ {
		input.ReferenceImages = append(input.ReferenceImages, Media{ID: fmt.Sprint(index), DataURL: "data:image/png;base64,YQ=="})
	}
	done := make(chan error, 1)
	go func() { done <- HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input)) }()
	started := 0
	for started < 9 {
		select {
		case <-port.started:
			started++
		case <-ctx.Done():
			<-done
			t.Fatalf("uploads were serialized or limited: started=%d", started)
		}
	}
	close(port.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	for index, media := range input.ReferenceImages {
		if media.URL != fmt.Sprintf("https://h.uguu.se/%d.png", index) || media.DataURL != "" {
			t.Fatalf("reference order changed: %+v", input.ReferenceImages)
		}
	}
}

func TestNonoReferenceUploadFailureCancelsAndJoinsOtherUploads(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	port := &nonoConcurrentReferencePort{started: make(chan string, 3), release: make(chan struct{}), fail: "broken"}
	ctx = WithRuntime(ctx, Runtime{References: port})
	input := Input{Mode: "video", Config: Config{InterfaceType: "nono-video"}, ReferenceImages: []Media{{ID: "first"}, {ID: "broken"}, {ID: "last"}}}
	err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input))
	if err == nil || !strings.Contains(err.Error(), "synthetic Uguu upload failure") || port.active.Load() != 0 {
		t.Fatalf("upload failure was hidden or left background work: %v active=%d", err, port.active.Load())
	}
}

func TestNonoExecuteUploadsBeforeCreatingVideoAndStopsOnUploadError(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, modelName := range []string{"按条特惠seedance-2.5-720P 满血", "按条福利seedance-2.5-720P", "按条seedance-2.5-720P 只支持参考图"} {
		t.Run(modelName, func(t *testing.T) {
			var creates atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				switch {
				case request.Method == http.MethodPost && request.URL.Path == "/prod-api/v1/videos":
					creates.Add(1)
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					params, _ := body["params"].(map[string]any)
					if body["reference_mode"] != "omni" {
						t.Errorf("missing reference mode: %#v", body)
					}
					images, _ := body["image_urls"].([]any)
					if len(images) != 2 || images[0] != "https://h.uguu.se/first.png" || images[1] != "https://h.uguu.se/second.png" || body["model"] != modelName || body["prompt"] != "user edited prompt" || params["duration"] != float64(30) || params["ratio"] != "9:16" {
						t.Errorf("upload order or original request changed: %#v", body)
					}
					for _, key := range []string{"face", "native_face", "generate_audio", "reference_images", "content"} {
						if _, found := body[key]; found {
							t.Errorf("foreign channel parameter: %s", key)
						}
					}
					_, _ = writer.Write([]byte(`{"id":"original-task","status":"queued"}`))
				case request.Method == http.MethodGet && request.URL.Path == "/prod-api/v1/videos/original-task":
					_, _ = writer.Write([]byte(`{"id":"original-task","status":"failed","error":{"message":"synthetic terminal result"}}`))
				default:
					t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
					writer.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			port := &nonoConcurrentReferencePort{started: make(chan string, 4), release: make(chan struct{})}
			close(port.release)
			ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) { runtime.References = port }))
			input := Input{Mode: "video", Prompt: "user edited prompt", Config: Config{InterfaceType: "nono-video", BaseURL: server.URL + "/prod-api/v1", APIKey: "synthetic-key", Model: modelName, VideoSeconds: "30", Size: "9:16", VQuality: "720p"}, ReferenceImages: []Media{{ID: "first", DataURL: "data:image/png;base64,YQ=="}, {ID: "second", DataURL: "data:image/png;base64,Yg=="}}}
			_, err := Execute(ctx, input)
			if err == nil || !strings.Contains(err.Error(), "synthetic terminal result") || creates.Load() != 1 {
				t.Fatalf("uploaded references did not reach video creation: %v creates=%d", err, creates.Load())
			}
			port.fail = "second"
			_, err = Execute(ctx, input)
			if err == nil || !strings.Contains(err.Error(), "synthetic Uguu upload failure") || creates.Load() != 1 {
				t.Fatalf("upload failure submitted a video: %v creates=%d", err, creates.Load())
			}
		})
	}
}
