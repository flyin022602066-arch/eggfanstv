package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func TestReplaceProjectCharacterRepresentationsAcceptsReadyImageMediaResource(t *testing.T) {
	for _, test := range []struct {
		name     string
		kind     string
		mimeType string
	}{
		{name: "uploaded jpeg", kind: "media", mimeType: "image/jpeg"},
		{name: "uploaded png", kind: "media", mimeType: "image/png"},
		{name: "uploaded file png", kind: "file", mimeType: "image/png"},
		{name: "normalized mime", kind: "media", mimeType: " IMAGE/PNG ; charset=binary"},
		{name: "generated image", kind: "image", mimeType: "image/webp"},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db := newProjectAssetLinkTestService(t)
			project, asset := seedProjectCharacterRepresentation(t, db)
			resource := model.Resource{ID: "character-upload", UserID: project.UserID, Kind: test.kind, Status: model.ResourceStatusReady, MimeType: test.mimeType}
			if err := db.Create(&resource).Error; err != nil {
				t.Fatal(err)
			}

			result, err := service.ReplaceProjectCharacterRepresentations(project.UserID, project.ID, asset.ID, ReplaceCharacterRepresentationsRequest{
				Representations: []CharacterRepresentationInput{
					{Role: "primary", ResourceID: resource.ID},
					{Role: "turnaround_sheet", ResourceID: " " + resource.ID + " "},
				},
			})
			if err != nil {
				t.Fatalf("ReplaceProjectCharacterRepresentations: %v", err)
			}
			if result.Character.Version != 2 || result.Character.VersionID == asset.PrimaryVersionID || result.Character.VisualStatus != "ready" {
				t.Fatalf("character = %+v, want new ready version 2", result.Character)
			}
			if len(result.Character.Representations) != 2 {
				t.Fatalf("representations = %+v, want primary and turnaround sheet", result.Character.Representations)
			}
			for _, representation := range result.Character.Representations {
				if representation.ResourceID != resource.ID || representation.MediaType != "image" {
					t.Fatalf("representation = %+v, want image resource %q", representation, resource.ID)
				}
			}
			versions, err := service.repo.AssetVersions(asset.ID)
			if err != nil || len(versions) != 2 {
				t.Fatalf("versions = %+v, error = %v, want 2 versions", versions, err)
			}
			persisted, err := service.ProjectCharacter(project.UserID, project.ID, asset.ID)
			if err != nil || persisted.Character.VersionID != result.Character.VersionID || len(persisted.Character.Representations) != 2 {
				t.Fatalf("persisted character = %+v, error = %v", persisted.Character, err)
			}
		})
	}
}

func TestReplaceProjectCharacterRepresentationsRejectsInvalidImageResources(t *testing.T) {
	tests := []struct {
		name     string
		userID   string
		kind     string
		status   model.ResourceStatus
		mimeType string
		missing  bool
		inputID  string
	}{
		{name: "media video", kind: "media", status: model.ResourceStatusReady, mimeType: "video/mp4"},
		{name: "media audio", kind: "media", status: model.ResourceStatusReady, mimeType: "audio/wav"},
		{name: "media non image", kind: "media", status: model.ResourceStatusReady, mimeType: "application/octet-stream"},
		{name: "media missing mime", kind: "media", status: model.ResourceStatusReady},
		{name: "image video mime", kind: "image", status: model.ResourceStatusReady, mimeType: "video/mp4"},
		{name: "image missing mime", kind: "image", status: model.ResourceStatusReady},
		{name: "file non image mime", kind: "file", status: model.ResourceStatusReady, mimeType: "application/pdf"},
		{name: "video image mime", kind: "video", status: model.ResourceStatusReady, mimeType: "image/png"},
		{name: "pending image", kind: "media", status: model.ResourceStatusPending, mimeType: "image/png"},
		{name: "failed image", kind: "media", status: model.ResourceStatusFailed, mimeType: "image/png"},
		{name: "foreign image", userID: "other-user", kind: "media", status: model.ResourceStatusReady, mimeType: "image/png"},
		{name: "foreign generated image", userID: "other-user", kind: "image", status: model.ResourceStatusReady, mimeType: "image/png"},
		{name: "missing resource", missing: true, inputID: "missing-resource"},
		{name: "empty resource id", missing: true},
		{name: "blank resource id", missing: true, inputID: " "},
		{name: "asset id is not resource id", missing: true, inputID: "character-asset"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service, db := newProjectAssetLinkTestService(t)
			project, asset := seedProjectCharacterRepresentation(t, db)
			resourceUserID := test.userID
			if resourceUserID == "" {
				resourceUserID = project.UserID
			}
			resource := model.Resource{ID: "invalid-character-upload", UserID: resourceUserID, Kind: test.kind, Status: test.status, MimeType: test.mimeType}
			resourceID := test.inputID
			if !test.missing {
				if err := db.Create(&resource).Error; err != nil {
					t.Fatal(err)
				}
				resourceID = resource.ID
			}

			if _, err := service.ReplaceProjectCharacterRepresentations(project.UserID, project.ID, asset.ID, ReplaceCharacterRepresentationsRequest{
				Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: resourceID}},
			}); err == nil || err.Error() != "角色形象资源不可用" {
				t.Fatalf("error = %v, want unavailable character resource", err)
			}
			versions, err := service.repo.AssetVersions(asset.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(versions) != 1 {
				t.Fatalf("asset versions = %d, want 1 after rejected binding", len(versions))
			}
			storedAsset, err := service.repo.AssetForUser(project.UserID, asset.ID)
			if err != nil || storedAsset.PrimaryVersionID != asset.PrimaryVersionID {
				t.Fatalf("asset primary version changed after rejection: %+v, error = %v", storedAsset, err)
			}
			var representationCount int64
			if err := db.Model(&model.AssetRepresentation{}).Count(&representationCount).Error; err != nil || representationCount != 0 {
				t.Fatalf("representations = %d, error = %v, want no writes", representationCount, err)
			}
			var storedProject model.Project
			if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil || storedProject.Revision != project.Revision {
				t.Fatalf("project revision = %d, error = %v, want unchanged %d", storedProject.Revision, err, project.Revision)
			}
		})
	}
}

