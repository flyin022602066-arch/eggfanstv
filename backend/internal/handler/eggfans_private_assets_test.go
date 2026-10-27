package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
)

func TestEggfansRoutesRegisteredAndRequireWorkspace(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	registerEggfansPrivateAssetRoutes(router.Group("/api"), &app.Service{})
	for _, route := range router.Routes() {
		recorder := httptest.NewRecorder()
		path := route.Path
		if path == "/api/resources/:id/eggfans-private-asset" {
			path = "/api/resources/test/eggfans-private-asset"
		}
		if path == "/api/resources/:id/eggfans-private-assets" {
			path = "/api/resources/test/eggfans-private-assets"
		}
		router.ServeHTTP(recorder, httptest.NewRequest(route.Method, path, nil))
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("%s allowed missing workspace: %d", path, recorder.Code)
		}
	}
	if len(router.Routes()) != 6 {
		t.Fatal("Eggfans API route missing")
	}
}
