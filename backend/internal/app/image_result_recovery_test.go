package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestImageResultRecoveryBindsOriginalSceneAndKeepsSingleVersion(t *testing.T) {
	service, db := newGenerationDeliveryMediaService(t, filepath.Join(t.TempDir(), "image-recovery.db"), t.TempDir())
	defer closeDB(t, db)
	if err := db.AutoMigrate(&model.Project{}, &model.ProjectAssetLink{}, &model.ProjectAssetFolder{}, &model.Shot{}, &model.ShotAssetReference{}); err != nil {
		t.Fatal(err)
	}
	rows := []any{
		&model.Project{ID: "project", UserID: "user-1", Status: model.ProjectStatusActive},
		&model.Asset{ID: "scene", UserID: "user-1", Kind: "text", Category: model.AssetCategoryEnvironment, PrimaryVersionID: "definition", PayloadJSON: `{}`},
		&model.AssetVersion{ID: "definition", AssetID: "scene", Version: 1, DefinitionJSON: `{"description":"original scene"}`},
		&model.ProjectAssetLink{ID: "link", ProjectID: "project", AssetID: "scene"},
		&model.Resource{ID: "image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Width: 1, Height: 1, MimeType: "image/png"},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	original := model.Task{ID: "recover-scene", UserID: "user-1", ProjectID: "project", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"scene","assetVersionId":"definition"}}`, ResultJSON: `{"images":[{"resourceId":"image","storageKey":"resource:image"}]}`}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		result, err := service.RecoverImageTaskResult(context.Background(), original.UserID, original.ID)
		if err != nil || !result.Recovered || result.Status != "ready" {
			t.Fatalf("recovery %+v %v", result, err)
		}
	}
	asset, _ := service.repo.AssetForUser(original.UserID, "scene")
	versions, _ := service.repo.AssetVersions("scene")
	if asset.Kind != "image" || len(versions) != 2 {
		t.Fatalf("asset binding or idempotency failed: %+v %d", asset, len(versions))
	}
}

func TestImageResultRecoveryConflictAndFailureKeepOriginalResult(t *testing.T) {
	service, db := newGenerationDeliveryMediaService(t, filepath.Join(t.TempDir(), "failed-recovery.db"), t.TempDir())
	defer closeDB(t, db)
	original := model.Task{ID: "failed-image", UserID: "user-1", Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{}`, ResultJSON: `{"images":[{"dataUrl":"data:image/png;base64,broken"}]}`, Error: "save failed"}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.repo.ClaimFailedTaskProviderRecovery(original.ID, original.UserID, "manual-recovery:existing", time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecoverImageTaskResult(context.Background(), original.UserID, original.ID); err == nil {
		t.Fatal("concurrent recovery accepted")
	}
	_ = service.repo.ReleaseTaskProviderRecovery(original.ID, "manual-recovery:existing")
	if _, err := service.RecoverImageTaskResult(context.Background(), original.UserID, original.ID); err == nil {
		t.Fatal("partial image treated as success")
	}
	stored, _ := service.repo.Task(original.ID)
	if stored.Status != original.Status || stored.ResultJSON != original.ResultJSON || stored.Error != original.Error || stored.LeaseOwner != "" {
		t.Fatalf("failed recovery destroyed original: %+v", stored)
	}
}

func TestStoredImageResultRequiresUsableImageEntries(t *testing.T) {
	for _, result := range []map[string]interface{}{nil, {"images": []interface{}{map[string]interface{}{}}}, {"images": []interface{}{"bad"}}} {
		if storedImageResultPresent(result) {
			t.Fatal("incomplete result accepted")
		}
	}
}

func TestImageResultRecoveryCompletesFailedTaskFromOriginalInlineImage(t *testing.T) {
	service, db := newGenerationDeliveryMediaService(t, filepath.Join(t.TempDir(), "inline-recovery.db"), t.TempDir())
	defer closeDB(t, db)
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.TaskTextDelta{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	original := model.Task{ID: "inline-image", UserID: "user-1", Type: "canvas_image", Status: model.TaskStatusFailed, Stage: "本地结果处理", Error: "previous save failure", ResultJSON: `{"images":[{"dataUrl":"` + tinyPNGDataURL + `"}]}`}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		result, err := service.RecoverImageTaskResult(context.Background(), original.UserID, original.ID)
		if err != nil || !result.Recovered {
			t.Fatalf("inline recovery %+v %v", result, err)
		}
	}
	stored, _ := service.repo.Task(original.ID)
	if stored.Status != model.TaskStatusSucceeded || stored.Error != "" || stored.LeaseOwner != "" {
		t.Fatalf("failed task not restored: %+v", stored)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("resource duplicated: %d %v", count, err)
	}
}

func TestImageResultRecoveryDoesNotResubmitUnknownSynchronousTask(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	original := model.Task{ID: "unknown-image", UserID: "owner", Type: "canvas_image", Status: model.TaskStatusFailed, Stage: "submission_unknown", InputJSON: `{"mode":"image","config":{"baseUrl":"https://api.eggfans.com/v1"}}`, Error: "response interrupted"}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecoverImageTaskResult(context.Background(), "other", original.ID); err == nil {
		t.Fatal("foreign recovery allowed")
	}
	result, err := service.RecoverImageTaskResult(context.Background(), "owner", original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Recovered || result.Status != "unavailable" || !strings.Contains(result.Message, "不会重新提交") {
		t.Fatalf("unsafe recovery: %+v", result)
	}
	stored, err := service.repo.Task(original.ID)
	if err != nil || stored.Status != original.Status || stored.Attempts != original.Attempts || stored.LeaseOwner != "" || stored.InputJSON != original.InputJSON || stored.Error != original.Error {
		t.Fatalf("unknown task mutated: %+v %v", stored, err)
	}
}

func TestImageResultRecoveryPreservesActiveTaskAndRejectsVideo(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []model.Task{
		{ID: "running-image", UserID: "owner", Type: "canvas_image", Status: model.TaskStatusRunning, LeaseOwner: "worker"},
		{ID: "video", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusFailed},
	} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := service.RecoverImageTaskResult(context.Background(), "owner", "running-image")
	if err != nil || result.Status != "pending" || result.Recovered {
		t.Fatalf("active task restarted: %+v %v", result, err)
	}
	if _, err := service.RecoverImageTaskResult(context.Background(), "owner", "video"); err == nil {
		t.Fatal("video entered image recovery")
	}
}

func TestImageResultRecoveryBindsOriginalRemoteImageWithoutGeneration(t *testing.T) {
	for _, status := range []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed} {
		t.Run(string(status), func(t *testing.T) {
			service, db := newGenerationDeliveryMediaService(t, filepath.Join(t.TempDir(), "remote-recovery.db"), t.TempDir())
			defer closeDB(t, db)
			if err := db.AutoMigrate(&model.Project{}, &model.ProjectAssetLink{}, &model.ProjectAssetFolder{}, &model.Shot{}, &model.ShotAssetReference{}, &model.CanvasProject{}, &model.TaskTextDelta{}, &model.ApiCallLog{}); err != nil {
				t.Fatal(err)
			}
			resource := model.Resource{ID: "original-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
			for _, row := range []any{
				&model.Project{ID: "project", UserID: "user-1", Status: model.ProjectStatusActive},
				&model.Asset{ID: "prop", UserID: "user-1", Kind: "text", Category: model.AssetCategoryProp, PrimaryVersionID: "definition", PayloadJSON: `{}`},
				&model.AssetVersion{ID: "definition", AssetID: "prop", Version: 1, DefinitionJSON: `{}`},
				&model.ProjectAssetLink{ID: "link", ProjectID: "project", AssetID: "prop"}, &resource,
			} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			media := &deliveryMediaStub{resource: &resource}
			service.generationDeliveryMedia = media
			task := model.Task{ID: "remote-image", UserID: "user-1", ProjectID: "project", Type: "canvas_image", Status: status, InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"prop","assetVersionId":"definition"}}`, ResultJSON: `{"images":[{"url":"https://fixture.invalid/original.png"}]}`}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			for index := 0; index < 2; index++ {
				result, err := service.RecoverImageTaskResult(context.Background(), task.UserID, task.ID)
				if err != nil || !result.Recovered {
					t.Fatalf("remote recovery %+v %v", result, err)
				}
			}
			asset, _ := service.repo.AssetForUser(task.UserID, "prop")
			versions, _ := service.repo.AssetVersions("prop")
			if asset.Kind != "image" || len(versions) != 2 {
				t.Fatalf("remote result not bound idempotently: %+v %d", asset, len(versions))
			}
			if media.persists.Load() != 1 {
				t.Fatalf("original file downloaded %d times", media.persists.Load())
			}
		})
	}
}

