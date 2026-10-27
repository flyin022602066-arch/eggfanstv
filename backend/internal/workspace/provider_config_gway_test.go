package workspace

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/providerpreset"
)

func TestJiasuGatewayMigrationPreservesSettings(t *testing.T) {
	store, err := NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLocalModelConfig([]byte(`{"videoModel":"jiasu-video::sd-2.5-J3-doubao","videoSeconds":"30","channels":[{"id":"jiasu-video","baseUrl":"https://ai.jiasuapi.com/","catalogUrl":"https://ai.jiasuapi.com/pricing","apiKey":"gway-test-key","models":["sd-2.5-J3-doubao"]},{"id":"separate","interfaceType":"eggfans-sd2-video","baseUrl":"https://vip.eggfans.asia","apiKey":"separate-test-key","models":["sd-2.5-D"]},{"id":"custom-jiasu","interfaceType":"jiasu-video","baseUrl":"https://custom.example.com","catalogUrl":"https://custom.example.com/catalog","apiKey":"custom-test-key","models":["custom-video"]}]}`)); err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 2; iteration++ {
		body, err := store.ReadLocalModelConfig()
		if err != nil {
			t.Fatal(err)
		}
		var config struct {
			VideoModel   string `json:"videoModel"`
			VideoSeconds string `json:"videoSeconds"`
			Channels     []struct {
				ID         string   `json:"id"`
				BaseURL    string   `json:"baseUrl"`
				CatalogURL string   `json:"catalogUrl"`
				APIKey     string   `json:"apiKey"`
				Models     []string `json:"models"`
			} `json:"channels"`
		}
		if err := json.Unmarshal(body, &config); err != nil {
			t.Fatal(err)
		}
		if config.VideoModel != "jiasu-video::sd-2.5-J3-doubao" || config.VideoSeconds != "30" {
			t.Fatal("saved video settings changed")
		}
		for _, channel := range config.Channels {
			switch channel.ID {
			case "jiasu-video":
				if channel.BaseURL != "https://www.gway.dev" || channel.CatalogURL != "https://www.gway.dev/pricing" || channel.APIKey != "gway-test-key" {
					t.Fatal("Jiasu endpoint migration failed or changed credentials")
				}
			case "separate":
				if channel.BaseURL != "https://vip.eggfans.asia" || channel.APIKey != "separate-test-key" {
					t.Fatal("another channel changed")
				}
			case "custom-jiasu":
				if channel.BaseURL != "https://custom.example.com" || channel.CatalogURL != "https://custom.example.com/catalog" || channel.APIKey != "custom-test-key" {
					t.Fatal("a custom gateway changed")
				}
			}
		}
		if err := store.SaveLocalModelConfig(body); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGwayPresetRemovesRetiredJiasuModelsWithoutRestoringThem(t *testing.T) {
	var preset providerpreset.ChannelPreset
	for _, item := range providerpreset.BuiltinChannels() {
		if item.ID == "jiasu-video" {
			preset = item
			break
		}
	}
	merged, err := presetChannelMap(preset, map[string]any{
		"models": []any{"sd-2.5-J3-doubao", "dola-sd-2.5", "minimax-h3", "user-added-retired-model"},
		"modelProfiles": []any{
			map[string]any{"model": "sd-2.5-J3-doubao", "protocol": "jiasu-video"},
			map[string]any{"model": "minimax-h3", "protocol": "jiasu-video"},
		},
		"presetVersion": float64(2),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := channelModelIDs(merged["models"]); len(got) != 1 || got[0] != "minimax-h3" {
		t.Fatalf("migrated Gway models = %#v", got)
	}
	profiles, _ := merged["modelProfiles"].([]any)
	if len(profiles) != 1 {
		t.Fatalf("migrated Gway profiles = %#v", profiles)
	}
	if merged["presetVersion"] != 3 {
		t.Fatalf("Gway preset version = %#v", merged["presetVersion"])
	}
}
