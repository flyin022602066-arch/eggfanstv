package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/protocol"
)

func TestJiasuWanPackagedSubmitPollAndRetrieve(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "jiasu-video.beeftv-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("packaged adapters=%d error=%v", len(adapters), err)
	}
	creates, polls, downloads := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "POST /v1/video/generations":
			creates++
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["model"] != "wan3-特惠" || body["duration"] != float64(30) || body["resolution"] != "1080p" || body["ratio"] != "9:16" {
				t.Errorf("submitted body=%#v", body)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"wan-task","status":"queued"}`))
		case "GET /v1/videos/tasks/wan-task":
			polls++
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{"id": "wan-task", "status": "completed", "result_urls": []string{"http://" + request.Host + "/result.mp4"}})
		case "GET /result.mp4":
			downloads++
			writer.Header().Set("Content-Type", "video/mp4")
			_, _ = writer.Write([]byte("local-wan-fixture"))
		default:
			t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	policy := DefaultVideoPollPolicy()
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	result, err := RunProtocolAdapterTaskWithPolicy(ctx, Input{Mode: "video", Prompt: "@图片1 主角推门", Config: Config{BaseURL: server.URL, InterfaceType: "jiasu-video", Model: "wan3-特惠", VideoSeconds: "30", Size: "9:16"}, ReferenceImages: []Media{{Name: "图片1", URL: "https://h.uguu.se/reference.png"}}}, adapters[0], policy)
	if err != nil || result == nil || creates != 1 || polls != 1 || downloads != 1 {
		t.Fatalf("result=%v error=%v creates=%d polls=%d downloads=%d", result, err, creates, polls, downloads)
	}
}

func TestJiasuWanDiscountNativePayload(t *testing.T) {
	manifest, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "jiasu-video", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "jiasu-video.beeftv-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(archive)
	if err != nil {
		t.Fatal(err)
	}
	readme, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "jiasu-video", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	interfaceDoc, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "jiasu-video", "docs", "interface.md"))
	if err != nil {
		t.Fatal(err)
	}
	for name, expected := range map[string][]byte{"manifest.json": manifest, "README.md": readme, "docs/interface.md": interfaceDoc} {
		if string(pkg.Files[name]) != string(expected) {
			t.Fatalf("packaged %s differs from source", name)
		}
	}
	adapters, err := protocol.LoadInstalledProviders(manifest, nil)
	if err != nil {
		t.Fatal(err)
	}
	var adapter protocol.Adapter
	for _, candidate := range adapters {
		if candidate.Metadata().ID == "jiasu-video" {
			adapter = candidate
		}
	}
	if adapter == nil {
		t.Fatal("missing source Gway adapter")
	}
	for _, quality := range []string{"", "1080p", "1080"} {
		t.Run("resolution="+quality, func(t *testing.T) {
			input := Input{
				Mode: "video", Prompt: "@图片1 @视频1 @音频1",
				Config:          Config{InterfaceType: "jiasu-video", Model: "wan3-特惠", VideoSeconds: "30", VQuality: quality, Size: "21:9", VideoJiasuFaceMode: "default"},
				ReferenceImages: []Media{{Name: "图片1", URL: "https://h.uguu.se/character.png"}},
				ReferenceVideos: []Media{{Name: "视频1", URL: "https://h.uguu.se/motion.mp4"}},
				ReferenceAudios: []Media{{Name: "音频1", URL: "https://h.uguu.se/voice.mp3"}},
			}
			input.VideoCapability = modelcatalog.DefaultModelCapabilityConfigForModel("jiasu-video", input.Config.Model).Video
			if err := ValidateJiasuVideoInput(input); err != nil {
				t.Fatalf("Wan model rejected before submission: %v", err)
			}
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: ProtocolRequestFromInput(input)})
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(spec.Body)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(encoded, &body); err != nil {
				t.Fatal(err)
			}
			if spec.Path != "/v1/video/generations" || body["model"] != input.Config.Model || body["duration"] != float64(30) || body["ratio"] != "21:9" || body["resolution"] != "1080p" {
				t.Fatalf("Wan contract changed: %#v", body)
			}
			for _, key := range []string{"content", "native_face", "face", "generate_audio", "materials", "params", "spec"} {
				if _, exists := body[key]; exists {
					t.Fatalf("unexpected Wan parameter %s", key)
				}
			}
			for key, expected := range map[string]Media{"images": input.ReferenceImages[0], "videos": input.ReferenceVideos[0], "audios": input.ReferenceAudios[0]} {
				items, ok := body[key].([]any)
				if !ok || len(items) != 1 {
					t.Fatalf("Wan reference missing: %s", key)
				}
				media := items[0].(map[string]any)
				if len(media) != 2 || media["url"] != expected.URL || media["name"] != expected.Name {
					t.Fatalf("Wan reference changed: %s=%#v", key, media)
				}
			}
		})
	}
}
