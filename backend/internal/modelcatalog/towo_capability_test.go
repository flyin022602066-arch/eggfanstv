package modelcatalog

import "testing"

func TestTowoSD25VideoCapabilityMatchesDocumentedLimits(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("towo-sd25-video", "seedance-2.5")
	if profile.Video == nil {
		t.Fatal("Towo capability must expose video settings")
	}
	video := profile.Video
	if video.References.MaxImages != 30 || video.References.MaxVideos != 10 || video.References.MaxAudios != 10 {
		t.Fatalf("Towo reference limits = %#v", video.References)
	}
	if video.Duration.Min != 4 || video.Duration.Max != 30 || video.DefaultResolution != "720p" || !video.GenerateAudio.Default {
		t.Fatalf("Towo video capability = %#v", video)
	}
	if len(video.Ratios) != 7 || video.Ratios[len(video.Ratios)-1] != "adaptive" {
		t.Fatalf("Towo ratios = %#v", video.Ratios)
	}
}
