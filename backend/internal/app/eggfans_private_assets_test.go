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
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"
)

type eggfansMediaTestUpload struct{ calls int }

func (upload *eggfansMediaTestUpload) URLAvailable(ctx context.Context, _ string) (bool, error) {
	return true, ctx.Err()
}

func (upload *eggfansMediaTestUpload) InvalidateURL(string) {}

func (upload *eggfansMediaTestUpload) UploadMedia(ctx context.Context, scope string, data []byte, mimeType string) (outbound.TemporaryImageURL, error) {
	upload.calls++
	if ctx.Err() != nil || scope != "user-1" || len(data) == 0 || !strings.HasPrefix(mimeType, "video/") && !strings.HasPrefix(mimeType, "audio/") {
		return outbound.TemporaryImageURL{}, fmt.Errorf("invalid mock upload")
	}
	now := time.Now().UTC()
	return outbound.TemporaryImageURL{URL: "https://h.uguu.se/reference.bin", UploadedAt: now, ExpiresAt: now.Add(3 * time.Hour)}, nil
}

func TestEggfansPrivateAssetsUploadAllMediaPersistAndReuse(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	imageCalls := 0
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, scope string, data []byte) (string, error) {
		imageCalls++
		if scope != "user-1" || !bytes.Equal(original, data) {
			t.Fatal("wrong image source")
		}
		return "https://h.uguu.se/reference.png", nil
	})
	mediaUpload := &eggfansMediaTestUpload{}
	svc.temporaryMedia = mediaUpload
	for _, kind := range []string{"video", "audio"} {
		name := kind + ".bin"
		if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", name), []byte("mock-"+kind), 0o600); err != nil {
			t.Fatal(err)
		}
		resource := model.Resource{ID: "local-" + kind, UserID: "user-1", Kind: kind, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: name, MimeType: kind + "/mp4", Size: int64(len("mock-" + kind)), DurationMs: 2000}
		if err := svc.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
	}
	creates := 0
	var observed []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("wrong authentication")
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/private-avatar/groups/list":
			fmt.Fprint(writer, `{"Result":{"Items":[]}}`)
		case "/v1/private-avatar/groups":
			fmt.Fprint(writer, `{"Result":{"Id":"group-test"}}`)
		case "/v1/private-avatar/assets":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["model"] != eggfansAvatarRoutingModel || body["GroupId"] != "group-test" || !strings.HasPrefix(stringField(body, "URL"), "https://h.uguu.se/") {
				t.Errorf("invalid asset payload: %#v", body)
			}
			observed = append(observed, stringField(body, "AssetType"))
			creates++
			fmt.Fprintf(writer, `{"Result":{"Id":"asset-%d"}}`, creates)
		default:
			if request.Method != http.MethodGet || request.URL.Query().Get("model") != eggfansAvatarRoutingModel {
				t.Error("asset polling omitted routing model")
			}
			fmt.Fprint(writer, `{"Result":{"Status":"Active"}}`)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片1 与 @视频1，使用 @音频1", Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "doubao-seedance-2-5-260628", InterfaceType: "eggfans-seedance-video", VideoSeconds: "27", Size: "9:16", VQuality: "720"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}, ReferenceVideos: []providerMedia{{StorageKey: "resource:local-video"}}, ReferenceAudios: []providerMedia{{StorageKey: "resource:local-audio"}}}
	for attempt := 0; attempt < 2; attempt++ {
		copyInput := input
		copyInput.ReferenceImages = append([]providerMedia(nil), input.ReferenceImages...)
		copyInput.ReferenceVideos = append([]providerMedia(nil), input.ReferenceVideos...)
		copyInput.ReferenceAudios = append([]providerMedia(nil), input.ReferenceAudios...)
		if attempt == 1 {
			svc.eggfansAssetLocks.Clear()
		}
		if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &copyInput); err != nil {
			t.Fatal(err)
		}
		for _, media := range []providerMedia{copyInput.ReferenceImages[0], copyInput.ReferenceVideos[0], copyInput.ReferenceAudios[0]} {
			if !strings.HasPrefix(media.URL, "asset://asset-") || media.DataURL != "" {
				t.Fatal("generation retained non-URI reference")
			}
		}
		adapter := officialSourceProviderAdapter(t, "eggfans-seedance", "eggfans-seedance-video")
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(copyInput)})
		if err != nil {
			t.Fatal(err)
		}
		payload := marshalProtocolBody(t, spec.Body)
		if payload["duration"] != float64(27) || payload["ratio"] != "9:16" || payload["prompt"] != nil || payload["seconds"] != nil || spec.Path != "/api/v3/contents/generations/tasks" {
			t.Fatalf("wrong generation contract: %#v", payload)
		}
		content := payload["content"].([]any)
		if len(content) != 4 || content[0].(map[string]any)["text"] != input.Prompt {
			t.Fatal("lost ordered @ references or prompt")
		}
	}
	if creates != 3 || imageCalls != 1 || mediaUpload.calls != 2 || strings.Join(observed, ",") != "Image,Video,Audio" {
		t.Fatalf("unexpected repeat uploads: creates=%d images=%d media=%d types=%v", creates, imageCalls, mediaUpload.calls, observed)
	}
	if _, err := svc.ResourceEggfansPrivateAssets("other-user", "local-image"); err == nil {
		t.Fatal("foreign resource exposed its URI")
	}
}

