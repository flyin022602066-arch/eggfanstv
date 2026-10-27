package protocol

import (
	"context"
	"testing"
)

func TestJiasuOfficialVideoLifecycle(t *testing.T) {
	adapter := officialPackageAdapter(t, "jiasu-video.beeftv-plugin", "jiasu-video")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-jiasu","status":"queued"}`))
	if err != nil || created.TaskID != "task-jiasu" || created.Status != StatusPending {
		t.Fatalf("create = %#v, %v", created, err)
	}
	ctx := PollContext{TaskID: created.TaskID}
	spec, err := adapter.BuildPoll(context.Background(), ctx)
	if err != nil || spec.Path != "/v1/videos/tasks/task-jiasu" || spec.Method != "GET" {
		t.Fatalf("query = %#v, %v", spec, err)
	}
	processing, err := adapter.ParsePoll(context.Background(), ctx, []byte(`{"status":"in_progress","progress":47}`))
	if err != nil || processing.Status != StatusProcessing {
		t.Fatalf("processing = %#v, %v", processing, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), ctx, []byte(`{"status":"completed","result_urls":["https://cdn.example/1.mp4","https://cdn.example/2.mp4"]}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 2 || completed.Result.Videos[0].URL != "https://cdn.example/1.mp4" {
		t.Fatalf("completed = %#v, %v", completed, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), ctx, []byte(`{"status":"failed","error":{"code":"INVALID_INPUT","message":"reference invalid"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "reference invalid" {
		t.Fatalf("failed = %#v, %v", failed, err)
	}
}

func TestJiasuPackagedJ1Model(t *testing.T) {
	adapter := officialPackageAdapter(t, "jiasu-video.beeftv-plugin", "jiasu-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Capability: CapabilityVideo, Model: "sd-2.0-mini-J1", Prompt: "人物说你好", Duration: 5, GenerateAudio: true}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["model"] != "sd-2.0-mini-J1" || body["generate_audio"] != nil {
		t.Fatalf("J1 automatic audio contract = %#v", body)
	}
}

func TestJiasuNamespacedOptionsPreserveFalseAndIsolateProviders(t *testing.T) {
	adapter := officialPackageAdapter(t, "jiasu-video.beeftv-plugin", "jiasu-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Capability: CapabilityVideo, Model: "dola-sd-2.5", Prompt: "scene", Duration: 30,
		ProviderOptions: map[string]map[string]any{
			"jiasu-video":       {"face": map[string]any{"enabled": false}},
			"eggfans-sd2-video": {"native_face": true},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["duration"] != float64(30) {
		t.Fatalf("30-second duration changed: %#v", body["duration"])
	}
	face, present := body["face"].(map[string]any)
	if !present || face["enabled"] != false || body["native_face"] != nil {
		t.Fatalf("namespaced options = %#v", body)
	}
}

func TestJiasuPackagedSeedance25FullModalReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "jiasu-video.beeftv-plugin", "jiasu-video")
	for _, modelName := range []string{"sd-2.5-j2-V", "sd-2.5-J2"} {
		t.Run(modelName, func(t *testing.T) {
			request := GenerationRequest{Capability: CapabilityVideo, Model: modelName, Prompt: "@图片1 @视频1 @音频1", Duration: 30, Resolution: "720p", AspectRatio: "16:9"}
			for index := 0; index < 30; index++ {
				request.Images = append(request.Images, MediaReference{URL: "https://cdn.example/image.png", Role: "reference_image"})
			}
			for index := 0; index < 10; index++ {
				request.Videos = append(request.Videos, MediaReference{URL: "https://cdn.example/video.mp4"})
				request.Audios = append(request.Audios, MediaReference{URL: "https://cdn.example/audio.mp3"})
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["model"] != modelName || body["duration"] != float64(30) || len(body["images"].([]any)) != 30 || len(body["videos"].([]any)) != 10 || len(body["audios"].([]any)) != 10 {
				t.Fatalf("packaged plugin changed full-modal input: %#v", body)
			}
		})
	}
}

func TestJiasuPackagedImageReferenceBoundaries(t *testing.T) {
	adapter := officialPackageAdapter(t, "jiasu-video.beeftv-plugin", "jiasu-video")
	for _, scenario := range []struct {
		model   string
		maximum int
	}{
		{"dola-sd-2.5", 30},
		{"sd-2.5-j2-V", 30},
		{"vendor/SD2.5-fast", 30},
		{"dola-sd-2.0", 10},
		{"minimax-h3", 10},
	} {
		t.Run(scenario.model, func(t *testing.T) {
			request := GenerationRequest{Capability: CapabilityVideo, Model: scenario.model, Prompt: "@图片1", Duration: 5, Resolution: "720p", AspectRatio: "16:9"}
			for index := 0; index < scenario.maximum; index++ {
				request.Images = append(request.Images, MediaReference{URL: "https://cdn.example/image.png", Role: "reference_image"})
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["model"] != scenario.model || len(body["images"].([]any)) != scenario.maximum {
				t.Fatalf("model ID or references changed: %#v", body)
			}
			request.Images = append(request.Images, MediaReference{URL: "https://cdn.example/overflow.png", Role: "reference_image"})
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("image overflow accepted")
			}
		})
	}
}
