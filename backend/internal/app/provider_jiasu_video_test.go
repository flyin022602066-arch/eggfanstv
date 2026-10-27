package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

func jiasuTestInput(modelName string) canvasGenerationInput {
	return canvasGenerationInput{Mode: "video", Prompt: "@角色1走向镜头", Config: providerConfig{InterfaceType: "jiasu-video", Model: modelName, VideoSeconds: "5", Size: "9:16", VQuality: "720p", VideoNativeFace: "true", VideoJiasuFaceMode: "off"}}
}

func TestJiasuJ1SubmissionAndAutomaticAudio(t *testing.T) {
	input := jiasuTestInput("sd-2.0-mini-J1")
	if err := validateJiasuVideoInput(input); err != nil {
		t.Fatalf("catalog J1 rejected locally: %v", err)
	}
	profile := DefaultModelCapabilityConfigForModel("jiasu-video", input.Config.Model)
	profile.Video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	normalized, err := NormalizeModelCapabilityConfigForModel("video", "jiasu-video", input.Config.Model, profile)
	if err != nil {
		t.Fatal(err)
	}
	if !normalized.Video.GenerateAudio.Supported || !normalized.Video.GenerateAudio.Default {
		t.Fatal("legacy Jiasu profile still reports audio disabled")
	}
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatalf("catalog J1 rejected by plugin: %v", err)
	}
	body := marshalProtocolBody(t, spec.Body)
	if body["model"] != "sd-2.0-mini-J1" || body["generate_audio"] != nil || body["native_face"] != nil {
		t.Fatalf("J1 native request changed: %#v", body)
	}
}

func TestJiasuJ3ThirtySecond1080pPayload(t *testing.T) {
	input := jiasuTestInput("sd-2.5-J3-doubao")
	input.Config.VideoSeconds, input.Config.VQuality = "30", "1080p"
	input.Config.VideoJiasuFaceMode = "default"
	input.ReferenceImages = []providerMedia{{Name: "角色1", URL: "https://cdn.example/character.png"}}
	input.ReferenceAudios = []providerMedia{{Name: "音色", URL: "https://cdn.example/voice.mp3"}}
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body := marshalProtocolBody(t, spec.Body)
	if spec.Path != "/v1/video/generations" || body["model"] != input.Config.Model || body["duration"] != float64(30) || body["resolution"] != "1080p" {
		t.Fatalf("new model request was changed: %#v", body)
	}
	if body["native_face"] != nil || body["content"] != nil || body["face"] != nil {
		t.Fatalf("foreign request parameters: %#v", body)
	}
	input.ReferenceImages[0].Bytes = 101 * 1024 * 1024
	if err := validateJiasuVideoInput(input); err != nil {
		t.Fatalf("J3 must defer aggregate-size acceptance to the upstream: %v", err)
	}
}