func TestEggfansMissingAvatarRouteStopsBeforeUploadAndKeepsSD2Isolated(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	uploads := 0
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		uploads++
		return "https://h.uguu.se/test.png", nil
	})
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != http.MethodPost || request.URL.Path != "/v1/private-avatar/groups/list" {
			t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		writer.WriteHeader(http.StatusNotFound)
		fmt.Fprint(writer, `{"error":{"message":"Invalid URL (POST /v1/private-avatar/groups/list)","type":"invalid_request_error","code":""}}`)
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "doubao-seedance-2-5-260628", InterfaceType: "eggfans-seedance-video", VideoSeconds: "27"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
	err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input)
	if err == nil {
		t.Fatal("missing avatar route was accepted")
	}
	failure := classifyTaskFailure(err)
	message := persistableTaskFailureMessage(err)
	if failure.Category != generation.CategoryModelMissing || !strings.Contains(message, "查询私域素材组") || !strings.Contains(message, "/v1/private-avatar/groups/list") || !strings.Contains(message, "404") || strings.Contains(message, "模型不接受当前参数") {
		t.Fatalf("lost private-asset failure context: %s (%s)", message, failure.Category)
	}
	if displayed := safePersistedFailureMessage(message); displayed != message || persistedFailureErrorCode(message, "failed") != string(generation.CategoryModelMissing) {
		t.Fatalf("persisted task output lost private-asset failure context: %s", displayed)
	}
	input.Config.InterfaceType = "eggfans-sd2-video"
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || uploads != 0 || input.ReferenceImages[0].URL != "" {
		t.Fatalf("failed preflight uploaded media or crossed channels: requests=%d uploads=%d", requests, uploads)
	}
}

func TestEggfansAvatarAllTwelveOperationsUseNativeFields(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing bearer token")
		}
		if request.Method == http.MethodGet || request.Method == http.MethodDelete {
			if request.URL.Query().Get("model") != eggfansAvatarRoutingModel {
				t.Error("routing model missing in query")
			}
		} else {
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["model"] != eggfansAvatarRoutingModel {
				t.Errorf("invalid request: %#v %v", body, err)
			}
			if request.Method == http.MethodPatch && body["Id"] != "item-1" {
				t.Error("PATCH Id does not match path")
			}
		}
		fmt.Fprint(writer, `{"Result":{}}`)
	}))
	defer server.Close()
	config := providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key"}
	for _, operation := range []string{"create-group", "list-groups", "get-group", "update-group", "delete-group", "create-asset", "list-assets", "get-asset", "update-asset", "delete-asset", "auth-session", "group-from-token"} {
		body := map[string]any{"Name": "test", "GroupId": "group-1", "AssetType": "Image", "URL": "https://h.uguu.se/image.png", "CallbackURL": "https://example.com/complete", "BytedToken": "mock-token"}
		if _, err := callEggfansAvatar(context.Background(), config, operation, "item-1", body); err != nil {
			t.Fatalf("%s: %v", operation, err)
		}
	}
}

func TestEggfansAvatarBusinessErrorsAndUnsafeIDsStop(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		fmt.Fprint(writer, `{"ResponseMetadata":{"Error":{"Code":"PermissionDenied","Message":"no permission"}},"Result":{}}`)
	}))
	defer server.Close()
	config := providerConfig{BaseURL: server.URL, APIKey: "test-key"}
	if _, err := callEggfansAvatar(context.Background(), config, "get-asset", "../wrong", nil); err == nil || calls != 0 {
		t.Fatal("unsafe identifier reached upstream")
	}
	if _, err := callEggfansAvatar(context.Background(), config, "get-asset", "asset-1", nil); err == nil || calls != 1 {
		t.Fatal("HTTP 200 business failure was treated as success")
	}
}

