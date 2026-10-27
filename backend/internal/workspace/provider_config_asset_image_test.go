package workspace

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestProviderConfigRestoresIndependentAssetImagePresetsAfterReopen(t *testing.T) {
	dir := t.TempDir()
	store, err := NewProviderConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"channels":[{"id":"asset-images","name":"Images","baseUrl":"https://example.invalid","apiKey":"offline-secret","models":["gpt-image-2","gpt-image-1"]}],"projectAssetImagePresets":{"character":{"model":"asset-images::gpt-image-2","size":"3072x2048","quality":"high","extraPrompt":"头部特写与身体三视图"},"environment":{"model":"asset-images::gpt-image-1","size":"1536x1024","quality":"medium","extraPrompt":"场景中不添加人物"},"prop":{"model":"asset-images::gpt-image-2","size":"1024x1024","quality":"auto","extraPrompt":"完整展示道具"}}}`)
	if err := store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewProviderConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	effective, health, err := reopened.LoadEffectiveModelConfig()
	if err != nil || health != ConfigHealthReady {
		t.Fatalf("reopen failed: health=%s error=%v", health, err)
	}
	var expected map[string]any
	if err := json.Unmarshal(body, &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(effective.Config["projectAssetImagePresets"], expected["projectAssetImagePresets"]) {
		t.Fatal("asset category parameters changed after reopening the desktop configuration")
	}
	redacted, err := reopened.ReadRedactedModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.SaveLocalModelConfig(redacted); err != nil {
		t.Fatal(err)
	}
	effective, _, err = reopened.LoadEffectiveModelConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(effective.Config["projectAssetImagePresets"], expected["projectAssetImagePresets"]) || requireEffectiveChannel(t, effective, "asset-images")["apiKey"] != "offline-secret" {
		t.Fatal("saving image parameters must preserve independent category settings and existing credentials")
	}
}
