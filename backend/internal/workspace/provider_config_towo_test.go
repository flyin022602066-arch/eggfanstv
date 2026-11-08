package workspace

import "testing"

func TestTowoPresetMergesWithoutChangingGwayChannel(t *testing.T) {
	config, err := mergeBuiltinProviderPresets(map[string]any{
		"channels": []any{
			map[string]any{
				"id": "jiasu-video",
				"name": "极途 Gway",
				"baseUrl": "https://www.gway.dev",
				"catalogUrl": "https://www.gway.dev/pricing",
				"apiKey": "gway-key",
				"models": []any{"minimax-h3"},
			},
			map[string]any{
				"id": "towo-sd25-video",
				"baseUrl": "https://towoapi.com",
				"apiKey": "towo-key",
				"models": []any{"seedance-2.5", "unrequested-model"},
				"modelProfiles": []any{
					map[string]any{"model": "seedance-2.5", "capability": "video", "protocol": "towo-sd25-video"},
					map[string]any{"model": "unrequested-model", "capability": "video", "protocol": "newapi"},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	channels, _ := config["channels"].([]any)
	byID := make(map[string]map[string]any, len(channels))
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := channel["id"].(string)
		byID[id] = channel
	}
	gway := byID["jiasu-video"]
	if gway == nil || gway["baseUrl"] != "https://www.gway.dev" || gway["apiKey"] != "gway-key" {
		t.Fatalf("Gway channel changed: %#v", gway)
	}
	towo := byID["towo-sd25-video"]
	if towo == nil || towo["baseUrl"] != "https://towoapi.com" || towo["apiKey"] != "towo-key" {
		t.Fatalf("Towo channel missing or changed: %#v", towo)
	}
	models, _ := towo["models"].([]string)
	if len(models) != 1 || models[0] != "seedance-2.5" {
		t.Fatalf("Towo models = %#v", models)
	}
	profiles, _ := towo["modelProfiles"].([]any)
	if len(profiles) != 1 {
		t.Fatalf("Towo profiles = %#v", profiles)
	}
	profile, _ := profiles[0].(map[string]any)
	if profile["protocol"] != "towo-sd25-video" || profile["capability"] != "video" {
		t.Fatalf("Towo profile = %#v", profile)
	}
}