func TestEggfansAssetCancellationResumesAndKeysAreIsolated(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) { return "https://h.uguu.se/test.png", nil })
	var creates atomic.Int32
	var ready atomic.Bool
	started := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPost {
			fmt.Fprintf(writer, `{"Result":{"Id":"asset-%d"}}`, creates.Add(1))
			return
		}
		if ready.Load() {
			fmt.Fprint(writer, `{"Result":{"Status":"Active"}}`)
			return
		}
		fmt.Fprint(writer, `{"Result":{"Status":"Processing"}}`)
		select {
		case started <- struct{}{}:
		default:
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := providerConfig{BaseURL: server.URL, APIKey: "key-one"}
	media := providerMedia{StorageKey: "resource:local-image"}
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() {
		_, err := svc.ensureEggfansPrivateAsset(ctx, "user-1", config, &media, "Image", "group-test")
		finished <- err
	}()
	<-started
	cancel()
	if err := <-finished; err == nil {
		t.Fatal("processing asset ignored cancellation")
	}
	ready.Store(true)
	restarted := &Service{repo: svc.repo, dataDir: svc.dataDir}
	for _, service := range []*Service{restarted, restarted} {
		binding, err := service.ensureEggfansPrivateAsset(context.Background(), "user-1", config, &media, "Image", "group-test")
		if err != nil || binding.URI != "asset://asset-1" {
			t.Fatalf("resume failed: %v", err)
		}
	}
	if creates.Load() != 1 {
		t.Fatal("restart re-created the processing asset")
	}
	config.APIKey = "key-two"
	binding, err := restarted.ensureEggfansPrivateAsset(context.Background(), "user-1", config, &media, "Image", "group-test")
	if err != nil || binding.URI != "asset://asset-2" || creates.Load() != 2 {
		t.Fatalf("different credentials reused private asset: %v", err)
	}
}

func TestEggfansFailedAssetStopsAndDoesNotReupload(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) { return "https://h.uguu.se/test.png", nil })
	creates := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPost {
			creates++
			fmt.Fprint(writer, `{"Result":{"Id":"failed-asset"}}`)
			return
		}
		fmt.Fprint(writer, `{"Result":{"Status":"Failed"}}`)
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := providerConfig{BaseURL: server.URL, APIKey: "test-key"}
	media := providerMedia{StorageKey: "resource:local-image"}
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := svc.ensureEggfansPrivateAsset(context.Background(), "user-1", config, &media, "Image", "group-test"); err == nil {
			t.Fatal("failed audit allowed generation")
		}
	}
	if creates != 1 {
		t.Fatal("failed audit triggered another upload")
	}
}

