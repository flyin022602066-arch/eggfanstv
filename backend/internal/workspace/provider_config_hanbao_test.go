package workspace

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/providerpreset"
)

func TestHanbaoPresetKeepsNativeProtocolAndCannotAddRemoteModels(t *testing.T) {
	var preset providerpreset.ChannelPreset
	for _, item := range providerpreset.BuiltinChannels() {
		if item.ID == "hanbao" {
			preset = item
		}
	}
	result, err := presetChannelMap(preset, map[string]any{"models": []any{"other-model"}, "baseUrl": "https://evil.invalid", "apiKey": "fixture-secret"})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(result)
	if result["interfaceType"] != "hanbao-video" || result["apiKey"] != "" || result["baseUrl"] != "https://www.doubao.com" || len(result["models"].([]string)) != 3 {
		t.Fatal(string(body))
	}
}