func TestJiasuVideoPayloadAndIsolation(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	for _, modelName := range []string{"dola-sd-2.5", "dola-sd-2.0", "minimax-h3", "sd-2.5-j2-V", "sd-2.5-J2", "sd-2.0-mini-J1"} {
		t.Run(modelName, func(t *testing.T) {
			input := jiasuTestInput(modelName)
			input.ReferenceImages = []providerMedia{{ID: "character", Name: "角色1", URL: "https://cdn.example/character.png"}}
			input.ReferenceVideos = []providerMedia{{Name: "运镜", URL: "https://cdn.example/motion.mp4", DurationMs: 6500, MimeType: "video/mp4"}}
			input.ReferenceAudios = []providerMedia{{Name: "声音", URL: "https://cdn.example/voice.mp3", MimeType: "audio/mpeg"}}
			request := protocolRequestFromInput(input)
			if request.NativeFace || request.Images[0].Role != "reference_image" {
				t.Fatal("SD2 face flag or implicit first-frame role leaked into Jiasu")
			}
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := marshalProtocolBody(t, spec.Body)
			if spec.Path != "/v1/video/generations" || spec.Method != "POST" || spec.Auth.Type != "bearer" || body["model"] != modelName || body["ratio"] != "9:16" || body["prompt"] != input.Prompt {
				t.Fatalf("unexpected Jiasu contract: %#v, %#v", spec, body)
			}
			for _, key := range []string{"content", "native_face", "image_refs", "video_refs", "audio_refs", "first_image", "last_image", "aspect_ratio"} {
				if _, present := body[key]; present {
					t.Fatalf("foreign channel field %s leaked", key)
				}
			}
			image := body["images"].([]any)[0].(map[string]any)
			if image["name"] != "角色1" || image["url"] != input.ReferenceImages[0].URL || image["type"] != nil {
				t.Fatalf("reference image = %#v", image)
			}
			if strings.EqualFold(modelName, "sd-2.5-j2-V") {
				if _, present := body["face"]; present {
					t.Fatal("J2-V rejects face even when disabled")
				}
			} else if body["face"].(map[string]any)["enabled"] != false {
				t.Fatal("explicit original-image face setting was omitted")
			}
			video := body["videos"].([]any)[0].(map[string]any)
			if modelName == "minimax-h3" {
				if video["duration_seconds"] != 6.5 || body["duration"] != float64(15) || body["resolution"] != "2k" {
					t.Fatalf("H3 parameters = %#v", body)
				}
			} else if video["duration_seconds"] != nil || body["duration"] != float64(5) || body["resolution"] != "720p" {
				t.Fatalf("H3 parameters leaked into dola: %#v", body)
			}
		})
	}
}

func TestJiasuJ2VDoesNotSubmitUnsupportedFace(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	for _, faceMode := range []string{"", "default", "off"} {
		input := jiasuTestInput("sd-2.5-j2-V")
		input.Config.VideoJiasuFaceMode = faceMode
		input.Metadata = map[string]any{"source": "short-drama-workflow", "providerOptions": map[string]any{"jiasu-video": map[string]any{"face": map[string]any{"enabled": false}, "other": "preserved"}}}
		input.ReferenceImages = []providerMedia{{Name: "嬴政", URL: "https://h.uguu.se/character.png"}, {Name: "正殿", URL: "https://h.uguu.se/scene.png"}}
		if err := validateJiasuVideoInput(input); err != nil {
			t.Fatal(err)
		}
		request := protocolRequestFromInput(input)
		if request.ProviderOptions["jiasu-video"]["other"] != "preserved" {
			t.Fatal("unrelated provider option lost")
		}
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := marshalProtocolBody(t, spec.Body)
		if _, present := body["face"]; present {
			t.Fatalf("J2-V received unsupported face in mode %q: %#v", faceMode, body["face"])
		}
		if body["model"] != input.Config.Model || len(body["images"].([]any)) != 2 || body["duration"] != float64(5) || body["ratio"] != "9:16" {
			t.Fatal("shot references or selected parameters changed")
		}
	}
	for _, faceMode := range []string{"light", "heavy"} {
		input := jiasuTestInput("sd-2.5-j2-V")
		input.Config.VideoJiasuFaceMode = faceMode
		if err := validateJiasuVideoInput(input); err == nil || !strings.Contains(err.Error(), "face") {
			t.Fatal("unsupported enabled face should stop before a charged request")
		}
	}
}

func TestJiasuJ2DocumentedNamedReferences(t *testing.T) {
	input := jiasuTestInput("sd-2.5-j2-V")
	input.Prompt = "@角色1和@角色2在@场景1中聊天，@角色1音频是@角色1的音色"
	input.Config.Size = "16:9"
	input.ReferenceImages = []providerMedia{
		{Name: "角色1", URL: "https://m.jiasuapi.com/example/char1.png"},
		{Name: "角色2", URL: "https://m.jiasuapi.com/example/char2.png"},
		{Name: "场景1", URL: "https://m.jiasuapi.com/example/scene1.png"},
	}
	input.ReferenceAudios = []providerMedia{{Name: "角色1的音色", URL: "https://m.jiasuapi.com/example/voice1.mp3"}}
	if err := validateJiasuVideoInput(input); err != nil {
		t.Fatal(err)
	}
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body := marshalProtocolBody(t, spec.Body)
	want := map[string]any{}
	if err := json.Unmarshal([]byte(`{"model":"sd-2.5-j2-V","prompt":"@角色1和@角色2在@场景1中聊天，@角色1音频是@角色1的音色","duration":5,"ratio":"16:9","resolution":"720p","images":[{"url":"https://m.jiasuapi.com/example/char1.png","name":"角色1"},{"url":"https://m.jiasuapi.com/example/char2.png","name":"角色2"},{"url":"https://m.jiasuapi.com/example/scene1.png","name":"场景1"}],"audios":[{"url":"https://m.jiasuapi.com/example/voice1.mp3","name":"角色1的音色"}]}`), &want); err != nil {
		t.Fatal(err)
	}
	actualJSON, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	expectedJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/video/generations" || spec.Auth.Type != "bearer" || !bytes.Equal(actualJSON, expectedJSON) {
		t.Fatalf("J2-V request differs from documented example: %#v", body)
	}
}