func TestEggfansVideoTaskQueriesUseBothDocumentedRoutes(t *testing.T) {
	service := &Service{}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.Header.Get("Authorization") != "Bearer test-key" || !strings.HasPrefix(request.URL.Path, "/api/v3/contents/") && !strings.HasPrefix(request.URL.Path, "/volc/v1/contents/") {
			t.Error("wrong task query route")
		}
		if strings.HasSuffix(request.URL.Path, "/tasks") && request.URL.Query().Get("page_size") != "20" {
			t.Error("list pagination missing")
		}
		fmt.Fprint(writer, `{"code":0,"data":{"items":[]}}`)
	}))
	defer server.Close()
	for _, protocolID := range []string{"eggfans-seedance-video", "eggfans-volc-video"} {
		for _, taskID := range []string{"", "task-test"} {
			_, err := service.QueryEggfansVideoTasks(context.Background(), "user-1", EggfansVideoTaskQuery{Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", InterfaceType: protocolID}, TaskID: taskID})
			if err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestEggfansNativeContentPreservesFiftyReferencesAndPollContract(t *testing.T) {
	input := canvasGenerationInput{Mode: "video", Prompt: "@图片30 @视频10 @音频10", Config: providerConfig{Model: "doubao-seedance-2-5-260628", InterfaceType: "eggfans-seedance-video", VideoSeconds: "27", VQuality: "720", Size: "9:16"}}
	for index := 0; index < 30; index++ {
		input.ReferenceImages = append(input.ReferenceImages, providerMedia{URL: fmt.Sprintf("asset://image-%d", index)})
	}
	for index := 0; index < 10; index++ {
		input.ReferenceVideos = append(input.ReferenceVideos, providerMedia{URL: fmt.Sprintf("asset://video-%d", index)})
		input.ReferenceAudios = append(input.ReferenceAudios, providerMedia{URL: fmt.Sprintf("asset://audio-%d", index)})
	}
	for _, protocolID := range []string{"eggfans-seedance-video", "eggfans-volc-video"} {
		adapter := officialSourceProviderAdapter(t, "eggfans-seedance", protocolID)
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		content := marshalProtocolBody(t, spec.Body)["content"].([]any)
		if len(content) != 51 {
			t.Fatal("reference limit silently truncated content")
		}
		for _, expected := range []struct {
			offset           int
			field, uri, role string
		}{{30, "image_url", "asset://image-29", "reference_image"}, {40, "video_url", "asset://video-9", "reference_video"}, {50, "audio_url", "asset://audio-9", "reference_audio"}} {
			actual := content[expected.offset].(map[string]any)
			if actual[expected.field].(map[string]any)["url"] != expected.uri || actual["role"] != expected.role {
				t.Fatal("content order or native role changed")
			}
		}
		created, err := adapter.ParseCreate(context.Background(), []byte(`{"code":0,"data":{"task_id":"task-test"}}`))
		if err != nil || created.TaskID != "task-test" {
			t.Fatalf("create envelope: %v", err)
		}
		state, err := adapter.ParsePoll(context.Background(), protocol.PollContext{TaskID: "task-test"}, []byte(`{"id":"different-poll-id","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"}}`))
		if err != nil || state.Status != protocol.StatusSucceeded {
			t.Fatalf("poll envelope: %v", err)
		}
		state, err = adapter.ParsePoll(context.Background(), protocol.PollContext{TaskID: "task-test"}, []byte(`{"code":0,"data":{"status":"succeed","content":{"video_url":"https://example.com/video.mp4"}}}`))
		if err != nil || state.Status != protocol.StatusSucceeded {
			t.Fatalf("Volc succeed status: %v", err)
		}
	}
}

func TestEggfansExplicitURIRequiresActiveAssetAndOwnResource(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	calls := 0
	status := "Processing"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		fmt.Fprintf(writer, `{"Result":{"Status":%q,"AssetType":"Image"}}`, status)
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := providerConfig{BaseURL: server.URL, APIKey: "test-key"}
	media := providerMedia{StorageKey: "resource:local-image", URL: "asset://manual-asset"}
	if _, err := svc.ensureEggfansPrivateAsset(context.Background(), "other-user", config, &media, "Image", ""); err == nil || calls != 0 {
		t.Fatal("foreign resource bypassed ownership through URI")
	}
	if _, err := svc.ensureEggfansPrivateAsset(context.Background(), "user-1", config, &media, "Image", ""); err == nil || calls != 1 {
		t.Fatal("processing URI allowed submission")
	}
	status = "Active"
	if _, err := svc.ensureEggfansPrivateAsset(context.Background(), "user-1", config, &media, "Image", ""); err != nil || calls != 2 {
		t.Fatal("active URI rejected")
	}
}

func TestEggfansAndSD2KeepPrivateURIsSeparateAndUseRefreshedURL(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	oldURL := "https://h.uguu.se/expired.png"
	latestURL := "https://h.uguu.se/refreshed.png"
	now := time.Now().UTC()
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", oldURL, now.Add(-4*time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	uploads := 0
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		uploads++
		return latestURL, nil
	})
	privateCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		privateCalls++
		switch request.URL.Path {
		case "/v1/private-avatar/groups/list":
			fmt.Fprint(writer, `{"Result":{"Items":[{"Id":"group-1","Name":"Eggfans TV 自动素材","GroupType":"AIGC"}]}}`)
		case "/v1/private-avatar/groups":
			fmt.Fprint(writer, `{"Result":{"Id":"group-1"}}`)
		case "/v1/private-avatar/assets":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body["URL"] != latestURL || body["AssetType"] != "Image" {
				t.Errorf("private library received stale URL: %#v %v", body, err)
			}
			fmt.Fprint(writer, `{"Result":{"Id":"private-image"}}`)
		default:
			fmt.Fprint(writer, `{"Result":{"Status":"Active","AssetType":"Image"}}`)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	sd2 := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "eggfans-sd2-video"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image", URL: "asset://other-channel"}}}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &sd2); err != nil || privateCalls != 0 || uploads != 0 {
		t.Fatal("SD2 entered the private asset pipeline")
	}
	if err := svc.hydrateGenerationMedia("user-1", &sd2, providerMediaHydrationPolicy{RequireURL: true}); err != nil || sd2.ReferenceImages[0].URL != latestURL || uploads != 1 || privateCalls != 0 {
		t.Fatalf("SD2 did not receive refreshed public URL: %v", err)
	}
	seedance := canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", InterfaceType: "eggfans-seedance-video"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image", URL: oldURL}}}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &seedance); err != nil || seedance.ReferenceImages[0].URL != "asset://private-image" || uploads != 1 {
		t.Fatalf("Seedance did not receive private URI: %v", err)
	}
	if sd2.ReferenceImages[0].URL != latestURL {
		t.Fatal("Seedance overwrote the SD2 reference")
	}
	before := privateCalls
	if result, err := svc.ResourceUpstreamURL(context.Background(), "user-1", "local-image"); err != nil || result != latestURL || privateCalls != before || uploads != 1 {
		t.Fatal("returning to SD2 reused private URI or re-created an asset")
	}
}

