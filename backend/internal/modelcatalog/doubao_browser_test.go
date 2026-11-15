package modelcatalog

import (
	"strings"
	"testing"
)

func TestDoubaoBrowserFixedTaskCapabilities(t *testing.T) {
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini"} {
		profile := DefaultModelCapabilityConfigForModel("doubao-browser-video", name)
		maximum := 15
		if name == "seedance_v2.5" {
			maximum = 30
		}
		if profile.Video.Duration.Max != maximum || profile.Video.References.MaxImages != 10 || profile.Video.References.PromptMaxChars != 8000 {
			t.Fatalf("incorrect native capability for %s: %+v", name, profile.Video)
		}
		input := TaskInput{Mode: "video", Prompt: "fixture", Config: TaskConfig{InterfaceType: "doubao-browser-video", Model: name, VideoSeconds: "12", Size: "9:16"}}
		if _, err := ValidateConfiguredTask(input, nil); err != nil {
			t.Fatal(err)
		}
		input.Config.VideoSeconds = "31"
		if _, err := ValidateConfiguredTask(input, nil); err == nil {
			t.Fatal("invalid duration admitted")
		}
		input.Config.VideoSeconds = "12"
		input.Config.ChannelID = "remote"
		if _, err := ValidateConfiguredTask(input, nil); err == nil {
			t.Fatal("remote channel admitted")
		}
	}
}

func TestDoubaoBrowserPromptCharacterBoundary(t *testing.T) {
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini"} {
		input := TaskInput{Mode: "video", Prompt: strings.Repeat("镜\U0001F3AC", 4000), Config: TaskConfig{InterfaceType: "doubao-browser-video", Model: name, VideoSeconds: "15", Size: "16:9"}}
		if _, err := ValidateConfiguredTask(input, nil); err != nil {
			t.Fatalf("8000 characters rejected for %s: %v", name, err)
		}
		input.Prompt += "镜"
		if _, err := ValidateConfiguredTask(input, nil); err == nil {
			t.Fatalf("8001 characters accepted for %s", name)
		}
	}
}
