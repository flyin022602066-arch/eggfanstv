package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/workspace"
)

type fakeBrowserControl struct {
	calls  int
	owner  string
	action string
}

func (p *fakeBrowserControl) Control(_ context.Context, owner, action string, _ any) (map[string]any, error) {
	p.calls++
	p.owner, p.action = owner, action
	return map[string]any{"total": 100, "idle": 2}, nil
}
func TestDoubaoBrowserHTTPRequiresOwnerAndTrustedWrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "fixture.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	defer connection.Close()
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := app.NewLocal(repository.New(db), root)
	defer svc.Close()
	owner, err := svc.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	port := &fakeBrowserControl{}
	router := gin.New()
	router.Use(WorkspaceMiddleware(workspace.Context{ID: owner.ID, DataDir: root}))
	router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{DoubaoBrowser: port, DesktopTrust: func(r *http.Request) bool { return r.Header.Get("X-Fixture-Trusted") == "yes" }}))
	RegisterDoubaoBrowserRoutes(router.Group("/api"), svc)
	request := func(method, path, body string, trusted bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.RemoteAddr = "127.0.0.1:12345"
		if trusted {
			r.Header.Set("X-Fixture-Trusted", "yes")
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/doubao-browser/status", "", false); w.Code != 200 || port.owner != owner.ID {
		t.Fatal(w.Code, w.Body.String())
	}
	before := port.calls
	if w := request("POST", "/api/doubao-browser/clear", "{}", false); w.Code != 403 || port.calls != before {
		t.Fatal("untrusted clear reached domain")
	}
	if w := request("PUT", "/api/doubao-browser/settings", "{}", true); w.Code != 400 || port.calls != before {
		t.Fatal("missing enable setting accepted")
	}
	if w := request("PUT", "/api/doubao-browser/settings", "{\"enabled\":true}", true); w.Code != 200 || port.action != "configure" {
		t.Fatal(w.Code, w.Body.String())
	}
}
