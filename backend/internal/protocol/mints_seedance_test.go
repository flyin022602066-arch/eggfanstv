package protocol

import (
	"context"
	"testing"
)

func TestMintsSeedancePackagedAdapter(t *testing.T) {
	adapter := officialPackageAdapter(t, "mints-seedance.beeftv-plugin", "mints-seedance-video")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-test"}`))
	if err != nil || created.TaskID != "task-test" {
		t.Fatalf("create response: %#v %v", created, err)
	}
	for _, status := range []string{"pending", "queued", "processing", "running", "succeeded", "failed"} {
		state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-test"}, []byte(`{"status":"`+status+`","content":{"video_url":"https://cdn.example/video.mp4"}}`))
		if err != nil || state.TaskID != "task-test" {
			t.Fatalf("poll response %s: %#v %v", status, state, err)
		}
		if status == "succeeded" && state.Status != StatusSucceeded || status == "failed" && state.Status != StatusFailed {
			t.Fatalf("wrong terminal state: %#v", state)
		}
	}
}

func TestMintsSeedanceForwardsAudioChoice(t *testing.T) {
	adapter := officialPackageAdapter(t, "mints-seedance.beeftv-plugin", "mints-seedance-video")
	for _, test := range []struct {
		name    string
		enabled bool
	}{
		{name: "sound on", enabled: true},
		{name: "sound off", enabled: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Capability: CapabilityVideo, Model: "doubao-seedance-2-0-mini-260615", Prompt: "A bird sings", Duration: 5, GenerateAudio: test.enabled,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, create)
			if body["generate_audio"] != test.enabled {
				t.Fatalf("generate_audio = %#v, want %v", body["generate_audio"], test.enabled)
			}
		})
	}
}
