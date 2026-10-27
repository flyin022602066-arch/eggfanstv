package project

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
			service, db := newTestService(t, nil)
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
			service, db := newTestService(t, nil)
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

func TestBindCharacterTurnaroundImageResourceValidation(t *testing.T) {
	for _, test := range []struct {
		name     string
		kind     string
		mimeType string
		status   model.ResourceStatus
		userID   string
		wantErr  bool
	}{
		{name: "uploaded image", kind: "media", mimeType: "image/png", status: model.ResourceStatusReady},
		{name: "uploaded file image", kind: "file", mimeType: "image/png", status: model.ResourceStatusReady},
		{name: "generated image", kind: "image", mimeType: "image/webp", status: model.ResourceStatusReady},
		{name: "normalized mime", kind: "media", mimeType: " IMAGE/PNG ; charset=binary", status: model.ResourceStatusReady},
		{name: "video", kind: "media", mimeType: "video/mp4", status: model.ResourceStatusReady, wantErr: true},
		{name: "mismatched mime", kind: "image", mimeType: "audio/wav", status: model.ResourceStatusReady, wantErr: true},
		{name: "missing mime", kind: "image", status: model.ResourceStatusReady, wantErr: true},
		{name: "pending", kind: "media", mimeType: "image/png", status: model.ResourceStatusPending, wantErr: true},
		{name: "foreign", kind: "media", mimeType: "image/png", status: model.ResourceStatusReady, userID: "other-user", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db := newTestService(t, nil)
			project, asset := seedProjectCharacterRepresentation(t, db)
			resourceUserID := test.userID
			if resourceUserID == "" {
				resourceUserID = project.UserID
			}
			resource := model.Resource{ID: "turnaround-image", UserID: resourceUserID, Kind: test.kind, MimeType: test.mimeType, Status: test.status}
			if err := db.Create(&resource).Error; err != nil {
				t.Fatal(err)
			}
			err := service.BindCharacterTurnaround(project.UserID, project.ID, asset.ID, "turnaround-task", resource.ID, "")
			versions, versionErr := service.repo.AssetVersions(asset.ID)
			if versionErr != nil {
				t.Fatal(versionErr)
			}
			if test.wantErr {
				if err == nil || len(versions) != 1 {
					t.Fatalf("error = %v, versions = %+v, want rejection without a new version", err, versions)
				}
				return
			}
			stored, storedErr := service.ProjectCharacter(project.UserID, project.ID, asset.ID)
			if err != nil || storedErr != nil || len(versions) != 2 || stored.Character.VisualStatus != "ready" || len(stored.Character.Representations) != 2 {
				t.Fatalf("bind error = %v, read error = %v, versions = %+v, character = %+v", err, storedErr, versions, stored.Character)
			}
		})
	}
}

