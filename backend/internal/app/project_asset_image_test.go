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

func TestReplaceProjectAssetImageCreatesVersionAndUpdatesShotReferences(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "replace-project", UserID: "owner", Status: model.ProjectStatusActive}
	asset := model.Asset{ID: "replace-prop", UserID: "owner", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "prop-v1", Title: "系统面板", PayloadJSON: `{"data":{"content":"可替换面板"}}`}
	oldVersion := model.AssetVersion{ID: "prop-v1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"description":"系统面板设定"}`}
	resource := model.Resource{ID: "replacement-image", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Size: 4096, Width: 1536, Height: 1024, MimeType: "image/png"}
	shot := model.Shot{ID: "replace-shot", ProjectID: project.ID, UnitID: "unit", Title: "镜头"}
	for _, row := range []any{&project, &asset, &oldVersion, &resource, &shot} {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed %T: %v", row, err)
		}
	}
	if err := db.Create(&model.ProjectAssetLink{ID: "replace-link", ProjectID: project.ID, AssetID: asset.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ShotAssetReference{ID: "replace-reference", ShotID: shot.ID, AssetVersionID: oldVersion.ID, Role: "reference", Status: "linked"}).Error; err != nil {
		t.Fatal(err)
	}

	summary, err := service.ReplaceProjectAssetImage("owner", project.ID, asset.ID, ReplaceProjectAssetImageRequest{ResourceID: resource.ID})
	if err != nil {
		t.Fatalf("ReplaceProjectAssetImage: %v", err)
	}
	if summary.ID != asset.ID || summary.MediaType != "image" {
		t.Fatalf("unexpected replacement summary: %#v", summary)
	}

	updated, err := service.repo.AssetForUser("owner", asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Kind != "image" || updated.PrimaryVersionID == oldVersion.ID || updated.Status != model.AssetVersionStatusConfirmed {
		t.Fatalf("asset was not promoted to a confirmed image version: %#v", updated)
	}
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(updated.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.StorageKey != "resource:"+resource.ID || payload.Data.Width != resource.Width || payload.Data.Height != resource.Height {
		t.Fatalf("replacement image metadata = %#v", payload.Data)
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 2 {
		t.Fatalf("asset versions = %d, err = %v", len(versions), err)
	}
	var reference model.ShotAssetReference
	if err := db.First(&reference, "id = ?", "replace-reference").Error; err != nil {
		t.Fatal(err)
	}
	if reference.AssetVersionID != updated.PrimaryVersionID {
		t.Fatalf("shot reference still uses %s, want %s", reference.AssetVersionID, updated.PrimaryVersionID)
	}
	var representation model.AssetRepresentation
	if err := db.First(&representation, "asset_version_id = ? AND role = ?", updated.PrimaryVersionID, "primary").Error; err != nil {
		t.Fatal(err)
	}
	if representation.ResourceID != resource.ID {
		t.Fatalf("image representation resource = %s, want %s", representation.ResourceID, resource.ID)
	}
}

func TestReplaceProjectAssetImageRejectsForeignResourceAndNonSceneAssets(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "replace-project", UserID: "owner", Status: model.ProjectStatusActive}
	prop := model.Asset{ID: "replace-prop", UserID: "owner", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "prop-v1", Title: "道具", PayloadJSON: `{}`}
	character := model.Asset{ID: "replace-character", UserID: "owner", Kind: "image", Category: model.AssetCategoryCharacter, PrimaryVersionID: "character-v1", Title: "角色", PayloadJSON: `{}`}
	propVersion := model.AssetVersion{ID: "prop-v1", AssetID: prop.ID, Version: 1, Status: model.AssetVersionStatusConfirmed}
	characterVersion := model.AssetVersion{ID: "character-v1", AssetID: character.ID, Version: 1, Status: model.AssetVersionStatusConfirmed}
	foreign := model.Resource{ID: "foreign-image", UserID: "other", Kind: "image", Status: model.ResourceStatusReady}
	owned := model.Resource{ID: "owned-image", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady}
	for _, row := range []any{&project, &prop, &character, &propVersion, &characterVersion, &foreign, &owned} {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed %T: %v", row, err)
		}
	}
	for index, asset := range []*model.Asset{&prop, &character} {
		if err := db.Create(&model.ProjectAssetLink{ID: newID(), ProjectID: project.ID, AssetID: asset.ID}).Error; err != nil {
			t.Fatalf("seed project asset link %d: %v", index, err)
		}
	}
	if _, err := service.ReplaceProjectAssetImage("owner", project.ID, prop.ID, ReplaceProjectAssetImageRequest{ResourceID: foreign.ID}); err == nil {
		t.Fatal("replacement accepted another user's image")
	}
	if _, err := service.ReplaceProjectAssetImage("owner", project.ID, character.ID, ReplaceProjectAssetImageRequest{ResourceID: owned.ID}); err == nil {
		t.Fatal("replacement accepted a character asset")
	}
}