func TestSD2BackendRejectsPrivateURIAndNeverUsesArkAssets(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "eggfans-sd2-video", BaseURL: "https://example.com/api/plan/v3"}, ReferenceImages: []providerMedia{{URL: "asset://private-image"}}}
	policy := providerMediaHydrationPolicyFor(context.Background(), input)
	if err := svc.hydrateGenerationMedia("user-1", &input, policy); err == nil {
		t.Fatal("SD2 backend accepted private URI")
	}
	if isArkPrivateAssetVideoConfig(input.Config) {
		t.Fatal("SD2 host path enabled Ark private asset conversion")
	}
}

func TestTemporaryMediaURLReusesAndRefreshesExpiredLinks(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	upload := &eggfansMediaTestUpload{}
	svc.temporaryMedia = upload
	now := time.Now().UTC()
	for _, kind := range []string{"video", "audio"} {
		resource := model.Resource{ID: "temporary-" + kind, UserID: "user-1", Kind: kind, Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "reference.png", MimeType: kind + "/mp4", Size: 20}
		if err := svc.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
		validURL := "https://h.uguu.se/" + kind + ".mp4"
		if err := svc.repo.SaveResourceTemporaryMediaURL("user-1", resource.ID, validURL, now, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		before := upload.calls
		result, err := svc.ResourceUpstreamURL(context.Background(), "user-1", resource.ID)
		if err != nil || result != validURL || upload.calls != before {
			t.Fatalf("valid media URL not reused: %v", err)
		}
		if err := svc.repo.SaveResourceTemporaryMediaURL("user-1", resource.ID, validURL, now.Add(-4*time.Hour), now.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		result, err = svc.ResourceUpstreamURL(context.Background(), "user-1", resource.ID)
		if err != nil || result != "https://h.uguu.se/reference.bin" || upload.calls != before+1 {
			t.Fatalf("expired media URL not refreshed: %v", err)
		}
		media := providerMedia{StorageKey: "resource:" + resource.ID}
		result, err = svc.eggfansReferencePublicURL(context.Background(), "user-1", &media, map[string]string{"video": "Video", "audio": "Audio"}[kind])
		if err != nil || result != "https://h.uguu.se/reference.bin" || upload.calls != before+1 {
			t.Fatalf("private upload did not receive latest media URL: %v", err)
		}
	}
}

func TestEggfansURLModeBypassesPrivateLibraryAndRefreshesPublicURL(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	uploads := 0
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		uploads++
		return "https://h.uguu.se/latest.png", nil
	})
	input := canvasGenerationInput{
		Mode:            "video",
		Config:          providerConfig{BaseURL: "https://api.eggfans.com", APIKey: "video-key", Model: "doubao-seedance-2-5-260628", InterfaceType: "eggfans-seedance-video", EggfansReferenceMode: "url"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:local-image", URL: "https://h.uguu.se/expired.png"}},
	}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input); err != nil {
		t.Fatal(err)
	}
	if input.ReferenceImages[0].URL != "https://h.uguu.se/latest.png" || input.ReferenceImages[0].DataURL != "" || uploads != 1 {
		t.Fatalf("URL mode did not refresh the public URL: %#v uploads=%d", input.ReferenceImages[0], uploads)
	}
}
