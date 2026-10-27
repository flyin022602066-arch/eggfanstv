package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/workspace"
)

func TestVolcLibraryKeyIsRedactedAndPreservedOnConfigSave(t *testing.T) {
	router, store := newModelConfigTestRouter(t)
	if err := store.SaveLocalModelConfig([]byte(`{"volcAssetLibrary":{"enabled":true,"apiKey":"independent-upload-secret","baseUrl":"https://20nbifxd.magine.work/v1"}}`)); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
	if recorder.Code != http.StatusOK || bytes.Contains(recorder.Body.Bytes(), []byte("independent-upload-secret")) {
		t.Fatal("upload key exposed")
	}
	data := modelConfigResponseData(t, recorder)
	library := data["config"].(map[string]any)["volcAssetLibrary"].(map[string]any)
	if library["apiKey"] != workspace.RedactedSecret {
		t.Fatal("missing saved-key marker")
	}
	body, _ := json.Marshal(map[string]any{"config": data["config"], "expectedRevision": data["revision"]})
	write := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/workspace/model-config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(write, request)
	if write.Code != http.StatusOK {
		t.Fatalf("save failed: %s", write.Body.String())
	}
	saved, err := store.ReadLocalModelConfig()
	if err != nil || !bytes.Contains(saved, []byte("independent-upload-secret")) {
		t.Fatal("redacted save cleared the key")
	}
}
