package modelcatalog

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

var nonoExistingVideoModels = map[string]bool{
	"按条特惠seedance-2.5-720P 满血":   true,
	"按条福利seedance-2.5-720P":      true,
	"按条seedance-2.5-720P 只支持参考图": true,
}

func TestNonoExistingVideoModelsAndPrices(t *testing.T) {
	body, err := os.ReadFile("testdata/nono-models.json")
	if err != nil {
		t.Fatal(err)
	}
	items, err := LoadChannelModelCatalog(context.Background(), func(context.Context, string, string, string, []ChannelHeader) ([]byte, error) { return body, nil }, "https://sub-tz.top/prod-api/v1", "openai", "synthetic-key", nil, nil)
	if err != nil || len(items) != 3 {
		t.Fatalf("catalog: %#v %v", items, err)
	}
	prices := map[string]string{"按条特惠seedance-2.5-720P 满血": "5.5积分/条", "按条福利seedance-2.5-720P": "4.8积分/条", "按条seedance-2.5-720P 只支持参考图": "3.5积分/条"}
	for _, item := range items {
		if item.ModelType != "video" || !strings.Contains(item.DisplayName, prices[item.ID]) || item.SupportedEndpointTypes[0] != "nono-video" {
			t.Fatalf("identity/pricing: %#v", item)
		}
		var video VideoCapabilityConfig
		if err := json.Unmarshal(item.VideoCapabilities, &video); err != nil {
			t.Fatal(err)
		}
		if video.Duration.Max != 30 || video.Resolutions[0] != "720p" {
			t.Fatalf("duration/resolution: %#v", video)
		}
		if video.References.PromptMaxChars != 15000 {
			t.Fatalf("prompt limit: %d", video.References.PromptMaxChars)
		}
		if strings.Contains(item.ID, "只支持参考图") && (video.Duration.Min != 30 || video.References.MaxImages != 9 || video.References.MaxVideos != 0 || video.References.MaxAudios != 0) {
			t.Fatalf("image-only variant polluted: %#v", video)
		}
	}
	if IsNonoBaseURL("https://other.example/prod-api/v1") || IsNonoBaseURL("https://sub-tz.top/v1") {
		t.Fatal("provider URL boundary changed")
	}
	items, err = ParseNonoVideoCatalog([]byte(`{"data":[{"id":"gpt-image","type":"IMAGE"},{"id":"other-video","type":"VIDEO"}]}`))
	if err != nil || len(items) != 1 || items[0].ID != "other-video" {
		t.Fatalf("video type filter: %#v %v", items, err)
	}
}

func TestNonoCatalogDiscoversEveryVideoModelAndSpecPrice(t *testing.T) {
	items, err := ParseNonoVideoCatalog([]byte(`{"data":[
		{"id":"new-video","type":"VIDEO","specs":[
			{"code":"1080p","price_credits":0.8,"billing_unit":"SECOND","default_params":{"resolution":"1080p"},"allowed_params":{"resolution":["1080p"]}},
			{"code":"720p","price_credits":6,"billing_unit":"REQUEST"}]},
		{"id":"new-video","type":"VIDEO","specs":[]},
		{"id":"future-model","type":"video","specs":[{"code":"4k","price_credits":0,"billing_unit":"VIDEO","default_params":{"resolution":"4k"}}]},
		{"id":"metered-video","type":"VIDEO","specs":[{"code":"standard","price_credits":2,"billing_unit":"FRAME"}]},
		{"id":"unquoted-video","type":"VIDEO"},
		{"id":"missing-unit","type":"VIDEO","specs":[{"code":"standard","price_credits":3}]},
		{"id":"negative-price","type":"VIDEO","specs":[{"code":"standard","price_credits":-1,"billing_unit":"REQUEST"}]},
		{"id":"image-only","type":"IMAGE"},
		{"id":"text-only","type":"TEXT"},
		{"id":"audio-only","type":"AUDIO"},
		{"id":"","type":"VIDEO"}
	]}`))
	if err != nil || len(items) != 6 {
		t.Fatalf("all video models: %#v %v", items, err)
	}
	expected := map[string][]string{
		"new-video":      {"1080p 0.8积分/秒", "720p 6积分/条"},
		"future-model":   {"0积分/条"},
		"metered-video":  {"2积分/FRAME"},
		"unquoted-video": {"价格未提供"},
		"missing-unit":   {"3积分", "计费单位未提供"},
		"negative-price": {"价格未提供"},
	}
	for _, item := range items {
		for _, fragment := range expected[item.ID] {
			if !strings.Contains(item.DisplayName, fragment) {
				t.Fatalf("incorrect price for %s: %s", item.ID, item.DisplayName)
			}
		}
		if item.ModelType != "video" || item.SupportedEndpointTypes[0] != "nono-video" {
			t.Fatalf("protocol changed: %#v", item)
		}
		if item.ID == "new-video" || item.ID == "future-model" {
			var video VideoCapabilityConfig
			if err := json.Unmarshal(item.VideoCapabilities, &video); err != nil {
				t.Fatal(err)
			}
			want := "720p"
			if item.ID == "future-model" {
				want = "4k"
			}
			if video.DefaultResolution != want {
				t.Fatalf("resolution for %s: %s != %s", item.ID, video.DefaultResolution, want)
			}
		}
	}
}

