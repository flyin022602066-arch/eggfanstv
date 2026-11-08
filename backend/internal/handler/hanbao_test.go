package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/provider/hanbao"
	"infinite-canvas/backend/internal/workspace"
)

type fakeHanbaoPort struct {
	calls int
	busy  bool
}

func (p *fakeHanbaoPort) Status() (hanbao.Status, error) {
	p.calls++
	return hanbao.Status{Settings: hanbao.DefaultSettings(), Available: true}, nil
}
func (p *fakeHanbaoPort) Save(hanbao.Settings) error { p.calls++; return nil }
func (p *fakeHanbaoPort) Control(context.Context, string, string, string, *int, *int) (map[string]any, error) {
	p.calls++
	if p.busy {
		return nil, hanbao.ErrBusy
	}
	return map[string]any{"accounts": []any{}}, nil
}
func (p *fakeHanbaoPort) SMS(context.Context, string, hanbao.SMSRequest) (any, error) {
	p.calls++
	return map[string]bool{"connected": true}, nil
}

func TestHanbaoHTTPWorkspaceEnvelopeAndBusy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	port := &fakeHanbaoPort{}
	makeRouter := func(auth bool) *gin.Engine {
		r := gin.New()
		if auth {
			r.Use(WorkspaceMiddleware(workspace.Context{ID: "test-workspace", DataDir: t.TempDir()}))
		}
		r.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{Hanbao: port}))
		RegisterHanbaoRoutes(r.Group("/api"), &app.Service{})
		return r
	}
	router := makeRouter(false)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/hanbao/status", nil))
	if response.Code != http.StatusUnauthorized || port.calls != 0 {
		t.Fatalf("unscoped request=%d calls=%d", response.Code, port.calls)
	}
	router = makeRouter(true)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/hanbao/status", nil))
	var body struct {
		Code int
		Data hanbao.Status
	}
	if json.Unmarshal(response.Body.Bytes(), &body) != nil || response.Code != 200 || body.Code != 0 || !body.Data.Available {
		t.Fatal(response.Body.String())
	}
	port.busy = true
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("POST", "/api/hanbao/accounts/delete-account", strings.NewReader(`{"account":"fixture"}`)))
	if response.Code != 409 || !strings.Contains(response.Body.String(), `"reason":"conflict"`) {
		t.Fatalf("busy=%d %s", response.Code, response.Body.String())
	}
	before := port.calls
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("PUT", "/api/hanbao/settings", strings.NewReader(strings.Repeat("x", 17<<10))))
	if response.Code != 400 || port.calls != before {
		t.Fatal("malformed oversized input reached domain")
	}
}
