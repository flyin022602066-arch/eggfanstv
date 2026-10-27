package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

func TestWorkspaceModelConfigReturnsBuiltinBeefAPIAndPersistenceMetadata(t *testing.T) {
	router, _ := newModelConfigTestRouter(t)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	data := modelConfigResponseData(t, recorder)
	if data["health"] != string(workspace.ConfigHealthDefault) || data["revision"] != float64(0) || data["source"] != "builtin+local" {
		t.Fatalf("missing persistence metadata: %#v", data)
	}
	config, _ := data["config"].(map[string]any)
	channels, _ := config["channels"].([]any)
	var beefChannel map[string]any
	for _, raw := range channels {
		channel, _ := raw.(map[string]any)
		if channel["id"] == "beefapi" {
			beefChannel = channel
			break
		}
	}
	if beefChannel == nil {
		t.Fatal("builtin BeefAPI missing")
	}
	if models, _ := beefChannel["models"].([]any); len(models) != 0 {
		t.Fatalf("model catalog must remain dynamic: %#v", models)
	}
}

func TestWorkspaceModelConfigGETRestoresManuallyConfiguredKey(t *testing.T) {
	router, _ := newModelConfigTestRouter(t)
	first := putModelConfig(t, router, 0, "local-secret-key")
	if first.Code != http.StatusOK {
		t.Fatalf("put status = %d body=%s", first.Code, first.Body.String())
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte("local-secret-key")) {
		t.Fatal("manually configured key was not restored")
	}
	stale := putModelConfig(t, router, 1, "ui-overwrite")
	if stale.Code != http.StatusOK {
		t.Fatalf("second put status = %d body=%s", stale.Code, stale.Body.String())
	}
}

func TestWorkspaceModelConfigRejectsStaleRevisionWithoutLeakingSecrets(t *testing.T) {
	router, _ := newModelConfigTestRouter(t)
	first := putModelConfig(t, router, 0, "first-secret")
	if first.Code != http.StatusOK {
		t.Fatalf("first put status = %d body=%s", first.Code, first.Body.String())
	}
	if revision := modelConfigResponseData(t, first)["revision"]; revision != float64(1) {
		t.Fatalf("committed revision = %#v", revision)
	}

	stale := putModelConfig(t, router, 0, "must-not-leak")
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale put status = %d body=%s", stale.Code, stale.Body.String())
	}
	if bytes.Contains(stale.Body.Bytes(), []byte("must-not-leak")) || bytes.Contains(stale.Body.Bytes(), []byte("first-secret")) {
		t.Fatalf("error response leaked a secret: %s", stale.Body.String())
	}
}

func TestWorkspaceModelConfigRestoresDirectCredentialsWithoutBrowserCache(t *testing.T) {
	router, store := newModelConfigTestRouter(t)
	config := map[string]any{
		"channels": []any{
			map[string]any{"id": "beefapi", "name": "Eggfans TV", "baseUrl": "https://api.eggfans.com", "apiKey": "direct-eggfans-test-key", "secretKey": "direct-eggfans-test-secret", "models": []any{"gpt-image-2"}},
			map[string]any{"id": "jiasu-video", "apiKey": "direct-jiasu-test-key", "models": []any{"dola-sd-2.5"}},
		},
	}
	body, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("restore status = %d", recorder.Code)
		}
		data := modelConfigResponseData(t, recorder)
		restored := data["config"].(map[string]any)
		for _, raw := range restored["channels"].([]any) {
			channel := raw.(map[string]any)
			switch channel["id"] {
			case "beefapi":
				if channel["apiKey"] != "direct-eggfans-test-key" || channel["secretKey"] != "direct-eggfans-test-secret" {
					t.Fatal("direct Eggfans credentials were not restored from the workspace file")
				}
				if channel["baseUrl"] != "https://api.eggfans.com" || len(channel["models"].([]any)) != 1 {
					t.Fatal("direct Eggfans catalog or base URL changed during restore")
				}
			case "jiasu-video":
				if channel["apiKey"] != "direct-jiasu-test-key" {
					t.Fatal("independent video channel credential was not restored")
				}
			}
		}
	}
}

func TestWorkspaceModelConfigPersistsRefreshedDirectCatalog(t *testing.T) {
	router, store := newModelConfigTestRouter(t)
	if err := store.SaveLocalModelConfig([]byte(`{"channels":[{"id":"beefapi","baseUrl":"https://api.eggfans.com","apiKey":"offline-key","models":["old-model"]}]}`)); err != nil {
		t.Fatal(err)
	}
	models := []any{"gpt-4o", "gpt-image-2", "gemini-nano-banana-2.1", "seedance-2.5"}
	profiles := []any{map[string]any{"model": "gpt-4o", "capability": "text", "protocol": "chat-completion"}}
	body, err := json.Marshal(map[string]any{"expectedRevision": 1, "config": map[string]any{
		"textModel": "beefapi::gpt-4o",
		"channels": []any{map[string]any{"id": "beefapi", "baseUrl": "https://api.eggfans.com", "apiKey": "offline-key", "models": models, "modelProfiles": profiles}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/workspace/model-config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("catalog save status = %d", recorder.Code)
	}
	for attempt := 0; attempt < 2; attempt++ {
		recorder = httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/workspace/model-config", nil))
		config := modelConfigResponseData(t, recorder)["config"].(map[string]any)
		if config["textModel"] != "beefapi::gpt-4o" {
			t.Fatal("default model selection was not restored")
		}
		for _, raw := range config["channels"].([]any) {
			channel := raw.(map[string]any)
			if channel["id"] != "beefapi" {
				continue
			}
			if len(channel["models"].([]any)) != len(models) {
				t.Fatal("refreshed direct catalog was replaced by the previous snapshot")
			}
			foundProfile := false
			for _, rawProfile := range channel["modelProfiles"].([]any) {
				profile := rawProfile.(map[string]any)
				if profile["model"] == "gpt-4o" && profile["protocol"] == "chat-completion" && profile["capability"] == "text" {
					foundProfile = true
				}
			}
			if !foundProfile {
				t.Fatal("refreshed model capability was not restored")
			}
			if channel["apiKey"] != "offline-key" {
				t.Fatal("direct credential changed")
			}
		}
	}
}

func newModelConfigTestRouter(t *testing.T) (*gin.Engine, *workspace.ProviderConfig) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	store, err := workspace.NewProviderConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(nil, dir)
	router := gin.New()
	router.Use(WorkspaceMiddleware(workspace.Context{ID: "local", DataDir: dir}))
	router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{ProviderConfig: store}))
	RegisterWorkspaceRoutes(router.Group("/api"), service)
	return router, store
}

func putModelConfig(t *testing.T, router *gin.Engine, expectedRevision int64, apiKey string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"expectedRevision": expectedRevision,
		"config":           map[string]any{"channels": []any{map[string]any{"id": "beefapi", "apiKey": apiKey, "enabled": true}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/workspace/model-config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	return recorder
}

func modelConfigResponseData(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}
