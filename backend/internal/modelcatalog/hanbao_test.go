package modelcatalog

import "testing"

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