func TestReplaceCharacterImageUpdatesProjectShotReferencesWithoutChangingTaskSnapshots(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	otherProject := model.Project{ID: "other-project", UserID: project.UserID, Status: model.ProjectStatusActive, Revision: 1}
	older := model.AssetVersion{ID: "older-character-version", AssetID: asset.ID, Version: 0, DefinitionJSON: "{}"}
	otherAsset := model.Asset{ID: "other-character", UserID: project.UserID, Category: model.AssetCategoryCharacter, PrimaryVersionID: "other-character-version"}
	otherVersion := model.AssetVersion{ID: otherAsset.PrimaryVersionID, AssetID: otherAsset.ID, Version: 1, DefinitionJSON: "{}"}
	resource := model.Resource{ID: "replacement-image", UserID: project.UserID, Kind: "media", Status: model.ResourceStatusReady, MimeType: "image/png"}
	shots := []model.Shot{
		{ID: "shot-one", ProjectID: project.ID, UnitID: "chapter-one"},
		{ID: "shot-two", ProjectID: project.ID, UnitID: "chapter-two"},
		{ID: "other-project-shot", ProjectID: otherProject.ID},
	}
	references := []model.ShotAssetReference{
		{ID: "first-reference", ShotID: shots[0].ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked", CreatedAt: now},
		{ID: "second-reference", ShotID: shots[1].ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked", CreatedAt: now},
		{ID: "duplicate-history", ShotID: shots[0].ID, AssetVersionID: older.ID, Role: "reference", Status: "linked", CreatedAt: now.Add(time.Second)},
		{ID: "foreign-project-reference", ShotID: shots[2].ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked"},
		{ID: "unlinked-reference", ShotID: shots[0].ID, AssetVersionID: older.ID, Role: "keyframe", Status: "unlinked"},
		{ID: "other-character-reference", ShotID: shots[0].ID, AssetVersionID: otherVersion.ID, Role: "reference", Status: "linked"},
	}
	task := model.Task{ID: "already-submitted", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: "saved-input-snapshot"}
	artifact := model.ShotArtifact{ID: "previous-video", ProjectID: project.ID, UnitID: shots[0].UnitID, ShotID: shots[0].ID, Type: "video", Version: 1, Status: "ready", Selected: true, ResourceID: "previous-video-resource", MetadataJSON: "saved-version-snapshot"}
	runningArtifact := model.ShotArtifact{ID: "running-video", ProjectID: project.ID, UnitID: shots[1].UnitID, ShotID: shots[1].ID, Type: "video", Version: 1, Status: "running", TaskID: task.ID}
	for _, row := range []any{&otherProject, &older, &otherAsset, &otherVersion, &resource, &shots, &references, &task, &artifact, &runningArtifact} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := service.ReplaceProjectCharacterRepresentations(project.UserID, project.ID, asset.ID, ReplaceCharacterRepresentationsRequest{
		Representations: []CharacterRepresentationInput{{Role: "turnaround_sheet", ResourceID: resource.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, referenceID := range []string{"first-reference", "second-reference"} {
		var stored model.ShotAssetReference
		if err := db.First(&stored, "id = ?", referenceID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.AssetVersionID != result.Character.VersionID || !stored.CreatedAt.Equal(now) {
			t.Fatalf("reference %s = %+v, want replacement version %s without reordering", referenceID, stored, result.Character.VersionID)
		}
	}
	var duplicates int64
	if err := db.Model(&model.ShotAssetReference{}).Where("id = ?", "duplicate-history").Count(&duplicates).Error; err != nil || duplicates != 0 {
		t.Fatalf("duplicate references = %d, error = %v", duplicates, err)
	}
	for _, referenceID := range []string{"foreign-project-reference", "unlinked-reference", "other-character-reference"} {
		var stored model.ShotAssetReference
		if err := db.First(&stored, "id = ?", referenceID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.AssetVersionID == result.Character.VersionID {
			t.Fatalf("unrelated reference changed: %+v", stored)
		}
	}
	if err := db.First(&artifact, "id = ?", artifact.ID).Error; err != nil || artifact.Status != "stale" || artifact.Selected || artifact.ResourceID != "previous-video-resource" || artifact.MetadataJSON != "saved-version-snapshot" {
		t.Fatalf("historical artifact = %+v, error = %v", artifact, err)
	}
	if err := db.First(&runningArtifact, "id = ?", runningArtifact.ID).Error; err != nil || runningArtifact.Status != "running" {
		t.Fatalf("running artifact changed: %+v, error = %v", runningArtifact, err)
	}
	if err := db.First(&task, "id = ?", task.ID).Error; err != nil || task.Status != model.TaskStatusRunning || task.InputJSON != "saved-input-snapshot" {
		t.Fatalf("submitted task changed: %+v, error = %v", task, err)
	}
	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil || storedProject.Revision != project.Revision+1 {
		t.Fatalf("project = %+v, error = %v, want one atomic revision", storedProject, err)
	}
}

func TestCharacterImageReplacementRollsBackVersionAndReferencesOnFailure(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	resource := model.Resource{ID: "replacement-resource", UserID: project.UserID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	shot := model.Shot{ID: "failure-shot", ProjectID: project.ID}
	reference := model.ShotAssetReference{ID: "failure-reference", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked"}
	for _, row := range []any{&resource, &shot, &reference} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec("CREATE TRIGGER reject_character_rebind BEFORE UPDATE OF asset_version_id ON shot_asset_references BEGIN SELECT RAISE(ABORT, 'rebind failed'); END").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReplaceProjectCharacterRepresentations(project.UserID, project.ID, asset.ID, ReplaceCharacterRepresentationsRequest{Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: resource.ID}}}); err == nil {
		t.Fatal("expected rejected reference write")
	}
	storedAsset, err := service.repo.AssetForUser(project.UserID, asset.ID)
	if err != nil || storedAsset.PrimaryVersionID != asset.PrimaryVersionID {
		t.Fatalf("asset changed after rollback: %+v, error = %v", storedAsset, err)
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 1 {
		t.Fatalf("versions = %+v, error = %v, want no new version", versions, err)
	}
	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil || storedProject.Revision != project.Revision {
		t.Fatalf("project changed after rollback: %+v, error = %v", storedProject, err)
	}
	if err := db.First(&reference, "id = ?", reference.ID).Error; err != nil || reference.AssetVersionID != asset.PrimaryVersionID {
		t.Fatalf("reference changed after rollback: %+v, error = %v", reference, err)
	}
}

func TestCharacterDefinitionUpdatePreservesPinnedShotVersion(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	shot := model.Shot{ID: "pinned-shot", ProjectID: project.ID}
	reference := model.ShotAssetReference{ID: "pinned-reference", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked"}
	for _, row := range []any{&shot, &reference} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.UpdateProjectCharacter(project.UserID, project.ID, asset.ID, UpdateProjectCharacterRequest{Name: asset.Title, Definition: map[string]any{"description": "updated definition"}}); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&reference, "id = ?", reference.ID).Error; err != nil || reference.AssetVersionID != asset.PrimaryVersionID {
		t.Fatalf("pinned reference = %+v, error = %v", reference, err)
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