func TestJiasuVideoFramesAndFaceModes(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	input := jiasuTestInput("dola-sd-2.5")
	input.ReferenceImages = []providerMedia{{ID: "last", URL: "https://cdn.example/last.png"}, {ID: "first", URL: "https://cdn.example/first.png"}}
	input.Metadata = map[string]any{"videoStartFrameNodeId": "first", "videoEndFrameNodeId": "last"}
	for _, faceMode := range []string{"default", "off", "light", "heavy"} {
		input.Config.VideoJiasuFaceMode = faceMode
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		body := marshalProtocolBody(t, spec.Body)
		images := body["images"].([]any)
		if images[0].(map[string]any)["type"] != "end_frame" || images[1].(map[string]any)["type"] != "first_frame" {
			t.Fatal("explicit frame roles or order were changed")
		}
		if faceMode == "default" {
			if _, present := body["face"]; present {
				t.Fatal("server default must omit face")
			}
		} else if faceMode != "off" && body["face"].(map[string]any)["mode"] != faceMode {
			t.Fatal("face mode was not mapped")
		}
	}
	input.ReferenceAudios = []providerMedia{{URL: "https://cdn.example/audio.mp3"}}
	if validateJiasuVideoInput(input) == nil {
		t.Fatal("frames plus audio must fail locally")
	}
	if _, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)}); err == nil {
		t.Fatal("plugin must also reject frames plus audio")
	}
	input.Config.InterfaceType = "eggfans-sd2-video"
	input.Config.Model = "sd-2.5-C"
	request := protocolRequestFromInput(input)
	if request.ProviderOptions["jiasu-video"] != nil || !request.NativeFace {
		t.Fatal("Jiasu face configuration contaminated SD2")
	}
}

func TestJiasuCanvasMentionNamesMatchMedia(t *testing.T) {
	input := jiasuTestInput("dola-sd-2.5")
	input.Prompt = "@图片1 与 @图片10，运镜使用 @视频1，音色参考 @音频1"
	for index := 0; index < 10; index++ {
		input.ReferenceImages = append(input.ReferenceImages, providerMedia{Name: "原图文件.png", URL: "https://cdn.example/image.png"})
	}
	input.ReferenceVideos = []providerMedia{{Name: "原视频.mp4", URL: "https://cdn.example/video.mp4"}}
	input.ReferenceAudios = []providerMedia{{Name: "原音频.mp3", URL: "https://cdn.example/audio.mp3"}}
	request := protocolRequestFromInput(input)
	if request.Prompt != input.Prompt || request.Images[0].Name != "图片1" || request.Images[9].Name != "图片10" || request.Images[1].Name != "原图文件.png" || request.Videos[0].Name != "视频1" || request.Audios[0].Name != "音频1" {
		t.Fatal("canvas @ aliases do not match Jiasu media names")
	}
	input.Config.InterfaceType = "eggfans-sd2-video"
	if protocolRequestFromInput(input).Images[0].Name != "原图文件.png" {
		t.Fatal("Jiasu name mapping changed other providers")
	}
}

