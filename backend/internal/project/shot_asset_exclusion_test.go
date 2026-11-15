package project

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestAutomaticShotBindingCannotRestoreExcludedAssetVersions(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	shot := model.Shot{ID: "excluded-shot", ProjectID: project.ID, Title: "镜头", CreatedAt: now, UpdatedAt: now}
	next := model.AssetVersion{ID: "next-version", AssetID: asset.ID, Version: 2, Status: model.AssetVersionStatusConfirmed, CreatedAt: now, UpdatedAt: now}
	excluded := model.ShotAssetReference{ID: "excluded", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "excluded", SelectionSource: "manual", CreatedAt: now}
	for _, row := range []any{&shot, &next, &excluded} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, versionID := range []string{asset.PrimaryVersionID, next.ID} {
		reference := model.ShotAssetReference{ID: "automatic-" + versionID, ShotID: shot.ID, AssetVersionID: versionID, Role: "reference", Status: "linked", SelectionSource: "auto", CreatedAt: now}
		if err := service.repo.UpsertShotAssetReferenceActive(project.UserID, project.ID, &reference, now); err == nil {
			t.Fatalf("automatic binding restored excluded asset version %s", versionID)
		}
	}
	var stored []model.ShotAssetReference
	if err := db.Where("shot_id = ?", shot.ID).Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].Status != "excluded" {
		t.Fatalf("exclusion changed after rejected binding: %+v", stored)
	}
	manual := model.ShotAssetReference{ID: "manual", ShotID: shot.ID, AssetVersionID: next.ID, Role: "reference", Status: "linked", SelectionSource: "manual", CreatedAt: now}
	if err := service.repo.UpsertShotAssetReferenceActive(project.UserID, project.ID, &manual, now); err != nil {
		t.Fatal(err)
	}
	stored = nil
	if err := db.Where("shot_id = ?", shot.ID).Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].Status != "linked" || stored[0].AssetVersionID != next.ID {
		t.Fatalf("explicit manual selection did not replace the exclusion: %+v", stored)
	}
}

func TestManualShotAssetRemovalPersistsUntilExplicitReselection(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	unit := model.ProjectUnit{ID: "unit", ProjectID: project.ID, Title: "章", CreatedAt: now, UpdatedAt: now}
	shot := model.Shot{ID: "shot", ProjectID: project.ID, UnitID: unit.ID, CurrentRevisionID: "revision", Title: "镜头", CreatedAt: now, UpdatedAt: now}
	other := model.Shot{ID: "other-shot", ProjectID: project.ID, UnitID: unit.ID, Title: "另一镜头", CreatedAt: now, UpdatedAt: now}
	for _, row := range []any{&unit, &shot, &other} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	reference, err := service.LinkShotAsset(project.UserID, project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: asset.PrimaryVersionID, Role: "reference"})
	if err != nil {
		t.Fatal(err)
	}
	otherReference, err := service.LinkShotAsset(project.UserID, project.ID, other.ID, LinkShotAssetRequest{AssetVersionID: asset.PrimaryVersionID, Role: "reference"})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.UnlinkShotAsset("foreign", project.ID, shot.ID, reference.ID, true); err == nil {
		t.Fatal("foreign user removed the reference")
	}
	if err := service.UnlinkShotAsset(project.UserID, project.ID, other.ID, reference.ID, true); err == nil {
		t.Fatal("another shot removed the reference")
	}
	if err := service.UnlinkShotAsset(project.UserID, project.ID, shot.ID, reference.ID, true); err != nil {
		t.Fatal(err)
	}
	workspace, err := service.ProjectUnitWorkspace(project.UserID, project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.ShotReferences) != 2 {
		t.Fatalf("workspace lost persistent selection state: %+v", workspace.ShotReferences)
	}
	for _, stored := range workspace.ShotReferences {
		if stored.ShotID == shot.ID && (stored.Status != "excluded" || stored.Asset.ID != asset.ID) {
			t.Fatalf("manual removal was not persisted: %+v", stored)
		}
		if stored.ShotID == other.ID && stored.Status != "linked" {
			t.Fatal("manual removal affected another shot")
		}
	}
	if err := service.UnlinkShotAsset(project.UserID, project.ID, shot.ID, reference.ID); err == nil {
		t.Fatal("automatic cleanup deleted a manual exclusion")
	}
	if _, err := service.LinkShotAsset(project.UserID, project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: asset.PrimaryVersionID, Role: "reference", SelectionSource: "rule"}); err == nil {
		t.Fatal("automatic matching restored the removed asset")
	}
	current, _ := service.Owned(project.UserID, project.ID)
	choice := CharacterReferenceChoice{ShotID: shot.ID, AssetID: asset.ID, VersionID: asset.PrimaryVersionID, Status: "pending", Source: "rule", Reason: "自动匹配", ExpectedShotRevisionID: shot.CurrentRevisionID}
	request := SaveCharacterReferenceChoicesRequest{ExpectedRevision: current.Revision, Choices: []CharacterReferenceChoice{choice}}
	if err := service.SaveCharacterReferenceChoices(project.UserID, project.ID, unit.ID, request); err == nil {
		t.Fatal("character look detection restored the removed asset")
	}
	request.Choices[0].Source = "manual"
	if err := service.SaveCharacterReferenceChoices(project.UserID, project.ID, unit.ID, request); err != nil {
		t.Fatalf("explicit character reselection failed: %v", err)
	}
	var restored model.ShotAssetReference
	if err := db.First(&restored, "shot_id = ?", shot.ID).Error; err != nil || restored.Status != "linked" {
		t.Fatalf("manual choice did not restore the reference: %+v %v", restored, err)
	}
	if err := service.UnlinkShotAsset(project.UserID, project.ID, shot.ID, restored.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.LinkShotAsset(project.UserID, project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: asset.PrimaryVersionID, Role: "reference"}); err != nil {
		t.Fatalf("manual library binding failed: %v", err)
	}
	if err := service.UnlinkShotAsset(project.UserID, project.ID, other.ID, otherReference.ID); err != nil {
		t.Fatal(err)
	}
	var otherCount int64
	if err := db.Model(&model.ShotAssetReference{}).Where("shot_id = ?", other.ID).Count(&otherCount).Error; err != nil || otherCount != 0 {
		t.Fatalf("automatic cleanup created an exclusion: %d %v", otherCount, err)
	}
}

func TestExcludedShotReferencesDoNotBlockProjectAssetRemoval(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	shot := model.Shot{ID: "shot", ProjectID: project.ID, Title: "镜头"}
	excluded := model.ShotAssetReference{ID: "excluded", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "excluded"}
	for _, row := range []any{&shot, &excluded} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := service.UnlinkProjectAsset(project.UserID, project.ID, asset.ID); err != nil {
		t.Fatalf("excluded reference blocked asset removal: %v", err)
	}
	var count int64
	if err := db.Model(&model.ShotAssetReference{}).Where("shot_id = ?", shot.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("asset removal left orphan exclusions: %d %v", count, err)
	}
}