func TestFinalizeCharacterTurnaroundTaskImageResourceValidation(t *testing.T) {
	for _, test := range []struct {
		name     string
		kind     string
		mimeType string
		status   model.ResourceStatus
		userID   string
		wantErr  bool
	}{
		{name: "uploaded image", kind: "media", mimeType: "image/png", status: model.ResourceStatusReady},
		{name: "generated image", kind: "image", mimeType: "image/png", status: model.ResourceStatusReady},
		{name: "video", kind: "media", mimeType: "video/mp4", status: model.ResourceStatusReady, wantErr: true},
		{name: "mismatched mime", kind: "image", mimeType: "audio/wav", status: model.ResourceStatusReady, wantErr: true},
		{name: "pending", kind: "media", mimeType: "image/png", status: model.ResourceStatusPending, wantErr: true},
		{name: "foreign", kind: "media", mimeType: "image/png", status: model.ResourceStatusReady, userID: "other-user", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db := newProjectAssetLinkTestService(t)
			project, asset := seedProjectCharacterRepresentation(t, db)
			resourceUserID := test.userID
			if resourceUserID == "" {
				resourceUserID = project.UserID
			}
			resource := model.Resource{ID: "turnaround-image", UserID: resourceUserID, Kind: test.kind, MimeType: test.mimeType, Status: test.status}
			if err := db.Create(&resource).Error; err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "turnaround-task", UserID: project.UserID, ProjectID: project.ID, InputJSON: `{"metadata":{"operation":"character_turnaround","characterAssetId":"` + asset.ID + `"}}`}
			result := map[string]interface{}{"images": []map[string]string{{"resourceId": resource.ID}}}
			applied, err := service.finalizeCharacterTurnaroundTask(task, result)
			if test.wantErr {
				if err == nil || applied {
					t.Fatalf("applied = %t, error = %v, want rejected resource", applied, err)
				}
				versions, versionErr := service.repo.AssetVersions(asset.ID)
				if versionErr != nil || len(versions) != 1 {
					t.Fatalf("versions = %+v, error = %v, want no new version", versions, versionErr)
				}
				return
			}
			if err != nil || !applied {
				t.Fatalf("applied = %t, error = %v, want persisted turnaround", applied, err)
			}
			if applied, err := service.finalizeCharacterTurnaroundTask(task, result); err != nil || applied {
				t.Fatalf("second finalization: applied = %t, error = %v, want idempotent no-op", applied, err)
			}
			stored, err := service.ProjectCharacter(project.UserID, project.ID, asset.ID)
			if err != nil || stored.Character.Version != 2 || stored.Character.VisualStatus != "ready" || len(stored.Character.Representations) != 2 {
				t.Fatalf("character = %+v, error = %v, want ready version 2", stored.Character, err)
			}
		})
	}
}

func seedProjectCharacterRepresentation(t *testing.T, db *gorm.DB) (model.Project, model.Asset) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := db.AutoMigrate(&model.CharacterVoiceBinding{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	project := model.Project{ID: "project-character", UserID: "character-owner", Name: "角色绑定测试", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "character-asset", UserID: project.UserID, Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "character-version", Title: "王大牛", PayloadJSON: `{"id":"character-asset","kind":"entity","category":"character","status":"confirmed","primaryVersionId":"character-version","title":"王大牛","data":{"definition":{}}}`}
	version := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: "character-link", ProjectID: project.ID, AssetID: asset.ID, CreatedAt: now}
	for _, row := range []any{&project, &asset, &version, &link} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return project, asset
}
