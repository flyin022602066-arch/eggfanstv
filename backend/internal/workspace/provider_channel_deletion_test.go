package workspace

import (
	"encoding/json"
	"testing"
)

func TestDeletedBuiltinChannelStaysDeletedAfterReopen(t *testing.T) {
	directory := t.TempDir()
	store, err := NewProviderConfig(directory)
	if err != nil {
		t.Fatal(err)
	}
	initial, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	channels := initial.Config["channels"].([]any)
	kept := []any{}
	var removed any
	for _, raw := range channels {
		channel := raw.(map[string]any)
		if channel["id"] == "eggfans-sd2" {
			removed = channel
			continue
		}
		kept = append(kept, raw)
	}
	if removed == nil {
		t.Fatal("missing test channel")
	}
	initial.Config["channels"] = kept
	initial.Config["deletedChannelIds"] = []string{"eggfans-sd2"}
	body, _ := json.Marshal(initial.Config)
	if err := store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	reopened, _ := NewProviderConfig(directory)
	loaded, _, err := reopened.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range loaded.Config["channels"].([]any) {
		if raw.(map[string]any)["id"] == "eggfans-sd2" {
			t.Fatal("deleted channel was restored")
		}
	}
	if len(loaded.Config["channels"].([]any)) != len(kept) {
		t.Fatal("unrelated channels changed")
	}
	loaded.Config["channels"] = append(loaded.Config["channels"].([]any), removed)
	body, _ = json.Marshal(loaded.Config)
	if err := reopened.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	loaded, _, err = reopened.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	requireEffectiveChannel(t, loaded, "eggfans-sd2")
	if containsString(channelModelIDs(loaded.Config["deletedChannelIds"]), "eggfans-sd2") {
		t.Fatal("re-adding did not clear removal")
	}
}

func TestSaveDetectsRemovedPresetWithoutFrontendMarker(t *testing.T) {
	store, _ := NewProviderConfig(t.TempDir())
	initial, _, _ := store.LoadEffectiveModelConfig()
	body, _ := json.Marshal(initial.Config)
	if err := store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	initial.Config["channels"] = []any{}
	body, _ = json.Marshal(initial.Config)
	if err := store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	loaded, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Config["channels"].([]any)) != 0 {
		t.Fatal("backend restored explicitly deleted presets")
	}
}
