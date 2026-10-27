package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func TestMintsSeedanceAutomaticAssetBindingAndReuse(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	var uploads, creates atomic.Int32
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, owner string, data []byte) (string, error) {
		uploads.Add(1)
		if owner != "user-1" || !bytes.Equal(data, original) {
			t.Error("wrong image or owner uploaded")
		}
		return "https://h.uguu.se/fresh.png", nil
	})
	resource, _ := svc.repo.ResourceForUser("user-1", "local-image")
	past := time.Now().Add(-time.Hour)
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", resource.ID, "https://h.uguu.se/expired.png", past.Add(-time.Hour), past); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.Header.Get("Authorization") != "Bearer mints-test-key" || request.Header.Get("X-Project") != "test" {
			t.Error("lost channel authentication or headers")
		}
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/api/seedance/assets":
			creates.Add(1)
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["URL"] != "https://h.uguu.se/fresh.png" || body["AssetType"] != "Image" || body["model"] != nil || body["GroupId"] != nil || body["Force"] != nil {
				t.Errorf("wrong native asset payload: %#v", body)
			}
			fmt.Fprint(writer, `{"Result":{"Id":"asset-mints-1","LocalId":12,"AssetRef":"asset://asset-mints-1","Status":"Processing"}}`)
		case request.Method == http.MethodGet && request.URL.Path == "/api/seedance/assets/asset-mints-1":
			if request.URL.RawQuery != "" {
				t.Error("Eggfans routing model leaked to Mints")
			}
			fmt.Fprint(writer, `{"Result":{"Id":"asset-mints-1","Status":"Active"}}`)
		default:
			t.Errorf("unexpected endpoint: %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := providerConfig{InterfaceType: "mints-seedance-video", BaseURL: server.URL + "/v1", APIKey: "mints-test-key", Model: "doubao-seedance-2-0-260128", Headers: []OutboundHeader{{Name: "X-Project", Value: "test"}}, VideoSeconds: "18", Size: "9:16", VQuality: "720p"}
	var workers sync.WaitGroup
	for attempt := 0; attempt < 3; attempt++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			input := canvasGenerationInput{Mode: "video", Config: config, Prompt: "@图片1 自然行走", ReferenceImages: []providerMedia{{ID: "image-1", StorageKey: "resource:local-image", URL: "asset://foreign-channel-asset"}}}
			if err := svc.prepareMintsAssetReferences(context.Background(), "user-1", &input); err != nil {
				t.Error(err)
				return
			}
			if input.ReferenceImages[0].URL != "asset://asset-mints-1" || input.ReferenceImages[0].DataURL != "" {
				t.Error("foreign URI or public URL reached video generation")
			}
		}()
	}
	workers.Wait()
	bindings, err := svc.repo.ResourceEggfansAssets("user-1", "local-image")
	if err != nil || len(bindings) != 1 || bindings[0].URI != "asset://asset-mints-1" || bindings[0].Status != "active" || creates.Load() != 1 || uploads.Load() != 1 {
		t.Fatalf("binding was not persisted/deduplicated: bindings=%#v creates=%d uploads=%d err=%v", bindings, creates.Load(), uploads.Load(), err)
	}
	svc.eggfansAssetLocks.Clear()
	media := providerMedia{StorageKey: "resource:local-image"}
	if _, err := svc.ensureMintsAsset(context.Background(), "user-1", config, &media, "Image", ""); err != nil || creates.Load() != 1 {
		t.Fatalf("persisted URI not reused: %v", err)
	}
	if mintsAccountScope("user-1", config) == eggfansAccountScope("user-1", config) {
		t.Fatal("Mints and Eggfans share account scope")
	}
	config.APIKey = "another-key"
	if mintsAccountScope("user-1", config) == bindings[0].AccountScope {
		t.Fatal("keys share URI cache")
	}
	if _, err := svc.ensureMintsAsset(context.Background(), "other-user", config, &media, "Image", ""); err == nil {
		t.Fatal("foreign resource was accepted")
	}
}

func TestMintsSeedanceAssetFailureAndPollingResume(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) { return "https://h.uguu.se/resume.png", nil })
	var creates atomic.Int32
	status := "Processing"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodPost {
			creates.Add(1)
			fmt.Fprint(writer, `{"Result":{"Id":"asset-resume","Status":"Processing"}}`)
		} else {
			fmt.Fprintf(writer, `{"Result":{"Id":"asset-resume","Status":%q}}`, status)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := providerConfig{InterfaceType: "mints-seedance-video", BaseURL: server.URL, APIKey: "test"}
	media := providerMedia{StorageKey: "resource:local-image"}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if _, err := svc.ensureMintsAsset(ctx, "user-1", config, &media, "Image", ""); err == nil {
		t.Fatal("processing asset was used before Active")
	}
	status = "Active"
	if binding, err := svc.ensureMintsAsset(context.Background(), "user-1", config, &media, "Image", ""); err != nil || binding.URI != "asset://asset-resume" || creates.Load() != 1 {
		t.Fatalf("polling did not resume existing ID: %v", err)
	}
	status = "Failed"
	if _, err := svc.ensureMintsAsset(context.Background(), "user-1", config, &media, "Image", ""); err == nil || creates.Load() != 1 {
		t.Fatal("rejected asset did not stop generation")
	}
	for _, iface := range []string{"eggfans-sd2-video", "jiasu-video", "eggfans-seedance-video"} {
		input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: iface}, ReferenceImages: []providerMedia{{URL: "https://example.com/image.png"}}}
		if err := svc.prepareMintsAssetReferences(context.Background(), "user-1", &input); err != nil || input.ReferenceImages[0].URL != "https://example.com/image.png" {
			t.Fatal("Mints affected another channel")
		}
	}
}

