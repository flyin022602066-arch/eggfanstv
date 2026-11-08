package project

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type characterLookVersionDeleter interface {
	DeleteCharacterLookVersion(string, string, string, string, time.Time) error
}

func lookVersionDeleter(t *testing.T, service *Service) characterLookVersionDeleter {
	t.Helper()
	deleter, ok := any(service).(characterLookVersionDeleter)
	if !ok {
		t.Fatal("individual character-look version deletion is not implemented")
	}
	return deleter
}

func seedRemovableCharacterLook(t *testing.T, service *Service, db *gorm.DB) (model.Project, model.Asset, model.AssetVersion) {
	t.Helper()
	project, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	if err := db.Model(&model.AssetRepresentation{}).Where("asset_version_id = ?", asset.PrimaryVersionID).Update("task_id", "seed-base").Error; err != nil {
		t.Fatal(err)
	}
	look, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: asset.PrimaryVersionID, Profile: CharacterReferenceProfile{Name: "空白造型", Enabled: true}, Definition: map[string]any{"clothing": "黑甲"}})
	if err != nil {
		t.Fatal(err)
	}
	return project, asset, look
}

func TestDeleteCharacterLookVersionArchivesBlankPrimaryAndPreservesResources(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, look := seedRemovableCharacterLook(t, service, db)
	deleter := lookVersionDeleter(t, service)
	if err := deleter.DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	stored, err := service.repo.AssetVersion(look.ID)
	if err != nil || stored.Status != model.AssetVersionStatusArchived || !stored.UpdatedAt.After(look.UpdatedAt) {
		t.Fatalf("version not archived: %+v %v", stored, err)
	}
	current, err := service.repo.ProjectCharacterAsset(project.UserID, project.ID, asset.ID)
	if err != nil || current.PrimaryVersionID != asset.PrimaryVersionID {
		t.Fatalf("primary not restored: %+v %v", current, err)
	}
	var payload struct {
		PrimaryVersionID string `json:"primaryVersionId"`
		Data             struct {
			Definition map[string]any `json:"definition"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(current.PayloadJSON), &payload); err != nil || payload.PrimaryVersionID != asset.PrimaryVersionID || payload.Data.Definition["clothing"] == "黑甲" {
		t.Fatalf("payload not restored: %+v %v", payload, err)
	}
	catalog, err := service.CharacterReferenceCatalog(project.UserID, project.ID)
	if err != nil || len(catalog.Versions) != 1 || catalog.Versions[0].VersionID != asset.PrimaryVersionID || catalog.Revision != project.Revision+2 {
		t.Fatalf("catalog still shows removed version: %+v %v", catalog, err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("resources changed: %d %v", count, err)
	}
	if err := deleter.DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt); err == nil {
		t.Fatal("stale repeated removal accepted")
	}
}

func TestDeleteCharacterLookVersionArchivesUnusedHistoryWithoutDeletingMedia(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, look := seedRemovableCharacterLook(t, service, db)
	version, _ := service.repo.AssetVersion(asset.PrimaryVersionID)
	if err := db.Create(&model.CharacterVoiceBinding{ID: "voice", AssetVersionID: version.ID, VoiceProfileID: "voice-profile"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "finished-generation", UserID: project.UserID, Status: model.TaskStatusSucceeded, InputJSON: `{"baseVersionId":"` + version.ID + `"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := lookVersionDeleter(t, service).DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, version.ID, version.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	current, _ := service.repo.ProjectCharacterAsset(project.UserID, project.ID, asset.ID)
	if current.PrimaryVersionID != look.ID {
		t.Fatal("history deletion changed primary")
	}
	for _, table := range []any{&model.Resource{}, &model.AssetRepresentation{}, &model.Task{}, &model.CharacterVoiceBinding{}} {
		var count int64
		if err := db.Model(table).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("media/task unexpectedly removed: %T count=%d err=%v", table, count, err)
		}
	}
}

func TestDeleteCharacterLookVersionRejectsUnsafeChangesAtomically(t *testing.T) {
	for _, scenario := range []string{"foreign-user", "foreign-project", "unlinked-asset", "wrong-asset", "missing-version", "archived-project", "missing-revision", "stale-revision", "last-version", "linked-shot", "canvas-version", "canvas-primary", "active-task", "active-primary-task", "active-resource-task", "canvas-resource", "linked-generation", "invalid-canvas", "invalid-task"} {
		t.Run(scenario, func(t *testing.T) {
			service, db := newTestService(t, nil)
			project, asset, look := seedRemovableCharacterLook(t, service, db)
			userID, projectID, assetID, versionID, expected := project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt
			message := ""
			var row any
			switch scenario {
			case "foreign-user":
				userID = "foreign"
			case "foreign-project":
				projectID = "foreign-project"
				row = &model.Project{ID: projectID, UserID: "foreign", Status: model.ProjectStatusActive, Revision: 1}
			case "unlinked-asset":
				projectID = "unlinked-project"
				row = &model.Project{ID: projectID, UserID: userID, Status: model.ProjectStatusActive, Revision: 1}
			case "wrong-asset":
				assetID = "wrong"
			case "missing-version":
				versionID = "missing"
			case "archived-project":
				if err := db.Model(&project).Update("status", model.ProjectStatusArchived).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-revision":
				expected = time.Time{}
			case "stale-revision":
				expected = expected.Add(-time.Second)
			case "last-version":
				if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("status", model.AssetVersionStatusArchived).Error; err != nil {
					t.Fatal(err)
				}
				message = "移除角色资产"
			case "linked-shot":
				row = &model.ShotAssetReference{ID: "linked", ShotID: "s", AssetVersionID: look.ID, Role: "reference", Status: "linked"}
				message = "镜头"
			case "canvas-version":
				row = &model.CanvasProject{ID: "c", UserID: userID, ProjectID: "another-project", PayloadJSON: `{"nodes":[{"metadata":{"characterAssetId":"` + asset.ID + `","characterAssetVersionId":"` + look.ID + `"}}]}`}
				message = "画布"
			case "canvas-primary":
				row = &model.CanvasProject{ID: "c", UserID: userID, ProjectID: projectID, PayloadJSON: `{"nodes":[{"metadata":{"workflowKind":"character","characterAssetId":"` + asset.ID + `"}}]}`}
				message = "画布"
			case "active-task":
				row = &model.Task{ID: "busy", UserID: userID, ProjectID: projectID, Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"baseVersionId":"` + look.ID + `"}}`}
				message = "任务"
			case "active-primary-task":
				row = &model.Task{ID: "busy", UserID: userID, ProjectID: projectID, Status: model.TaskStatusQueued, InputJSON: `{"metadata":{"characterAssetId":"` + asset.ID + `"}}`}
				message = "任务"
			case "active-resource-task":
				imageID := seedReadyCharacterReference(t, db, userID, look.ID)
				row = &model.Task{ID: "busy", UserID: userID, Status: model.TaskStatusRunning, InputJSON: `{"referenceImages":[{"storageKey":"resource:` + imageID + `"}]}`}
				message = "任务"
			case "canvas-resource":
				imageID := seedReadyCharacterReference(t, db, userID, look.ID)
				row = &model.CanvasProject{ID: "c", UserID: userID, PayloadJSON: `{"nodes":[{"metadata":{"resourceId":"` + imageID + `"}}]}`}
				message = "画布"
			case "linked-generation":
				seedReadyCharacterReference(t, db, userID, look.ID)
				if err := db.Model(&model.AssetRepresentation{}).Where("asset_version_id = ?", look.ID).Update("task_id", "busy").Error; err != nil {
					t.Fatal(err)
				}
				row = &model.Task{ID: "busy", UserID: userID, Status: model.TaskStatusRunning, InputJSON: `{}`}
				message = "任务"
			case "invalid-canvas":
				row = &model.CanvasProject{ID: "bad-canvas", UserID: userID, PayloadJSON: `{invalid`}
				message = "修复"
			case "invalid-task":
				row = &model.Task{ID: "bad-task", UserID: userID, Status: model.TaskStatusQueued, InputJSON: `{invalid`}
				message = "修复"
			}
			if row != nil {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			before, _ := service.Owned(project.UserID, project.ID)
			err := lookVersionDeleter(t, service).DeleteCharacterLookVersion(userID, projectID, assetID, versionID, expected)
			if err == nil || message != "" && !strings.Contains(err.Error(), message) {
				t.Fatalf("unsafe removal accepted or non-actionable error: %v", err)
			}
			after, _ := service.Owned(project.UserID, project.ID)
			stored, _ := service.repo.AssetVersion(look.ID)
			current, _ := service.repo.ProjectCharacterAsset(project.UserID, project.ID, asset.ID)
			if after.Revision != before.Revision || stored.Status == model.AssetVersionStatusArchived || current.PrimaryVersionID != look.ID {
				t.Fatal("rejected removal partially committed")
			}
		})
	}
}

func TestDeleteCharacterLookVersionRepositoryRejectsChangedPrimaryOrAlternate(t *testing.T) {
	for _, change := range []string{"primary", "alternate", "version"} {
		t.Run(change, func(t *testing.T) {
			service, db := newTestService(t, nil)
			project, original, look := seedRemovableCharacterLook(t, service, db)
			asset, _ := service.repo.ProjectCharacterAsset(project.UserID, project.ID, original.ID)
			alternate, _ := service.repo.AssetVersion(original.PrimaryVersionID)
			next := *asset
			next.PrimaryVersionID = alternate.ID
			switch change {
			case "primary":
				if err := db.Model(&model.Asset{}).Where("id = ?", asset.ID).Update("primary_version_id", alternate.ID).Error; err != nil {
					t.Fatal(err)
				}
			case "alternate":
				if err := db.Model(&model.AssetVersion{}).Where("id = ?", alternate.ID).Update("updated_at", time.Now().Add(time.Hour)).Error; err != nil {
					t.Fatal(err)
				}
			case "version":
				if err := db.Model(&model.AssetVersion{}).Where("id = ?", look.ID).Update("updated_at", time.Now().Add(time.Hour)).Error; err != nil {
					t.Fatal(err)
				}
			}
			before, _ := service.Owned(project.UserID, project.ID)
			err := service.repo.ArchiveCharacterLookVersion(project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt, asset.PrimaryVersionID, asset.UpdatedAt, &next, alternate)
			if !errors.Is(err, repository.ErrProjectRevisionConflict) {
				t.Fatalf("concurrent %s accepted: %v", change, err)
			}
			after, _ := service.Owned(project.UserID, project.ID)
			stored, _ := service.repo.AssetVersion(look.ID)
			if stored.Status == model.AssetVersionStatusArchived || before.Revision != after.Revision {
				t.Fatal("concurrent removal partially committed")
			}
		})
	}
}

func TestDeleteCharacterLookVersionCannotReuseArchivedVersion(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, look := seedRemovableCharacterLook(t, service, db)
	seedReadyCharacterReference(t, db, project.UserID, look.ID)
	if err := lookVersionDeleter(t, service).DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	stored, _ := service.repo.AssetVersion(look.ID)
	if err := service.ValidateCharacterTurnaroundSource(project.UserID, asset.ID, look.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Errorf("archived version could be used as generation source: %v", err)
	}
	if _, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, ExtractCharacterLooksRequest{BaseVersionID: look.ID, ExpectedUpdatedAt: stored.UpdatedAt}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Errorf("archived version could be used as extraction source: %v", err)
	}
	if err := service.SaveCharacterReferenceProfile(project.UserID, project.ID, asset.ID, look.ID, SaveCharacterReferenceProfileRequest{ExpectedUpdatedAt: stored.UpdatedAt, Profile: CharacterReferenceProfile{Name: "已删除", Enabled: true, Preferred: true}}); err == nil {
		t.Error("archived version could be marked final")
	}
	if _, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: look.ID, Profile: CharacterReferenceProfile{Name: "复活", Enabled: true}, Definition: map[string]any{}}); err == nil {
		t.Error("archived version could be used as new-look base")
	}
	if _, err := service.ReplaceProjectCharacterRepresentations(project.UserID, project.ID, asset.ID, ReplaceCharacterRepresentationsRequest{BaseVersionID: look.ID, Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "image-" + look.ID}}}); err == nil {
		t.Error("archived version could be used as image replacement base")
	}
	if err := service.BindCharacterTurnaroundFromVersion(project.UserID, project.ID, asset.ID, look.ID, "late-completion", "image-"+look.ID, ""); err == nil {
		t.Error("archived version could be revived by late generation completion")
	}
	for _, row := range []any{&model.ProjectUnit{ID: "unit", ProjectID: project.ID}, &model.Shot{ID: "shot", ProjectID: project.ID, UnitID: "unit", CurrentRevisionID: "rev"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	current, _ := service.Owned(project.UserID, project.ID)
	if err := service.SaveCharacterReferenceChoices(project.UserID, project.ID, "unit", SaveCharacterReferenceChoicesRequest{ExpectedRevision: current.Revision, Choices: []CharacterReferenceChoice{{ShotID: "shot", AssetID: asset.ID, VersionID: look.ID, Status: "resolved", Source: "manual", Reason: "旧页面提交", ExpectedShotRevisionID: "rev"}}}); err == nil {
		t.Error("archived version could be rebound to shot")
	}
}

func TestDeleteCharacterLookVersionPrefersImageAlternateAndAllowsUnrelatedReferences(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, blank := seedRemovableCharacterLook(t, service, db)
	primary, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: blank.ID, Profile: CharacterReferenceProfile{Name: "待删除", Enabled: true}, Definition: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.CanvasProject{ID: "unrelated", UserID: project.UserID, PayloadJSON: `{"nodes":[{"metadata":{"characterAssetId":"` + asset.ID + `","characterVersionId":"` + blank.ID + `","characterVersionPolicy":"pinned"}}]}`},
		&model.Task{ID: "unrelated-task", UserID: project.UserID, Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"characterAssetId":"` + asset.ID + `","characterVersionId":"` + blank.ID + `"}}`},
		&model.Task{ID: "finished-task", UserID: project.UserID, Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"characterVersionId":"` + primary.ID + `"}}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := lookVersionDeleter(t, service).DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, primary.ID, primary.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	current, _ := service.repo.ProjectCharacterAsset(project.UserID, project.ID, asset.ID)
	if current.PrimaryVersionID != asset.PrimaryVersionID {
		t.Fatal("blank alternate preferred over image version")
	}
}

func TestDeleteCharacterLookVersionKeepsDraftAlternateSnapshotConsistent(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, look := seedRemovableCharacterLook(t, service, db)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("status", model.AssetVersionStatusDraft).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, look.ID, look.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	current, _ := service.repo.ProjectCharacterAsset(project.UserID, project.ID, asset.ID)
	var payload struct {
		Status model.AssetVersionStatus `json:"status"`
	}
	if err := json.Unmarshal([]byte(current.PayloadJSON), &payload); err != nil || current.Status != model.AssetVersionStatusDraft || payload.Status != current.Status {
		t.Fatalf("alternate snapshot status mismatch: asset=%s payload=%s err=%v", current.Status, payload.Status, err)
	}
}

func TestDeleteCharacterLookVersionCanReextractSameLookID(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", `{"clothing":"造型1（居家）：黑裙；造型2（外出）：白衣"}`).Error; err != nil {
		t.Fatal(err)
	}
	base, err := service.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	req := ExtractCharacterLooksRequest{BaseVersionID: base.ID, ExpectedUpdatedAt: base.UpdatedAt}
	created, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, req)
	if err != nil || len(created) != 2 {
		t.Fatalf("initial extraction: %+v %v", created, err)
	}
	removed := created[0]
	if err := service.DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, removed.ID, removed.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	recreated, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, req)
	if err != nil || len(recreated) != 1 {
		t.Fatalf("archived look blocked recreation: %+v %v", recreated, err)
	}
	if recreated[0].ID == removed.ID || recreated[0].Version <= created[1].Version || referenceProfile(recreated[0].ReferenceProfileJSON).LookID != referenceProfile(removed.ReferenceProfileJSON).LookID {
		t.Fatal("recreation reused archived identity or lost look group")
	}
	stored, err := service.repo.AssetVersion(removed.ID)
	if err != nil || stored.Status != model.AssetVersionStatusArchived {
		t.Fatalf("recreation revived archived version: %+v %v", stored, err)
	}
	if repeat, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, req); err != nil || len(repeat) != 0 {
		t.Fatalf("recreation not idempotent: %+v %v", repeat, err)
	}
}

func TestDeleteCharacterLookVersionUpdateUsesAvailablePrimary(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset, removed := seedRemovableCharacterLook(t, service, db)
	if err := service.DeleteCharacterLookVersion(project.UserID, project.ID, asset.ID, removed.ID, removed.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	result, err := service.UpdateProjectCharacter(project.UserID, project.ID, asset.ID, UpdateProjectCharacterRequest{Name: asset.Title, Definition: map[string]any{"clothing": "蓝衣"}})
	if err != nil || result.Character.VersionID == removed.ID || result.Character.Definition["clothing"] != "蓝衣" || len(result.Character.Representations) != 1 {
		t.Fatalf("update did not use available primary: %+v %v", result, err)
	}
	stored, err := service.repo.AssetVersion(removed.ID)
	if err != nil || stored.Status != model.AssetVersionStatusArchived || stored.DefinitionJSON != removed.DefinitionJSON {
		t.Fatalf("update revived or mutated archived version: %+v %v", stored, err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", asset.ID).Update("primary_version_id", removed.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateProjectCharacter(project.UserID, project.ID, asset.ID, UpdateProjectCharacterRequest{Name: asset.Title, Definition: map[string]any{}}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("archived primary accepted by update: %v", err)
	}
}
