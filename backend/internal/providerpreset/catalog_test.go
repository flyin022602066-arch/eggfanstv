package providerpreset

import "testing"

func TestBeefAPIPresetIsPinnedWithoutFreezingRemoteModelCatalog(t *testing.T) {
	preset := BeefAPI()
	if preset.ID != "beefapi" {
		t.Fatalf("preset id = %q", preset.ID)
	}
	if preset.DisplayName != "Eggfans TV" || preset.BaseURL != "https://api.eggfans.com" || preset.CatalogURL != "https://api.eggfans.com/pricing" {
		t.Fatalf("unexpected BeefAPI identity: %#v", preset)
	}
	if preset.Pinned || preset.PresetVersion < 1 {
		t.Fatalf("preset must remain editable and versioned: %#v", preset)
	}

	if len(preset.Models) != 0 {
		t.Fatalf("remote BeefAPI catalog must be fetched, got %d hard-coded models", len(preset.Models))
	}
}

func TestCatalogValidationRejectsUnsafeOrAmbiguousPresets(t *testing.T) {
	valid := BeefAPI()
	valid.Models = []ModelProfile{{Model: "test", Capability: "text", Protocol: "chat-completion", CapabilityConfig: []byte(`{"version":1,"text":{"streaming":true}}`)}}
	tests := []struct {
		name   string
		mutate func(*ChannelPreset)
	}{
		{name: "duplicate model", mutate: func(preset *ChannelPreset) { preset.Models = append(preset.Models, preset.Models[0]) }},
		{name: "unknown protocol", mutate: func(preset *ChannelPreset) { preset.Models[0].Protocol = "mystery" }},
		{name: "missing capability", mutate: func(preset *ChannelPreset) { preset.Models[0].Capability = "" }},
		{name: "secret field", mutate: func(preset *ChannelPreset) { preset.Metadata = map[string]any{"apiKey": "must-not-ship"} }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := valid.Clone()
			test.mutate(&candidate)
			if err := Validate(candidate); err == nil {
				t.Fatal("invalid preset was accepted")
			}
		})
	}
}

func TestEggfansSD2PresetIncludesAllVideoModels(t *testing.T) {
	for _, preset := range BuiltinChannels() {
		if preset.ID != "eggfans-sd2" {
			continue
		}
		if preset.BaseURL != "https://vip.eggfans.asia" || preset.CatalogURL != "" || preset.Pinned {
			t.Fatal("SD2 must have its own editable endpoint and local catalog")
		}
		want := []string{"sd-2.5-A", "sd-2.5-B", "sd-2.5-C", "sd-2.5-D", "sd-2.5-E"}
		if len(preset.Models) != len(want) {
			t.Fatalf("SD2 model count = %d", len(preset.Models))
		}
		for index, profile := range preset.Models {
			if profile.Model != want[index] || profile.Capability != "video" || profile.Protocol != "eggfans-sd2-video" {
				t.Fatalf("unexpected SD2 model profile at %d", index)
			}
		}
		return
	}
	t.Fatal("SD2 built-in channel is missing")
}
