package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestProjectAssetImagePersistsVersionAndIsIdempotent(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "project", UserID: "owner", Status: model.ProjectStatusActive}
	asset := model.Asset{ID: "scene", UserID: "owner", Kind: "text", Category: model.AssetCategoryEnvironment, PrimaryVersionID: "definition", Title: "古城", PayloadJSON: `{"data":{"content":"石桥"}}`}
	version := model.AssetVersion{ID: "definition", AssetID: asset.ID, Version: 1, DefinitionJSON: `{"description":"石桥与城墙"}`}
	link := model.ProjectAssetLink{ID: "link", ProjectID: project.ID, AssetID: asset.ID}
	resource := model.Resource{ID: "generated", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Width: 3840, Height: 2160, MimeType: "image/png"}
	for _, row := range []any{&project, &asset, &version, &link, &resource} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	input := map[string]any{"mode": "image", "metadata": map[string]any{"operation": "project_asset_image", "assetId": asset.ID, "assetVersionId": version.ID}}
	if err := service.validateProjectAssetImageTask("owner", project.ID, "canvas_image", input); err != nil {
		t.Fatal(err)
	}
	if err := service.validateProjectAssetImageTask("other", project.ID, "canvas_image", input); err == nil {
		t.Fatal("cross-user task accepted")
	}
	if err := service.validateProjectAssetImageTask("owner", project.ID, "canvas_video", input); err == nil {
		t.Fatal("wrong task type accepted")
	}
	raw, _ := json.Marshal(input)
	task := model.Task{ID: "task", UserID: "owner", ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(raw), ResultJSON: `{"images":[{"resourceId":"generated"}]}`, Prompt: "石桥与城墙设定图"}
	for attempt := 0; attempt < 2; attempt++ {
		if err := service.RegisterTaskOutputFromTask(task); err != nil {
			t.Fatal(err)
		}
	}
	updated, err := service.repo.AssetForUser("owner", asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Kind != "image" || updated.PrimaryVersionID == version.ID {
		t.Fatalf("asset not updated: %+v", updated)
	}
	versions, _ := service.repo.AssetVersions(asset.ID)
	if len(versions) != 2 || versions[0].DefinitionJSON != version.DefinitionJSON || versions[0].Version != 2 {
		t.Fatalf("definition/history lost: %+v", versions)
	}
	representations, _ := service.repo.AssetRepresentationsForTask(task.ID)
	if len(representations) != 1 || representations[0].ResourceID != resource.ID {
		t.Fatalf("binding not idempotent: %+v", representations)
	}
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(updated.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.StorageKey != "resource:generated" {
		t.Fatalf("storage key = %q", payload.Data.StorageKey)
	}
}

func TestProjectAssetImageRejectsUnownedOrInvalidOutputWithoutMutation(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	rows := []any{
		&model.Project{ID: "project", UserID: "owner", Status: model.ProjectStatusActive},
		&model.Asset{ID: "prop", UserID: "owner", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "version", PayloadJSON: "{}"},
		&model.AssetVersion{ID: "version", AssetID: "prop", Version: 1, DefinitionJSON: "{}"},
		&model.AssetVersion{ID: "foreign-version", AssetID: "other", Version: 1},
		&model.ProjectAssetLink{ID: "link", ProjectID: "project", AssetID: "prop"},
		&model.Resource{ID: "foreign-image", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "video", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := service.projectImageAsset("owner", "project", "prop", "foreign-version"); err == nil {
		t.Fatal("foreign version accepted")
	}
	for _, result := range []string{`{"images":[]}`, `{"images":[{"resourceId":"foreign-image"}]}`, `{"images":[{"resourceId":"video"}]}`} {
		task := model.Task{ID: "task", UserID: "owner", ProjectID: "project", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: result}
		if _, err := service.finalizeProjectAssetImage(task, `{"metadata":{"operation":"project_asset_image","assetId":"prop","assetVersionId":"version"}}`); err == nil {
			t.Fatalf("invalid output accepted: %s", result)
		}
	}
	versions, _ := service.repo.AssetVersions("prop")
	asset, _ := service.repo.AssetForUser("owner", "prop")
	if len(versions) != 1 || asset.PrimaryVersionID != "version" || asset.Kind != "text" {
		t.Fatal("invalid output mutated asset")
	}
}
