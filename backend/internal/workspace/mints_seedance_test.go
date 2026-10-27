package workspace

import "testing"

func TestMintsPresetKeepsSavedOptionsAndCredentials(t *testing.T) {
	input := map[string]any{"channels": []any{map[string]any{
		"id": "mints-seedance", "baseUrl": "https://custom-mints.example", "apiKey": "synthetic-key",
		"models":        []any{"doubao-seedance-2-0-260128", "platform-custom-2.5"},
		"modelProfiles": []any{map[string]any{"model": "doubao-seedance-2-0-260128", "protocol": "mints-seedance-video", "capability": "video", "defaultOptions": map[string]any{"asset_group_id": "verified-group", "seed": float64(0), "camera_fixed": false}}},
	}}}
	for attempt := 0; attempt < 2; attempt++ {
		merged, err := mergeBuiltinProviderPresets(input)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, raw := range merged["channels"].([]any) {
			channel := raw.(map[string]any)
			if channel["id"] != "mints-seedance" {
				continue
			}
			found = true
			if channel["apiKey"] != "synthetic-key" || channel["baseUrl"] != "https://custom-mints.example" {
				t.Fatal("saved credentials or URL were reset")
			}
			profile := channel["modelProfiles"].([]any)[0].(map[string]any)
			options, ok := profile["defaultOptions"].(map[string]any)
			if !ok || options["asset_group_id"] != "verified-group" || options["seed"] != float64(0) || options["camera_fixed"] != false {
				t.Fatal("saved binding and generation parameters were reset")
			}
		}
		if !found {
			t.Fatal("Mints preset missing")
		}
		input = merged
	}
}
