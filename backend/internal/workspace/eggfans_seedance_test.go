package workspace

import (
	"encoding/json"
	"testing"
)

func TestEggfansSeedanceMappingsSurviveReadSaveAndRestart(t *testing.T) {
	store, err := NewProviderConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	input := []byte(`{"videoModel":"beefapi::doubao-seedance-2-5-260628","channels":[{"id":"beefapi","baseUrl":"https://api.eggfans.com","apiKey":"test-key","headers":[{"name":"X-Custom","value":"yes"}],"models":["doubao-seedance-2-5-260628","doubao-seedance-2-0-fast-260128","grok-video"],"modelProfiles":[{"model":"grok-video","protocol":"newapi-channel-2","capability":"video"},{"model":"doubao-seedance-2-5-260628","protocol":"newapi-channel-2","capability":"video"},{"model":"doubao-seedance-2-0-fast-260128","protocol":"eggfans-volc-video","capability":"video"}]}]}`)
	if err := store.SaveLocalModelConfig(input); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		store, err = NewProviderConfig(store.dataDir)
		if err != nil {
			t.Fatal(err)
		}
		effective, _, err := store.LoadEffectiveModelConfig()
		if err != nil {
			t.Fatal(err)
		}
		channels := effective.Config["channels"].([]any)
		for _, raw := range channels {
			channel := raw.(map[string]any)
			if channel["id"] != "beefapi" {
				continue
			}
			if channel["apiKey"] != "test-key" || channel["baseUrl"] != "https://api.eggfans.com" {
				t.Fatal("credentials changed")
			}
			for _, value := range channel["modelProfiles"].([]any) {
				profile := value.(map[string]any)
				expected := map[string]string{"doubao-seedance-2-5-260628": "eggfans-seedance-video", "doubao-seedance-2-0-fast-260128": "eggfans-volc-video", "grok-video": "newapi-channel-2"}[profile["model"].(string)]
				if expected != "" && profile["protocol"] != expected {
					t.Fatal("protocol was not persisted")
				}
			}
		}
		body, err := json.Marshal(effective.Config)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.SaveLocalModelConfig(body); err != nil {
			t.Fatal(err)
		}
	}
}
