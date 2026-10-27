package bootstrap

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	httptransport "infinite-canvas/backend/internal/transport/http"
)

func TestDesktopCORSAllowsAgentEventResume(t *testing.T) {
	for _, origin := range []string{"wails://wails", "http://wails.localhost"} {
		t.Run(origin, func(t *testing.T) {
			router := gin.New()
			router.Use(desktopCORSMiddleware())
			router.GET("/api/agent/runs/run/events", func(c *gin.Context) {
				c.Header("Content-Type", "text/event-stream")
				c.String(http.StatusOK, "id: 4\nevent: run_snapshot\ndata: {\"id\":\"run\",\"status\":\"completed\"}\n\n")
			})
			handler := httptransport.RequireLaunchToken("test-token")(router)
			preflight := httptest.NewRequest(http.MethodOptions, "/api/agent/runs/run/events?after=3", nil)
			preflight.Header.Set("Origin", origin)
			preflight.Header.Set("Access-Control-Request-Method", http.MethodGet)
			preflight.Header.Set("Access-Control-Request-Headers", "last-event-id,x-desktop-token")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, preflight)
			if response.Code != http.StatusNoContent {
				t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
			}
			allowed := make(map[string]bool)
			for _, header := range strings.Split(response.Header().Get("Access-Control-Allow-Headers"), ",") {
				allowed[strings.ToLower(strings.TrimSpace(header))] = true
			}
			for _, header := range []string{"last-event-id", "x-desktop-token"} {
				if !allowed[header] {
					t.Fatalf("desktop SSE preflight does not allow %s", header)
				}
			}
			if response.Header().Get("Access-Control-Allow-Origin") != origin || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
				t.Fatal("desktop SSE preflight must preserve the requesting origin and credentials")
			}
			request := httptest.NewRequest(http.MethodGet, "/api/agent/runs/run/events?after=3", nil)
			request.Header.Set("Origin", origin)
			request.Header.Set("Last-Event-ID", "3")
			request.Header.Set("X-Desktop-Token", "test-token")
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "text/event-stream" || !strings.Contains(response.Body.String(), "\"status\":\"completed\"") {
				t.Fatal("authenticated Agent event stream must be readable after preflight")
			}
			request.Header.Del("X-Desktop-Token")
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatal("allowing the resume header must not bypass desktop authorization")
			}
		})
	}
}

func TestDesktopCORSAllowsAuthenticatedModelRelay(t *testing.T) {
	for _, origin := range []string{"wails://wails", "http://wails.localhost"} {
		t.Run(origin, func(t *testing.T) {
			router := gin.New()
			router.Use(desktopCORSMiddleware())
			relayCalls := 0
			router.POST("/api/ai/custom", func(c *gin.Context) {
				relayCalls++
				if c.GetHeader("Authorization") != "Bearer synthetic-key" {
					t.Fatal("model relay lost the selected channel credential")
				}
				c.Header("Content-Type", "text/event-stream")
				c.String(http.StatusOK, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
			})
			handler := httptransport.RequireLaunchToken("test-token")(router)
			requestedHeaders := []string{"authorization", "content-type", "x-desktop-token", "x-canvas-upstream-url", "x-canvas-upstream-format", "x-canvas-upstream-base-url", "x-canvas-upstream-headers"}
			preflight := httptest.NewRequest(http.MethodOptions, "/api/ai/custom", nil)
			preflight.Header.Set("Origin", origin)
			preflight.Header.Set("Access-Control-Request-Method", http.MethodPost)
			preflight.Header.Set("Access-Control-Request-Headers", strings.Join(requestedHeaders, ","))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, preflight)
			if response.Code != http.StatusNoContent || relayCalls != 0 {
				t.Fatal("preflight must succeed without forwarding a model request")
			}
			allowed := make(map[string]bool)
			for _, header := range strings.Split(response.Header().Get("Access-Control-Allow-Headers"), ",") {
				allowed[strings.ToLower(strings.TrimSpace(header))] = true
			}
			for _, header := range requestedHeaders {
				if !allowed[header] {
					t.Fatalf("desktop model preflight does not allow %s", header)
				}
			}
			if response.Header().Get("Access-Control-Allow-Origin") != origin || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
				t.Fatal("model relay must preserve the WebView origin and credentials")
			}
			request := httptest.NewRequest(http.MethodPost, "/api/ai/custom", strings.NewReader(`{"model":"text-model","stream":true}`))
			request.Header.Set("Origin", origin)
			request.Header.Set("Authorization", "Bearer synthetic-key")
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || relayCalls != 0 {
				t.Fatal("upstream authorization must not replace the desktop launch token")
			}
			request.Header.Set("X-Desktop-Token", "test-token")
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK || relayCalls != 1 || !strings.Contains(response.Body.String(), "\"content\":\"ok\"") {
				t.Fatal("authenticated model stream must be readable after preflight")
			}
		})
	}
}