func TestJiasuVideoLimits(t *testing.T) {
	for _, modelName := range []string{"dola-sd-2.5", "dola-sd-2.0", "minimax-h3", "vendor/SD2.5-fast"} {
		input := jiasuTestInput(modelName)
		maxImages := 10
		if modelName == "dola-sd-2.5" || modelName == "vendor/SD2.5-fast" {
			maxImages = 30
		}
		for index := 0; index < maxImages; index++ {
			input.ReferenceImages = append(input.ReferenceImages, providerMedia{URL: "https://cdn.example/image.png"})
		}
		if err := validateJiasuVideoInput(input); err != nil {
			t.Fatal(err)
		}
		input.ReferenceImages = append(input.ReferenceImages, providerMedia{URL: "https://cdn.example/extra.png"})
		if validateJiasuVideoInput(input) == nil {
			t.Fatal("image overflow accepted")
		}
	}
	input := jiasuTestInput("dola-sd-2.5")
	input.ReferenceAudios = make([]providerMedia, 10)
	if err := validateJiasuVideoInput(input); err != nil {
		t.Fatal(err)
	}
	input.ReferenceAudios = append(input.ReferenceAudios, providerMedia{})
	if validateJiasuVideoInput(input) == nil {
		t.Fatal("audio overflow accepted")
	}
	input = jiasuTestInput("minimax-h3")
	input.ReferenceVideos = []providerMedia{{DurationMs: 7500}, {DurationMs: 7500}}
	if err := validateJiasuVideoInput(input); err != nil {
		t.Fatal(err)
	}
	input.ReferenceVideos[1].DurationMs++
	if validateJiasuVideoInput(input) == nil {
		t.Fatal("total video duration overflow accepted")
	}
	input.ReferenceVideos[1].DurationMs = 0
	if validateJiasuVideoInput(input) == nil {
		t.Fatal("missing duration accepted")
	}
	input.ReferenceVideos = nil
	input.ReferenceImages = make([]providerMedia, 9)
	input.ReferenceAudios = make([]providerMedia, 2)
	if validateJiasuVideoInput(input) == nil {
		t.Fatal("H3 aggregate material overflow accepted")
	}
}

func TestJiasuSeedance25FullModalLimits(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	for _, modelName := range []string{"sd-2.5-j2-V", "sd-2.5-J2", "sd-2.5-J3-doubao"} {
		t.Run(modelName, func(t *testing.T) {
			input := jiasuTestInput(modelName)
			for index := 0; index < 30; index++ {
				input.ReferenceImages = append(input.ReferenceImages, providerMedia{URL: "https://cdn.example/image.png", Bytes: 1024})
			}
			for index := 0; index < 10; index++ {
				input.ReferenceVideos = append(input.ReferenceVideos, providerMedia{URL: "https://cdn.example/video.mp4", Bytes: 1024})
				input.ReferenceAudios = append(input.ReferenceAudios, providerMedia{URL: "https://cdn.example/audio.mp3", Bytes: 1024})
			}
			if err := validateJiasuVideoInput(input); err != nil {
				t.Fatalf("full-modal references should be accepted: %v", err)
			}
			legacy := DefaultModelCapabilityConfigForModel("jiasu-video", "dola-sd-2.0")
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "jiasu-video", modelName, legacy)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateVideoReferenceMedia(normalized.Video, input); err != nil {
				t.Fatalf("saved capability limits should accept full-modal input: %v", err)
			}
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
			if err != nil {
				t.Fatalf("plugin must accept J2 full-modal input: %v", err)
			}
			body := marshalProtocolBody(t, spec.Body)
			if body["model"] != modelName || len(body["images"].([]any)) != 30 || len(body["videos"].([]any)) != 10 || len(body["audios"].([]any)) != 10 {
				t.Fatal("plugin dropped full-modal references or rewrote the model ID")
			}
			if legacy.Video.References.MaxImages != 10 {
				t.Fatal("normalization mutated another model's capabilities")
			}
			input.ReferenceVideos = append(input.ReferenceVideos, providerMedia{URL: "https://cdn.example/extra.mp4"})
			if validateJiasuVideoInput(input) == nil {
				t.Fatal("video overflow accepted")
			}
			input.ReferenceVideos = input.ReferenceVideos[:10]
			input.ReferenceImages[0].Bytes = 60 * 1024 * 1024
			input.ReferenceVideos[0].Bytes = 41 * 1024 * 1024
			if strings.EqualFold(modelName, "sd-2.5-j2-V") || strings.EqualFold(modelName, "sd-2.5-J3-doubao") {
				if err := validateJiasuVideoInput(input); err != nil {
					t.Fatalf("aggregate media size must be sent for upstream validation: %v", err)
				}
				if err := validateVideoReferenceMedia(normalized.Video, input); err != nil {
					t.Fatalf("generic validation must not impose a local aggregate media limit: %v", err)
				}
			} else if err := validateJiasuVideoInput(input); err != nil {
				t.Fatalf("the J2 model has no documented 100 MiB aggregate limit: %v", err)
			}
		})
	}
}

