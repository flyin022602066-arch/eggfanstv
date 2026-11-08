package project

import (
	"infinite-canvas/backend/internal/model"
	"testing"
	"time"
)

func TestCharacterReferenceManualVersionKeepsPrimaryAndOtherShots(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	primaryImage := seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	if err := db.Model(&model.AssetRepresentation{}).Where("asset_version_id = ?", asset.PrimaryVersionID).Update("task_id", "manual-primary-image-task").Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	unit := model.ProjectUnit{ID: "manual-unit", ProjectID: project.ID, Title: "章", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	version := model.AssetVersion{ID: "manual-history-version", AssetID: asset.ID, Version: 0, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"黑色铠甲"}`, ReferenceProfileJSON: `{"lookId":"manual-combat","name":"未定稿黑甲","enabled":false,"preferred":false}`, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	selectedImage := seedReadyCharacterReference(t, db, project.UserID, version.ID)
	for _, shotID := range []string{"manual-selected", "manual-untouched"} {
		shot := model.Shot{ID: shotID, ProjectID: project.ID, UnitID: unit.ID, CurrentRevisionID: shotID + "-revision", CreatedAt: now, UpdatedAt: now}
		ref := model.ShotAssetReference{ID: shotID + "-reference", ShotID: shotID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked", SelectionSource: "manual", SelectionStatus: "resolved", SelectionLocked: true, SelectionRevisionID: shot.CurrentRevisionID, CreatedAt: now}
		for _, row := range []any{&shot, &ref} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	catalog, err := service.CharacterReferenceCatalog(project.UserID, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	choice := CharacterReferenceChoice{ShotID: "manual-selected", AssetID: asset.ID, VersionID: version.ID, Status: "resolved", Source: "manual", Locked: true, Reason: "用户手动选择第二套造型", ExpectedShotRevisionID: "manual-selected-revision"}
	if err := service.SaveCharacterReferenceChoices(project.UserID, project.ID, unit.ID, SaveCharacterReferenceChoicesRequest{ExpectedRevision: catalog.Revision, Choices: []CharacterReferenceChoice{choice}}); err != nil {
		t.Fatal(err)
	}
	workspace, err := service.ProjectUnitWorkspace(project.UserID, project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.ShotReferences) != 2 {
		t.Fatalf("expected one reference per shot, got %+v", workspace.ShotReferences)
	}
	for _, ref := range workspace.ShotReferences {
		expected := asset.PrimaryVersionID
		if ref.ShotID == choice.ShotID {
			expected = version.ID
		}
		if ref.AssetVersionID != expected || !ref.SelectionLocked {
			t.Fatalf("wrong persisted reference: %+v", ref)
		}
	}
	storedAsset, err := service.repo.AssetForUser(project.UserID, asset.ID)
	if err != nil || storedAsset.PrimaryVersionID != asset.PrimaryVersionID {
		t.Fatalf("manual choice changed project default: %+v, error=%v", storedAsset, err)
	}
	submission := CharacterReferenceSubmission{ProjectID: project.ID, UnitID: unit.ID, ShotID: choice.ShotID, RevisionID: choice.ExpectedShotRevisionID, Snapshot: []CharacterReferenceSnapshot{{AssetID: asset.ID, VersionID: version.ID, ResourceID: selectedImage}}}
	if err := service.ValidateCharacterReferenceSubmission(project.UserID, submission, []string{selectedImage}); err != nil {
		t.Fatal("manual version cannot be submitted", err)
	}
	if err := service.ValidateCharacterReferenceSubmission(project.UserID, submission, []string{primaryImage}); err == nil {
		t.Fatal("submission silently accepted the primary image instead of the selected version")
	}
}

func TestManualMissingCharacterCanBindBeforeImageAndConfirmAfterImage(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	unit := model.ProjectUnit{ID: "missing-cast-unit", ProjectID: project.ID, Title: "章"}
	shot := model.Shot{ID: "missing-cast-shot", ProjectID: project.ID, UnitID: unit.ID, CurrentRevisionID: "missing-cast-revision"}
	for _, row := range []any{&unit, &shot} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	choice := CharacterReferenceChoice{ShotID: shot.ID, AssetID: asset.ID, VersionID: asset.PrimaryVersionID, Status: "pending", Source: "manual", Locked: true, Reason: "手动补充出镜人物，待补图", ExpectedShotRevisionID: shot.CurrentRevisionID}
	save := func() error {
		catalog, err := service.CharacterReferenceCatalog(project.UserID, project.ID)
		if err != nil {
			t.Fatal(err)
		}
		return service.SaveCharacterReferenceChoices(project.UserID, project.ID, unit.ID, SaveCharacterReferenceChoicesRequest{ExpectedRevision: catalog.Revision, Choices: []CharacterReferenceChoice{choice}})
	}
	if err := save(); err != nil {
		t.Fatal("missing image must not prevent manual cast binding", err)
	}
	workspace, err := service.ProjectUnitWorkspace(project.UserID, project.ID, unit.ID)
	if err != nil || len(workspace.ShotReferences) != 1 || workspace.ShotReferences[0].SelectionStatus != "pending" || !workspace.ShotReferences[0].SelectionLocked {
		t.Fatalf("pending binding did not persist: %+v, %v", workspace.ShotReferences, err)
	}
	choice.Status = "resolved"
	if err := save(); err == nil {
		t.Fatal("a missing image was accepted as a ready reference")
	}
	imageID := seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	if err := save(); err != nil {
		t.Fatal("manual choice cannot be confirmed after completing its image", err)
	}
	submission := CharacterReferenceSubmission{ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Snapshot: []CharacterReferenceSnapshot{{AssetID: asset.ID, VersionID: asset.PrimaryVersionID, ResourceID: imageID}}}
	if err := service.ValidateCharacterReferenceSubmission(project.UserID, submission, []string{imageID}); err != nil {
		t.Fatal("completed manual character cannot be submitted", err)
	}
	choice.Source = "auto"
	choice.Locked = false
	if err := save(); err == nil {
		t.Fatal("automatic repair overwrote a manually locked character")
	}
}