func TestImageResultRecoveryKeepsOriginalCharacterLook(t *testing.T) {
	service, db := newGenerationDeliveryMediaService(t, filepath.Join(t.TempDir(), "look-recovery.db"), t.TempDir())
	defer closeDB(t, db)
	if err := db.AutoMigrate(&model.Project{}, &model.ProjectAssetLink{}, &model.ProjectAssetFolder{}, &model.Shot{}, &model.ShotAssetReference{}, &model.CharacterVoiceBinding{}, &model.VoiceProfile{}, &model.CanvasProject{}, &model.TaskTextDelta{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Project{ID: "project", UserID: "user-1", Status: model.ProjectStatusActive},
		&model.Asset{ID: "hero", UserID: "user-1", Kind: "entity", Category: model.AssetCategoryCharacter, PrimaryVersionID: "summer", PayloadJSON: `{}`},
		&model.AssetVersion{ID: "summer", AssetID: "hero", Version: 2, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"summer"}`},
		&model.AssetVersion{ID: "winter", AssetID: "hero", Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"winter"}`},
		&model.ProjectAssetLink{ID: "link", ProjectID: "project", AssetID: "hero"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	task := model.Task{ID: "winter-image", UserID: "user-1", ProjectID: "project", Type: "canvas_image", Status: model.TaskStatusFailed, InputJSON: `{"metadata":{"operation":"character_turnaround","characterAssetId":"hero","characterVersionId":"winter"}}`, ResultJSON: `{"images":[{"dataUrl":"` + tinyPNGDataURL + `"}]}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		result, err := service.RecoverImageTaskResult(context.Background(), task.UserID, task.ID)
		if err != nil || !result.Recovered {
			t.Fatalf("character recovery %+v %v", result, err)
		}
	}
	asset, _ := service.repo.AssetForUser(task.UserID, "hero")
	selected, err := service.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	var definition map[string]any
	if err := json.Unmarshal([]byte(selected.DefinitionJSON), &definition); err != nil {
		t.Fatal(err)
	}
	if definition["clothing"] != "winter" {
		t.Fatalf("recovery switched to current summer look: %s", selected.DefinitionJSON)
	}
	representations, err := service.repo.AssetRepresentationsForTask(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	characterBindings := 0
	for _, representation := range representations {
		if representation.Role != "primary" && representation.Role != "turnaround_sheet" {
			continue
		}
		characterBindings++
		if representation.AssetVersionID != selected.ID {
			t.Fatalf("character image bound to another look: %+v", representation)
		}
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || characterBindings != 2 || len(versions) != 3 {
		t.Fatalf("character image binding not idempotent: %+v %v", representations, err)
	}
}