func TestJiasuAggregateReferenceByteLimitIsDeferredToUpstream(t *testing.T) {
	input := jiasuTestInput("sd-2.5-j2-V")
	input.ReferenceImages = []providerMedia{{URL: "https://cdn.example/large.png", Bytes: 2 * 1024 * 1024}}
	profile := *DefaultModelCapabilityConfigForModel("jiasu-video", input.Config.Model).Video
	profile.References.MaxTotalBytes = 1
	if err := validateVideoReferenceMedia(&profile, input); err != nil {
		t.Fatalf("佳速素材大小应交给上游判断，不能被本地总量限制拦截: %v", err)
	}

	input.Config.InterfaceType = "eggfans-sd2-video"
	if err := validateVideoReferenceMedia(&profile, input); err == nil {
		t.Fatal("其他渠道仍应遵守已配置的本地素材总量限制")
	}
}

func TestJiasuLocalResourceUsesFreshURLAndRejectsURI(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	calls := 0
	upload := &unavailableImageUpload{imageUploadTestFunc: func(ctx context.Context, userID string, data []byte) (string, error) {
		calls++
		if userID != "user-1" || !bytes.Equal(data, original) {
			t.Fatal("URL renewal did not use the owned original")
		}
		return "https://h.uguu.se/fresh.png", ctx.Err()
	}}
	svc.temporaryImages = upload
	now := time.Now().UTC()
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/deleted.png", now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	input := jiasuTestInput("dola-sd-2.5")
	input.Config.BaseURL = "https://example.com/api/plan/v3"
	input.ReferenceImages = []providerMedia{{ID: "image", StorageKey: "resource:local-image", URL: "https://h.uguu.se/deleted.png"}}
	policy := providerMediaHydrationPolicyFor(context.Background(), input)
	if !policy.publicOnly || !policy.requireURL || isArkPrivateAssetVideoConfig(input.Config) {
		t.Fatal("Jiasu was routed to private assets by its base URL")
	}
	if err := svc.hydrateGenerationMedia(context.Background(), "user-1", &input, policy); err != nil {
		t.Fatal(err)
	}
	if input.ReferenceImages[0].URL != "https://h.uguu.se/fresh.png" || upload.invalidated != "https://h.uguu.se/deleted.png" || calls != 1 {
		t.Fatal("owned resource did not replace the deleted URL")
	}
	resource, err := svc.repo.ResourceForUser("user-1", "local-image")
	if err != nil || resource.TemporaryImageURL != input.ReferenceImages[0].URL || !resource.TemporaryImageExpiresAt.After(now.Add(2*time.Hour)) {
		t.Fatal("refreshed URL and expiry were not saved")
	}
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body := marshalProtocolBody(t, create.Body)
	if body["images"].([]any)[0].(map[string]any)["url"] != input.ReferenceImages[0].URL || body["native_face"] != nil || body["content"] != nil {
		t.Fatal("fresh URL or channel isolation was lost in the final payload")
	}
	uri := providerMedia{URL: "asset://uri-only"}
	if err := svc.hydrateProviderMedia(context.Background(), "user-1", &uri, policy); err == nil {
		t.Fatal("URI-only reference accepted")
	}
}

