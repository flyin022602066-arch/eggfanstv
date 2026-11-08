package protocol

import (
	"context"
	"testing"
)

func TestOfficialTowoSD25VideoUsesIsolatedProtocol(t *testing.T) {
	adapter := officialPackageAdapter(t, "towo-sd25-video.beeftv-plugin", "towo-sd25-video")
	request := GenerationRequest{
		Capability:    CapabilityVideo,
		Model:         "seedance-2.5",
		Prompt:        "a cinematic conversation",
		Duration:      30,
		AspectRatio:   "adaptive",
		Resolution:    "1080p",
		GenerateAudio: true,
		Images: []MediaReference{
			{URL: "https://cdn.example/character.png", Role: "reference_image", Order: 0},
		},
		Videos: []MediaReference{{URL: "https://cdn.example/reference.mp4", Role: "reference_video"}},
		Audios: []MediaReference{{URL: "https://cdn.example/reference.mp3", Role: "reference_audio"}},
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos" || create.ContentType != "application/json" || create.Auth.Type != "bearer" {
		t.Fatalf("Towo create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != request.Model || body["prompt"] != request.Prompt || body["seconds"] != float64(30) || body["aspect_ratio"] != "adaptive" || body["resolution"] != "1080p" || body["enable_audio"] != true {
		t.Fatalf("Towo create fields = %#v", body)
	}
	for _, forbidden := range []string{"duration", "ratio", "generate_audio", "images", "videos", "audios", "face", "native_face"} {
		if _, exists := body[forbidden]; exists {
			t.Fatalf("Towo request must not contain %q: %#v", forbidden, body)
		}
	}
	images, _ := body["reference_images"].([]any)
	if len(images) != 1 || images[0].(map[string]any)["image_url"] != "https://cdn.example/character.png" {
		t.Fatalf("Towo reference_images = %#v", body["reference_images"])
	}
	videos, _ := body["reference_videos"].([]any)
	if len(videos) != 1 || videos[0].(map[string]any)["video_url"] != "https://cdn.example/reference.mp4" {
		t.Fatalf("Towo reference_videos = %#v", body["reference_videos"])
	}
	audios, _ := body["reference_audios"].([]any)
	if len(audios) != 1 || audios[0].(map[string]any)["audio_url"] != "https://cdn.example/reference.mp3" {
		t.Fatalf("Towo reference_audios = %#v", body["reference_audios"])
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-towo-1","status":"queued"}`))
	if err != nil || created.TaskID != "task-towo-1" || created.Status != StatusPending {
		t.Fatalf("Towo create result = %#v, %v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Request: request, TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/task-towo-1" {
		t.Fatalf("Towo poll = %#v, %v", poll, err)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{Request: request, TaskID: created.TaskID}, []byte(`{"id":"task-towo-1","status":"completed"}`))
	if err != nil || state.Status != StatusSucceeded || state.Result != nil {
		t.Fatalf("Towo poll result = %#v, %v", state, err)
	}
	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("Towo adapter must expose the authenticated content download")
	}
	content, err := resultAdapter.BuildResult(context.Background(), PollContext{Request: request, TaskID: created.TaskID})
	if err != nil || content.Method != "GET" || content.Path != "/v1/videos/task-towo-1/content" {
		t.Fatalf("Towo content = %#v, %v", content, err)
	}

	frames, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Capability: CapabilityVideo, Model: request.Model, Prompt: request.Prompt, Duration: request.Duration,
		Images: []MediaReference{
			{URL: "https://cdn.example/first.png", Role: "first_frame"},
			{URL: "https://cdn.example/last.png", Role: "last_frame"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	frameBody := manifestTestBody(t, frames)
	if frameBody["first_frame"].(map[string]any)["image_url"] != "https://cdn.example/first.png" || frameBody["last_frame"].(map[string]any)["image_url"] != "https://cdn.example/last.png" {
		t.Fatalf("Towo frame fields = %#v", frameBody)
	}
	if _, exists := frameBody["reference_images"]; exists {
		t.Fatalf("Towo frame mode must not send reference_images: %#v", frameBody)
	}
}
