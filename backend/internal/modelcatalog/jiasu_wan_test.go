package modelcatalog

import (
	"reflect"
	"testing"
)

func TestJiasuWanDiscountCapabilityAndLegacyProfile(t *testing.T) {
	for _, name := range []string{"wan3-特惠", "WAN3-特惠"} {
		t.Run(name, func(t *testing.T) {
			defaults := DefaultModelCapabilityConfigForModel("jiasu-video", name)
			stale := DefaultModelCapabilityConfigForModel("jiasu-video", "dola-sd-2.0")
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "jiasu-video", name, stale)
			if err != nil {
				t.Fatal(err)
			}
			for _, profile := range []*ModelCapabilityConfig{defaults, normalized} {
				if profile.Video.Duration.Min != 5 || profile.Video.Duration.Max != 30 || profile.Video.Duration.Default != 5 {
					t.Fatalf("Wan duration = %#v", profile.Video.Duration)
				}
				if !reflect.DeepEqual(profile.Video.Ratios, []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}) || !reflect.DeepEqual(profile.Video.Resolutions, []string{"1080p"}) || profile.Video.DefaultResolution != "1080p" {
					t.Fatalf("Wan output profile = %#v", profile.Video)
				}
			}
			input := TaskInput{Mode: "video", Prompt: "主角走进庭院", Config: TaskConfig{InterfaceType: "jiasu-video", Model: name, VideoSeconds: "30", Size: "21:9", VQuality: "1080p", CapabilityConfig: stale}}
			if _, err := ValidateConfiguredTask(input, nil); err != nil {
				t.Fatalf("30-second Wan task rejected: %v", err)
			}
			for _, seconds := range []string{"5", "6", "29", "30"} {
				input.Config.VideoSeconds = seconds
				for _, ratio := range defaults.Video.Ratios {
					input.Config.Size = ratio
					if _, err := ValidateConfiguredTask(input, nil); err != nil {
						t.Fatalf("Wan %ss %s rejected: %v", seconds, ratio, err)
					}
				}
			}
			for _, seconds := range []string{"4", "31", "5.5"} {
				input.Config.VideoSeconds = seconds
				if _, err := ValidateConfiguredTask(input, nil); err == nil {
					t.Fatalf("invalid Wan duration accepted: %s", seconds)
				}
			}
			if stale.Video.Duration.Max != 15 || !reflect.DeepEqual(stale.Video.Resolutions, []string{"480p", "720p", "1080p"}) {
				t.Fatal("normalizing Wan mutated another model's profile")
			}
		})
	}
}