func TestJiasuVideoMockedLifecycle(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, modelName := range []string{"dola-sd-2.5", "sd-2.5-j2-V"} {
		t.Run(modelName, func(t *testing.T) {
			var createBody map[string]any
			var calls []string
			cdn := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				calls = append(calls, request.Method+" "+request.URL.Path)
				if request.Header.Get("Authorization") != "" || request.Header.Get("X-Jiasu-Test") != "" {
					t.Error("provider credentials leaked to result CDN")
				}
				writer.Header().Set("Content-Type", "video/mp4")
				_, _ = writer.Write([]byte("mock-video"))
			}))
			defer cdn.Close()
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				calls = append(calls, request.Method+" "+request.URL.Path)
				switch request.URL.Path {
				case "/v1/video/generations":
					if request.Header.Get("Authorization") != "Bearer jiasu-synthetic-key" || request.Header.Get("X-Jiasu-Test") != "own-header" {
						t.Error("wrong channel credential or custom header")
					}
					if err := json.NewDecoder(request.Body).Decode(&createBody); err != nil {
						t.Error(err)
					}
					if strings.EqualFold(modelName, "sd-2.5-j2-V") && createBody["face"] != nil {
						http.Error(writer, "field is not supported: face", http.StatusBadRequest)
						return
					}
					writer.Header().Set("Content-Type", "application/json")
					_, _ = writer.Write([]byte(`{"id":"task-jiasu","status":"queued","progress":0}`))
				case "/v1/videos/tasks/task-jiasu":
					if request.Header.Get("Authorization") != "Bearer jiasu-synthetic-key" {
						t.Error("poll key changed")
					}
					writer.Header().Set("Content-Type", "application/json")
					_, _ = writer.Write([]byte(`{"id":"task-jiasu","status":"completed","result_urls":["` + cdn.URL + `/result.mp4"]}`))
				default:
					t.Errorf("wrong channel route: %s", request.URL.Path)
					http.NotFound(writer, request)
				}
			}))
			defer server.Close()
			input := jiasuTestInput(modelName)
			input.ReferenceImages = []providerMedia{{Name: "角色", URL: "https://cdn.example/character.png"}, {Name: "场景", URL: "https://cdn.example/scene.png"}}
			input.Config.BaseURL, input.Config.APIKey = server.URL, "jiasu-synthetic-key"
			input.Config.Headers = []OutboundHeader{{Name: "X-Jiasu-Test", Value: "own-header"}}
			result, err := runVideoTaskForTest(context.Background(), input)
			if err != nil || result["mode"] != "video" || createBody["model"] != input.Config.Model {
				t.Fatalf("mock lifecycle: %#v, %v", result, err)
			}
			if len(createBody["images"].([]any)) != 2 {
				t.Fatal("bound reference images did not reach the provider")
			}
			if modelName == "dola-sd-2.5" && createBody["face"].(map[string]any)["enabled"] != false {
				t.Fatal("working Dola face parameter changed")
			}
			if strings.Join(calls, "|") != "POST /v1/video/generations|GET /v1/videos/tasks/task-jiasu|GET /result.mp4" {
				t.Fatalf("calls = %v", calls)
			}
		})
	}
}

func TestJiasuDocumentedPollInterval(t *testing.T) {
	policy := declarativeProtocolPollPolicy("video", "jiasu-video")
	if policy.Interval != 3*time.Second || policy.InitialDelay != 3*time.Second || !policy.RetryTransient {
		t.Fatalf("Jiasu polling policy = %#v", policy)
	}
	if policy := videoPollPolicyForInterface("eggfans-sd2-video"); policy.Interval != defaultVideoPollInterval {
		t.Fatal("Jiasu poll interval changed another channel")
	}
}

