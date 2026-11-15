package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	localproject "infinite-canvas/backend/internal/project"
	"infinite-canvas/backend/internal/repository"
)

func TestProjectPropMergeHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "prop-merge.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "离线合并测试"}).Error; err != nil {
		t.Fatal(err)
	}
	svc := app.NewLocal(repository.New(db), t.TempDir())
	owner, err := svc.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Project{ID: "project", UserID: owner.ID, Name: "道具", Revision: 1, Status: model.ProjectStatusActive},
		&model.Project{ID: "foreign", UserID: "foreign-user", Revision: 1, Status: model.ProjectStatusActive},
		&model.Asset{ID: "source", UserID: owner.ID, Title: "长剑", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "source-version"},
		&model.Asset{ID: "target", UserID: owner.ID, Title: "佩剑", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "target-version"},
		&model.AssetVersion{ID: "source-version", AssetID: "source", Version: 1, DefinitionJSON: `{}`},
		&model.AssetVersion{ID: "target-version", AssetID: "target", Version: 1, DefinitionJSON: `{}`},
		&model.ProjectAssetLink{ID: "source-link", ProjectID: "project", AssetID: "source"},
		&model.ProjectAssetLink{ID: "target-link", ProjectID: "project", AssetID: "target"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterProjectRoutes(router.Group("/api"), svc)
	call := func(projectID, body string, status int) json.RawMessage {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/api/projects/"+projectID+"/assets/source/merge-prop", bytes.NewBufferString(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		var envelope struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || recorder.Code != status || (status == 200) != (envelope.Code == 0) {
			t.Fatalf("HTTP %d: %s", recorder.Code, recorder.Body.String())
		}
		return envelope.Data
	}
	call("project", `{`, 400)
	call("project", `{"targetAssetId":"source","expectedRevision":1}`, 400)
	call("foreign", `{"targetAssetId":"target","expectedRevision":1}`, 404)
	call("project", `{"targetAssetId":"target","expectedRevision":2}`, 409)
	data := call("project", `{"targetAssetId":"target","expectedRevision":1}`, 200)
	var result localproject.MergeProjectPropResult
	if err := json.Unmarshal(data, &result); err != nil || result.Asset.ID != "target" {
		t.Fatalf("merge result = %s, error = %v", data, err)
	}
	assets, err := svc.ProjectAssets(owner.ID, "project")
	if err != nil || len(assets) != 1 || assets[0].ID != "target" {
		t.Fatalf("read after merge = %+v, error = %v", assets, err)
	}
}