func TestMintsSeedanceNativeProtocolContract(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "mints-seedance", "mints-seedance-video")
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片1 和 @视频1 使用 @音频1", Config: providerConfig{InterfaceType: "mints-seedance-video", Model: "doubao-seedance-2-0-260128", VideoSeconds: "18", VQuality: "720p", Size: "9:16"}, ReferenceImages: []providerMedia{{URL: "asset://asset-image"}}, ReferenceVideos: []providerMedia{{URL: "asset://asset-video"}}, ReferenceAudios: []providerMedia{{URL: "asset://asset-audio"}}, Metadata: map[string]any{"providerOptions": map[string]any{"mints-seedance-video": map[string]any{"seed": 0, "camera_fixed": false, "draft": false, "service_tier": "flex"}, "eggfans-seedance-video": map[string]any{"seed": 99}}}}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body := marshalProtocolBody(t, spec.Body)
	if spec.Path != "/api/v3/contents/generations/tasks" || !spec.OriginPath || body["duration"] != float64(18) || body["seed"] != float64(0) || body["camera_fixed"] != false || body["draft"] != false || body["service_tier"] != "flex" || body["native_face"] != nil {
		t.Fatalf("wrong native request: %#v", body)
	}
	content := body["content"].([]any)
	if len(content) != 4 || content[0].(map[string]any)["text"] != input.Prompt {
		t.Fatal("prompt/reference order lost")
	}
	for index, kind := range []string{"image", "video", "audio"} {
		item := content[index+1].(map[string]any)
		if item["type"] != kind+"_url" || item["role"] != "reference_"+kind || item[kind+"_url"].(map[string]any)["url"] != "asset://asset-"+kind {
			t.Errorf("wrong %s reference: %#v", kind, item)
		}
	}
	request := protocol.PollContext{TaskID: "task-local-test"}
	poll, err := adapter.BuildPoll(context.Background(), request)
	if err != nil || !strings.HasSuffix(poll.Path, "/task-local-test") {
		t.Fatalf("bad poll: %#v %v", poll, err)
	}
}

func TestMintsSeedanceReferenceToVideoRoundTrip(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) { return "https://h.uguu.se/image.png", nil })
	mediaUpload := &eggfansMediaTestUpload{}
	svc.temporaryMedia = mediaUpload
	for _, kind := range []string{"video", "audio"} {
		filename := kind + ".bin"
		if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", filename), []byte("mock-"+kind), 0o600); err != nil {
			t.Fatal(err)
		}
		resource := model.Resource{ID: "local-" + kind, UserID: "user-1", Kind: kind, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: filename, MimeType: kind + "/mp4", DurationMs: 2000, Size: 10}
		if err := svc.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
	}
	var creates, polls, downloads, assets int
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/seedance/assets":
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			assets++
			fmt.Fprintf(writer, `{"Result":{"Id":%q,"Status":"Processing"}}`, "asset-"+strings.ToLower(stringField(body, "AssetType")))
		case "/api/seedance/assets/asset-image", "/api/seedance/assets/asset-video", "/api/seedance/assets/asset-audio":
			fmt.Fprint(writer, `{"Result":{"Status":"Active"}}`)
		case "/api/v3/contents/generations/tasks":
			creates++
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			content := body["content"].([]any)
			if len(content) != 4 || assets != 3 {
				t.Error("video was submitted before all assets were bound")
			}
			for index, kind := range []string{"image", "video", "audio"} {
				item := content[index+1].(map[string]any)
				if item[kind+"_url"].(map[string]any)["url"] != "asset://asset-"+kind {
					t.Error("video received public URL instead of bound URI")
				}
			}
			fmt.Fprint(writer, `{"id":"task-mints-test"}`)
		case "/api/v3/contents/generations/tasks/task-mints-test":
			polls++
			if polls == 1 {
				fmt.Fprint(writer, `{"id":"task-mints-test","status":"running"}`)
			} else {
				fmt.Fprintf(writer, `{"id":"task-mints-test","status":"succeeded","content":{"video_url":%q}}`, server.URL+"/download-without-extension")
			}
		case "/download-without-extension":
			downloads++
			writer.Header().Set("Content-Type", "video/mp4")
			fmt.Fprint(writer, "mock-video-data")
		default:
			t.Error("unexpected endpoint", request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片1 与 @视频1 使用 @音频1", Config: providerConfig{InterfaceType: "mints-seedance-video", BaseURL: server.URL, APIKey: "synthetic-key", Model: "doubao-seedance-2-0-260128", VideoSeconds: "18", VQuality: "720p", Size: "16:9"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}, ReferenceVideos: []providerMedia{{StorageKey: "resource:local-video"}}, ReferenceAudios: []providerMedia{{StorageKey: "resource:local-audio"}}}
	if err := svc.prepareMintsAssetReferences(context.Background(), "user-1", &input); err != nil {
		t.Fatal(err)
	}
	adapter := officialSourceProviderAdapter(t, "mints-seedance", "mints-seedance-video")
	result, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, adapter, fastVideoPollPolicy())
	if err != nil || result["mode"] != "video" || creates != 1 || polls != 2 || downloads != 1 || mediaUpload.calls != 2 {
		t.Fatalf("round trip failed: result=%#v creates=%d polls=%d downloads=%d err=%v", result, creates, polls, downloads, err)
	}
}
