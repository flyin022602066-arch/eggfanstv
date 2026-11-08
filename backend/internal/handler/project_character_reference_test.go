package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

func TestCharacterReferenceHTTPContracts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "character-reference.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
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
	if err := db.Create(&model.Workspace{ID: "local", Name: "本地工作区"}).Error; err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), t.TempDir())
	owner, err := service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	p := model.Project{ID: "p", UserID: owner.ID, Name: "造型测试", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "hero", UserID: owner.ID, Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "v1", Title: "主角", PayloadJSON: `{}`}
	version := model.AssetVersion{ID: "v1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"白衣"}`, CreatedAt: now, UpdatedAt: now}
	for _, row := range []any{&p, &asset, &version,
		&model.ProjectAssetLink{ID: "link", ProjectID: p.ID, AssetID: asset.ID},
		&model.ProjectUnit{ID: "u", ProjectID: p.ID, Title: "章"},
		&model.Shot{ID: "s", ProjectID: p.ID, UnitID: "u", CurrentRevisionID: "sr"},
		&model.Resource{ID: "image", UserID: owner.ID, Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady},
		&model.AssetRepresentation{ID: "rep", AssetVersionID: version.ID, ResourceID: "image", Role: "primary", MediaType: "image"},
		&model.Project{ID: "foreign", UserID: "another-owner", Status: model.ProjectStatusActive, Revision: 1},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterProjectRoutes(router.Group("/api"), service)
	call := func(method, path string, input any, status int, output any) string {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, "/api"+path, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		var envelope struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if recorder.Code != status || json.Unmarshal(recorder.Body.Bytes(), &envelope) != nil || (status == 200) != (envelope.Code == 0) {
			t.Fatalf("%s %s: %d %s", method, path, recorder.Code, recorder.Body.String())
		}
		if output != nil {
			if err := json.Unmarshal(envelope.Data, output); err != nil {
				t.Fatal(err)
			}
		}
		return recorder.Body.String()
	}
	var catalog localproject.CharacterReferenceCatalog
	call(http.MethodGet, "/projects/p/character-versions", nil, 200, &catalog)
	if len(catalog.Versions) != 1 || catalog.Versions[0].VersionID != version.ID {
		t.Fatal(catalog)
	}
	profile := localproject.CharacterReferenceProfile{LookID: "daily", Name: "白衣日常", Enabled: true, Preferred: true}
	update := localproject.SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: catalog.Versions[0].UpdatedAt}
	call(http.MethodPatch, "/projects/p/characters/hero/versions/v1/reference-profile", update, 200, nil)
	call(http.MethodPatch, "/projects/p/characters/hero/versions/v1/reference-profile", update, 409, nil)
	var created struct {
		Version model.AssetVersion `json:"version"`
	}
	call(http.MethodPost, "/projects/p/characters/hero/looks", localproject.CreateCharacterLookRequest{BaseVersionID: version.ID, Profile: localproject.CharacterReferenceProfile{Name: "战斗装", Enabled: true}, Definition: map[string]any{"clothing": "黑甲"}}, 200, &created)
	if created.Version.ID == "" || created.Version.ID == version.ID {
		t.Fatal(created)
	}
	call(http.MethodPatch, "/projects/p/characters/hero/versions/"+created.Version.ID+"/reference-profile", localproject.SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: created.Version.UpdatedAt}, 400, nil)
	call(http.MethodGet, "/projects/p/character-versions", nil, 200, &catalog)
	choices := localproject.SaveCharacterReferenceChoicesRequest{ExpectedRevision: catalog.Revision, Choices: []localproject.CharacterReferenceChoice{{ShotID: "s", AssetID: asset.ID, VersionID: version.ID, Status: "resolved", Source: "manual", Locked: true, Reason: "用户确认白衣", ExpectedShotRevisionID: "sr"}}}
	call(http.MethodPut, "/projects/p/units/u/character-references", choices, 200, nil)
	call(http.MethodPut, "/projects/p/units/u/character-references", choices, 409, nil)
	call(http.MethodGet, "/projects/foreign/character-versions", nil, 404, nil)
	var refs []model.ShotAssetReference
	if err := db.Where("shot_id = ?", "s").Find(&refs).Error; err != nil || len(refs) != 1 || refs[0].AssetVersionID != version.ID || !refs[0].SelectionLocked {
		t.Fatalf("saved references: %+v, %v", refs, err)
	}
	if err := db.First(&version, "id = ?", version.ID).Error; err != nil {
		t.Fatal(err)
	}
	referencedPath := "/projects/p/characters/hero/versions/v1?expectedUpdatedAt=" + url.QueryEscape(version.UpdatedAt.Format(time.RFC3339Nano))
	if body := call(http.MethodDelete, referencedPath, nil, 409, nil); !strings.Contains(body, "解除镜头用途") {
		t.Fatal("missing actionable reference error", body)
	}
	if err := db.Where("shot_id = ?", "s").Find(&refs).Error; err != nil || len(refs) != 1 || refs[0].AssetVersionID != version.ID || !refs[0].SelectionLocked {
		t.Fatalf("rejected removal changed pinned reference: %+v, %v", refs, err)
	}
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", created.Version.ID).Update("definition_json", `{"clothing":"造型1（居家）：黑裙；造型2（外出）：白衣"}`).Error; err != nil {
		t.Fatal(err)
	}
	var base model.AssetVersion
	if err := db.First(&base, "id = ?", created.Version.ID).Error; err != nil {
		t.Fatal(err)
	}
	request := localproject.ExtractCharacterLooksRequest{BaseVersionID: base.ID, ExpectedUpdatedAt: base.UpdatedAt}
	var split struct {
		Versions []model.AssetVersion `json:"versions"`
	}
	call(http.MethodPost, "/projects/p/characters/hero/looks/extract", request, 200, &split)
	if len(split.Versions) != 2 {
		t.Fatal("looks not created", split)
	}
	call(http.MethodPost, "/projects/p/characters/hero/looks/extract", request, 200, &split)
	if len(split.Versions) != 0 {
		t.Fatal("duplicate extraction", split)
	}
	call(http.MethodPost, "/projects/foreign/characters/hero/looks/extract", request, 404, nil)
	deletePath := "/projects/p/characters/hero/versions/" + created.Version.ID
	call(http.MethodDelete, deletePath, nil, 400, nil)
	call(http.MethodDelete, deletePath+"?expectedUpdatedAt=invalid", nil, 400, nil)
	call(http.MethodDelete, deletePath+"?expectedUpdatedAt="+url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339Nano)), nil, 409, nil)
	if err := db.First(&created.Version, "id = ?", created.Version.ID).Error; err != nil {
		t.Fatal(err)
	}
	query := "?expectedUpdatedAt=" + url.QueryEscape(created.Version.UpdatedAt.Format(time.RFC3339Nano))
	call(http.MethodDelete, "/projects/foreign/characters/hero/versions/"+created.Version.ID+query, nil, 404, nil)
	var deleted struct {
		Deleted bool `json:"deleted"`
	}
	call(http.MethodDelete, deletePath+query, nil, 200, &deleted)
	if !deleted.Deleted {
		t.Fatal("missing deletion confirmation")
	}
	call(http.MethodGet, "/projects/p/character-versions", nil, 200, &catalog)
	for _, item := range catalog.Versions {
		if item.VersionID == created.Version.ID {
			t.Fatal("archived version remains in catalog")
		}
	}
	call(http.MethodDelete, deletePath+query, nil, 404, nil)
	if err := db.First(&created.Version, "id = ?", created.Version.ID).Error; err != nil || created.Version.Status != model.AssetVersionStatusArchived {
		t.Fatalf("version was not archived: %+v %v", created.Version, err)
	}
	call(http.MethodPatch, deletePath+"/reference-profile", localproject.SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: created.Version.UpdatedAt}, 404, nil)
	call(http.MethodPost, "/projects/p/characters/hero/looks", localproject.CreateCharacterLookRequest{BaseVersionID: created.Version.ID, Profile: localproject.CharacterReferenceProfile{Name: "旧版本", Enabled: true}, Definition: map[string]any{}}, 404, nil)
	for _, table := range []any{&model.Resource{}, &model.AssetRepresentation{}} {
		var count int64
		if err := db.Model(table).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("removal changed original media: %T count=%d err=%v", table, count, err)
		}
	}
	if err := db.Model(&model.AssetVersion{}).Where("asset_id = ? AND id <> ?", asset.ID, version.ID).Update("status", model.AssetVersionStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	if body := call(http.MethodDelete, referencedPath, nil, 400, nil); !strings.Contains(body, "移除角色资产") {
		t.Fatal("missing actionable last-version error", body)
	}
}
