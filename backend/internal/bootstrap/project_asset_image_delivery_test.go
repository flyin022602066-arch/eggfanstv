package bootstrap

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestDesktopProjectAssetImageDeliveryAndHistoricalRecovery(t *testing.T) {
	for _, recovery := range []bool{false, true} {
		name := "completion"
		if recovery {
			name = "historical"
		}
		t.Run(name, func(t *testing.T) {
			harness := newDesktopHarness(t)
			owner, err := harness.rt.service.LocalWorkspaceOwner()
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			project := model.Project{ID: "asset-project", UserID: owner.ID, Status: model.ProjectStatusActive, Revision: 1}
			asset := model.Asset{ID: "asset-scene", UserID: owner.ID, Kind: "text", Category: model.AssetCategoryEnvironment, PrimaryVersionID: "asset-definition", Title: "场景", PayloadJSON: `{}`}
			version := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"description":"庭院"}`}
			resource := model.Resource{ID: "asset-image", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady, Width: 2048, Height: 1152, MimeType: "image/png"}
			task := model.Task{ID: "asset-image-task", UserID: owner.ID, ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"asset-scene","assetVersionId":"asset-definition"}}`, ResultJSON: `{"images":[{"resourceId":"asset-image"}]}`, CreatedAt: now, UpdatedAt: now}
			for _, record := range []any{&project, &asset, &version, &resource, &model.ProjectAssetLink{ID: "asset-link", ProjectID: project.ID, AssetID: asset.ID}, &task} {
				if err := harness.rt.db.Create(record).Error; err != nil {
					t.Fatal(err)
				}
			}
			for attempt := 0; attempt < 2; attempt++ {
				if recovery {
					err = harness.rt.service.RecoverIncompleteGenerationDeliveries(100)
				} else {
					err = harness.rt.service.RegisterTaskOutputFromTask(task)
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			var updated model.Asset
			if err := harness.rt.db.First(&updated, "id = ?", asset.ID).Error; err != nil {
				t.Fatal(err)
			}
			var representations []model.AssetRepresentation
			if err := harness.rt.db.Where("task_id = ? AND role = ?", task.ID, "primary").Find(&representations).Error; err != nil {
				t.Fatal(err)
			}
			if updated.Kind != "image" || updated.PrimaryVersionID == version.ID || len(representations) != 1 || representations[0].ResourceID != resource.ID {
				t.Fatalf("completed image was not bound exactly once: kind=%s version=%s representations=%v", updated.Kind, updated.PrimaryVersionID, representations)
			}
		})
	}
}
