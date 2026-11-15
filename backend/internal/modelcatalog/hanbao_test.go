package modelcatalog

import "testing"

func TestHanbaoAudioDefaultsAndStoredCapabilities(t *testing.T) {
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_mini", "seedance_v2.0"} {
		t.Run(name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("hanbao-video", name)
			if !profile.Video.GenerateAudio.Supported || !profile.Video.GenerateAudio.Default {
				t.Fatal("Hanbao must default to synchronized audio")
			}
			profile.Video.GenerateAudio = VideoBooleanConfig{}
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "hanbao-video", name, profile)
			if err != nil {
				t.Fatal(err)
			}
			if !normalized.Video.GenerateAudio.Supported || !normalized.Video.GenerateAudio.Default {
				t.Fatal("stored silent capability must not override automatic audio")
			}
			input := TaskInput{Mode: "video", Prompt: "fixture", Config: TaskConfig{InterfaceType: "hanbao-video", Model: name, VideoSeconds: "5", Size: "16:9", CapabilityConfig: normalized}}
			if _, err := ValidateConfiguredTask(input, nil); err != nil {
				t.Fatal("audible Hanbao task rejected:", err)
			}
		})
	}
}

func TestHanbaoTaskAdmissionUsesFixedCapabilities(t *testing.T) {
	base := TaskInput{Mode: "video", Prompt: "fixture", Config: TaskConfig{InterfaceType: "hanbao-video", Model: "seedance_v2.5", VideoSeconds: "5", Size: "16:9"}}
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_mini", "seedance_v2.0"} {
		input := base
		input.Config.Model = name
		if _, err := ValidateConfiguredTask(input, nil); err != nil {
			t.Fatal(name, err)
		}
	}
	for _, scenario := range []string{"unknown-model", "image", "audio", "remote-channel", "duration", "ratio"} {
		t.Run(scenario, func(t *testing.T) {
			input := base
			switch scenario {
			case "unknown-model":
				input.Config.Model = "unknown"
			case "image", "audio":
				input.Mode = scenario
			case "remote-channel":
				input.Config.ChannelID = "other"
			case "duration":
				input.Config.VideoSeconds = "31"
			case "ratio":
				input.Config.Size = "21:9"
			}
			if _, err := ValidateConfiguredTask(input, nil); err == nil {
				t.Fatal("unsupported task was admitted")
			}
		})
	}
}

func TestHanbaoAdmitsNineLarge4KReferenceImages(t *testing.T) {
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_mini", "seedance_v2.0"} {
		t.Run(name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("hanbao-video", name)
			profile.Video.References.MaxImageBytes = 4 << 20
			profile.Video.References.MaxTotalBytes = 4 << 20
			profile.Video.References.MaxImages = 10
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "hanbao-video", name, profile)
			if err != nil {
				t.Fatal(err)
			}
			if normalized.Video.References.MaxImages != 9 || normalized.Video.References.MaxImageBytes != 0 || normalized.Video.References.MaxTotalBytes != 0 {
				t.Fatalf("stale Hanbao image limits retained: %+v", normalized.Video.References)
			}
			input := TaskInput{Mode: "video", Prompt: "fixture", Config: TaskConfig{InterfaceType: "hanbao-video", Model: name, VideoSeconds: "8", Size: "9:16", CapabilityConfig: profile}}
			for index := 0; index < 9; index++ {
				input.ReferenceImages = append(input.ReferenceImages, MediaRef{Bytes: 18 << 20, Width: 3840, Height: 2160})
			}
			if _, err := ValidateConfiguredTask(input, nil); err != nil {
				t.Fatal("large originals rejected before the component:", err)
			}
			input.ReferenceImages = append(input.ReferenceImages, input.ReferenceImages[0])
			if _, err := ValidateConfiguredTask(input, nil); err == nil {
				t.Fatal("ten references were accepted")
			}
			if profile.Video.References.MaxImageBytes != 4<<20 {
				t.Fatal("normalization mutated the stored profile")
			}
		})
	}
}
