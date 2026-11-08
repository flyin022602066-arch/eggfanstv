package repository

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestProjectCharacterImageLibraryOriginalAndIdempotent(t *testing.T) {
	repo, db := newProjectAssetVersionSyncRepo(t)
	if err := db.AutoMigrate(&model.Resource{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	asset := model.Asset{ID: "hero", UserID: "owner", Kind: "entity", Category: "character", Title: "主角"}
	version := model.AssetVersion{ID: "look", AssetID: asset.ID, Version: 2}
	resource := model.Resource{ID: "original", UserID: asset.UserID, Kind: "media", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 4096, Height: 2048, Size: 16000000}
	for _, value := range []any{&resource, &model.Task{ID: "task", UserID: asset.UserID}, &model.ProjectAssetLink{ID: "link", ProjectID: "project", AssetID: asset.ID}} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	representations := []model.AssetRepresentation{{ResourceID: resource.ID, TaskID: "task", MediaType: "image", Role: "primary", CreatedAt: now}, {ResourceID: resource.ID, TaskID: "task", MediaType: "image", Role: "turnaround_sheet", CreatedAt: now}}
	for attempt := 0; attempt < 2; attempt++ {
		if err := saveProjectImageLibraryTx(db, "project", &asset, &version, representations); err != nil {
			t.Fatal(err)
		}
	}
	items, total, err := repo.UserAssetsPage(asset.UserID, 1, 20, UserAssetPageFilter{Kind: "image", Generated: true, ProjectID: "project"})
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("library images: %v total=%d error=%v", items, total, err)
	}
	if items[0].ID != fmt.Sprintf("generation_%x", sha256.Sum256([]byte("materialize:task:0"))) {
		t.Fatalf("must share the canonical task delivery asset, got %s", items[0].ID)
	}
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			Bytes      int64  `json:"bytes"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(items[0].PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.StorageKey != "resource:original" || payload.Data.Width != 4096 || payload.Data.Height != 2048 || payload.Data.Bytes != 16000000 {
		t.Fatalf("original image changed: %+v", payload.Data)
	}
	foreign := asset
	foreign.UserID = "another-user"
	if err := saveProjectImageLibraryTx(db, "project", &foreign, &version, representations); err == nil {
		t.Fatal("foreign resource must not be reused")
	}
}

func TestProjectImageLibraryDoesNotDuplicateSceneOrProp(t *testing.T) {
	repo, db := newProjectAssetVersionSyncRepo(t)
	for _, category := range []string{"environment", "prop"} {
		asset := model.Asset{ID: category, UserID: "owner", Kind: "image", Category: model.AssetCategory(category), PayloadJSON: "{}"}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := saveProjectImageLibraryTx(db, "project", &asset, &model.AssetVersion{}, []model.AssetRepresentation{{ResourceID: "original", MediaType: "image"}}); err != nil {
			t.Fatal(err)
		}
	}
	items, total, err := repo.UserAssetsPage("owner", 1, 20, UserAssetPageFilter{Kind: "image"})
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("scene/prop images duplicated: %v total=%d error=%v", items, total, err)
	}
}
