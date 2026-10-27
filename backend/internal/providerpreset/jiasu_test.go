package providerpreset

import "testing"

func TestJiasuPresetUsesLiveGwayCatalog(t *testing.T) {
	for _, preset := range BuiltinChannels() {
		if preset.ID != "jiasu-video" {
			continue
		}
		if preset.BaseURL != "https://www.gway.dev" || preset.CatalogURL != "https://www.gway.dev/pricing" || preset.PresetVersion != 3 {
			t.Fatal("wrong Gway preset")
		}
		if len(preset.Models) != 0 {
			t.Fatal("legacy Jiasu models must not be restored by the built-in preset")
		}
		return
	}
	t.Fatal("Gway preset missing")
}
