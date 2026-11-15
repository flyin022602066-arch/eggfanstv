package protocol

import (
	"context"
	"testing"
)

func TestKanhaiVideoNativeContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "kanhai-video.beeftv-plugin", "kanhai-video")
	request := GenerationRequest{Capability: CapabilityVideo, Model: "vs-sd 2.5-a", Prompt: "cinematic scene", Duration: 30, AspectRatio: "adaptive", Resolution: "720p", GenerateAudio: true,
		Images: []MediaReference{{URL: "https://h.uguu.se/one.png"}, {URL: "https://h.uguu.se/two.png"}}, Videos: []MediaReference{{URL: "https://cdn.example/video?sig=one%2Btwo"}}, Extra: map[string]any{"idempotencyKey": "stable-submission-123"}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/videos" || spec.Auth.Type != "bearer" || spec.Headers["Idempotency-Key"] != "stable-submission-123" || body["duration"] != float64(30) || body["ratio"] != "auto" || body["model"] != request.Model {
		t.Fatalf("wrong native contract: %#v %#v", spec, body)
	}
	for _, forbidden := range []string{"face", "native_face", "seconds", "enable_audio", "generate_audio", "reference_images", "images", "content", "files"} {
		if _, exists := body[forbidden]; exists {
			t.Fatalf("foreign parameter %s", forbidden)
		}
	}
	images := body["image_urls"].([]any)
	if len(images) != 2 || images[1] != "https://h.uguu.se/two.png" {
		t.Fatal("reference ordering changed")
	}
	for _, status := range []string{"submitting", "queued", "running"} {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "site-task"}, []byte(`{"status":"`+status+`","upstream_task_id":"foreign-task"}`))
		if err != nil || state.TaskID != "site-task" || state.Status == StatusFailed || state.Status == StatusSucceeded {
			t.Fatalf("wrong pending state: %#v %v", state, err)
		}
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "site-task"}, []byte(`{"status":"failed","failure_reason":"reference expired"}`))
	if err != nil || state.Status != StatusFailed || state.Message != "reference expired" {
		t.Fatalf("upstream failure lost: %#v %v", state, err)
	}
	request.Extra["kanhaiFiles"] = []any{map[string]any{"name": "motion.mp4", "url": "https://cdn.example/signed?token=abc%2B123", "seconds": 3.5}}
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	for _, forbidden := range []string{"image_urls", "video_urls", "audio_urls"} {
		if _, exists := body[forbidden]; exists {
			t.Fatalf("mixed files/legacy arrays: %s", forbidden)
		}
	}
	if body["files"].([]any)[0].(map[string]any)["seconds"] != 3.5 {
		t.Fatal("reference duration lost")
	}
}