func TestJiasuGenerationPreparesReferencesBeforeSubmittingToSelectedChannel(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, uploadFails := range []bool{true, false} {
		t.Run(fmt.Sprint(uploadFails), func(t *testing.T) {
			svc, original := temporaryImageTestResource(t)
			uploads, submissions := 0, 0
			svc.temporaryImages = imageUploadTestFunc(func(ctx context.Context, userID string, data []byte) (string, error) {
				uploads++
				if submissions != 0 || userID != "user-1" || !bytes.Equal(data, original) {
					t.Fatal("provider called before original reference was prepared")
				}
				if uploadFails {
					return "", context.DeadlineExceeded
				}
				return "https://h.uguu.se/prepared.png", nil
			})
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/result.mp4" {
					writer.Header().Set("Content-Type", "video/mp4")
					_, _ = writer.Write([]byte("mock-video"))
					return
				}
				submissions++
				if uploads != 1 || request.URL.Path != "/v1/video/generations" || request.Header.Get("Authorization") != "Bearer selected-jiasu-key" {
					t.Error("request used the wrong channel, key, or stage")
				}
				var body map[string]any
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["model"] != "sd-2.5-j2-V" || body["images"].([]any)[0].(map[string]any)["url"] != "https://h.uguu.se/prepared.png" {
					t.Error("model or prepared reference URL changed")
				}
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{"id":"selected-jiasu-task","status":"completed","result_urls":["http://` + request.Host + `/result.mp4"]}`))
			}))
			defer server.Close()
			input := jiasuTestInput("sd-2.5-j2-V")
			input.Config.BaseURL, input.Config.APIKey = server.URL, "selected-jiasu-key"
			input.ReferenceImages = []providerMedia{{Name: "图片1", StorageKey: "resource:local-image"}}
			encoded, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			result, err := svc.processCanvasGenerationTask(context.Background(), "user-1", "", "canvas_video", "", string(encoded))
			if uploadFails {
				if err == nil || submissions != 0 || classifyTaskFailure(err).Uncertain {
					t.Fatalf("upload failure was mistaken for a submitted task: calls=%d err=%v", submissions, err)
				}
			} else if err != nil || submissions != 1 || result["mode"] != "video" || result["video"] == nil {
				t.Fatalf("prepared request did not reach selected channel: calls=%d result=%#v err=%v", submissions, result, err)
			}
		})
	}
}

func TestJiasuPollingWindowAndExplicitFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
	for name, explicitDeadline := range map[string]bool{"default": false, "explicit": true} {
		t.Run(name, func(t *testing.T) {
			creates, polls, sleeps := 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				switch request.URL.Path {
				case "/v1/video/generations":
					creates++
					_, _ = writer.Write([]byte(`{"id":"task-jiasu-failed","status":"queued"}`))
				case "/v1/videos/tasks/task-jiasu-failed":
					polls++
					switch polls {
					case 1:
						writer.WriteHeader(http.StatusServiceUnavailable)
						_, _ = writer.Write([]byte(`{"error":{"message":"temporarily unavailable"}}`))
					case 2:
						_, _ = writer.Write([]byte(`{"id":"task-jiasu-failed","status":"in_progress","progress":35}`))
					default:
						_, _ = writer.Write([]byte(`{"id":"task-jiasu-failed","status":"failed","progress":100,"error":{"code":"","message":"生成失败，请稍后重试"}}`))
					}
				default:
					t.Errorf("unexpected request %s", request.URL.Path)
					http.NotFound(writer, request)
				}
			}))
			defer server.Close()
			input := jiasuTestInput("sd-2.5-j2-V")
			input.Config.BaseURL = server.URL
			ctx := context.Background()
			var cancel context.CancelFunc
			wanted := 2 * time.Hour
			if explicitDeadline {
				wanted = 20 * time.Minute
				ctx, cancel = context.WithTimeout(ctx, wanted)
				defer cancel()
			}
			policy := fastVideoPollPolicy()
			policy.Sleep = func(ctx context.Context, _ time.Duration) error {
				sleeps++
				deadline, ok := ctx.Deadline()
				if remaining := time.Until(deadline); !ok || remaining < wanted-time.Minute || remaining > wanted {
					t.Fatalf("poll deadline = %s, want approximately %s", remaining, wanted)
				}
				return ctx.Err()
			}
			result, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
			if err == nil || !strings.Contains(err.Error(), "生成失败，请稍后重试") || !strings.Contains(err.Error(), "task-jiasu-failed") || errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("explicit provider failure was not preserved: %#v, %v", result, err)
			}
			if creates != 1 || polls != 3 || sleeps != 3 {
				t.Fatalf("request counts: create=%d poll=%d sleep=%d", creates, polls, sleeps)
			}
		})
	}
}
