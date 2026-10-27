package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelModelCatalogDoesNotClassifyImageInputAsImageGeneration(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"id":"gpt-4o","show_image_upload":1},{"id":"gpt-image-2","model_type":"image","show_image_upload":1}]}`))
	}))
	defer upstream.Close()
	service := NewLocal(nil, t.TempDir())
	catalog, err := service.FetchChannelModelCatalog(context.Background(), &model.User{ID: "local"}, ChannelModelsRequest{BaseURL: upstream.URL, APIKey: "offline-key", APIFormat: "openai"})
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 2 {
		t.Fatalf("model count = %d", len(catalog))
	}
	for _, item := range catalog {
		if item.ID == "gpt-4o" && item.ModelType != "" {
			t.Fatal("image input support was mistaken for image generation")
		}
		if item.ID == "gpt-image-2" && item.ModelType != "image" {
			t.Fatal("explicit image generation metadata was lost")
		}
	}
}
