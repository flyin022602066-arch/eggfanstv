package generation

import (
	"testing"

	"infinite-canvas/backend/internal/modelcatalog"
)

func TestGwayNewCatalogModelIsNotRejectedByLegacyWhitelist(t *testing.T) {
	input := Input{Mode: "video", Config: Config{InterfaceType: "jiasu-video", Model: "minimax-h3-官", VideoSeconds: "20", VQuality: "768p", Size: "16:9"}}
	if err := ValidateJiasuVideoInput(input); err != nil {
		t.Fatalf("public model rejected locally: %v", err)
	}
}

func TestGwayUsesSpecificCatalogReferenceLimitsWithoutDroppingInputs(t *testing.T) {
	video := modelcatalog.DefaultModelCapabilityConfigForModel("jiasu-video", "seedance-2.5-g5-v3").Video
	video.References.MaxImages, video.References.MaxVideos, video.References.MaxAudios = 10, 0, 5
	input := Input{Mode: "video", Config: Config{InterfaceType: "jiasu-video", Model: "seedance-2.5-g5-v3"}, VideoCapability: video}
	for index := 0; index < 10; index++ {
		input.ReferenceImages = append(input.ReferenceImages, Media{URL: "https://cdn.example/ref.png"})
	}
	if err := ValidateJiasuVideoInput(input); err != nil {
		t.Fatal(err)
	}
	input.ReferenceVideos = []Media{{URL: "https://cdn.example/ref.mp4"}}
	if err := ValidateJiasuVideoInput(input); err == nil {
		t.Fatal("reference video unsupported by this specific model accepted")
	}
	if len(input.ReferenceImages) != 10 || len(input.ReferenceVideos) != 1 {
		t.Fatal("validation silently changed material bindings")
	}
}