func TestNonoCatalogRefreshUsesLatestPriceAndDoesNotKeepMissingQuotes(t *testing.T) {
	responses := []string{
		`{"data":[{"id":"new-video","type":"VIDEO","specs":[{"code":"720p","billing_unit":"REQUEST","price_credits":5.5}]}]}`,
		`{"data":[{"id":"new-video","type":"VIDEO","specs":[{"code":"720p","billing_unit":"REQUEST","price_credits":4.2}]}]}`,
		`{"data":[{"id":"new-video","type":"VIDEO","specs":[{"code":"720p","billing_unit":"REQUEST"}]}]}`,
	}
	for index, response := range responses {
		items, err := LoadChannelModelCatalog(context.Background(), func(context.Context, string, string, string, []ChannelHeader) ([]byte, error) {
			return []byte(response), nil
		}, "https://sub-tz.top/prod-api/v1", "openai", "synthetic-key", nil, nil)
		if err != nil || len(items) != 1 {
			t.Fatalf("refresh %d: %#v %v", index, items, err)
		}
		want := []string{"5.5积分/条", "4.2积分/条", "价格未提供"}[index]
		if !strings.Contains(items[0].DisplayName, want) {
			t.Fatalf("refresh %d price: %s", index, items[0].DisplayName)
		}
	}
}

func TestNonoPromptLimitAndSavedProfile(t *testing.T) {
	for name := range nonoExistingVideoModels {
		profile := DefaultModelCapabilityConfigForModel("nono-video", name).Video
		if profile.References.PromptMaxChars != 15000 {
			t.Fatalf("%s default limit: %d", name, profile.References.PromptMaxChars)
		}
		profile.References.PromptMaxChars = 0
		profile = applyModelSpecificVideoCapability(profile, "nono-video", name)
		if profile.References.PromptMaxChars != 15000 {
			t.Fatalf("%s saved limit: %d", name, profile.References.PromptMaxChars)
		}
		prompt := strings.Repeat("文", 14999) + "😀"
		if err := validateModelPromptLength("视频", prompt, profile.References.PromptMaxChars); err != nil {
			t.Fatal(err)
		}
		if err := validateModelPromptLength("视频", prompt+"字", profile.References.PromptMaxChars); err == nil {
			t.Fatal("15001 characters accepted")
		}
	}
}

func TestNonoDefersModelLimitsToUpstream(t *testing.T) {
	for name := range nonoExistingVideoModels {
		t.Run(name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("nono-video", name)
			profile.Video.References = VideoReferenceConfig{PromptMaxChars: 1, MaxImages: 1, MaxVideos: 0, MaxAudios: 0, MaxImageBytes: 1}
			input := TaskInput{Mode: "video", Prompt: strings.Repeat("文", 15001), Config: TaskConfig{InterfaceType: "nono-video", Model: name, VideoSeconds: "30", Size: "9:16", VQuality: "720p", CapabilityConfig: profile}}
			input.ReferenceImages = make([]MediaRef, 31)
			input.ReferenceVideos = make([]MediaRef, 11)
			input.ReferenceAudios = make([]MediaRef, 11)
			for index := range input.ReferenceImages {
				input.ReferenceImages[index].Bytes = 50 * 1024 * 1024
			}
			if _, err := ValidateConfiguredTask(input, nil); err != nil {
				t.Fatalf("local model gate rejected nono: %v", err)
			}
			if err := ValidateVideoReferenceMedia(profile.Video, input); err != nil {
				t.Fatalf("execution media gate rejected nono: %v", err)
			}
			if err := ValidateVideoTaskParameters(profile.Video, input); err != nil {
				t.Fatalf("execution parameter gate rejected nono: %v", err)
			}
			input.Config.InterfaceType = "kanhai-video"
			if err := ValidateVideoReferenceMedia(profile.Video, input); err == nil {
				t.Fatal("nono bypass leaked into another channel")
			}
		})
	}
}
