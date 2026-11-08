package project

import (
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestCharacterTurnaroundIdentityRequiresBaseImage(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	next, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: asset.PrimaryVersionID, Profile: CharacterReferenceProfile{Name: "战斗装", LookID: "combat", Enabled: true}, Definition: map[string]any{"clothing": "黑甲"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, "", "", nil); err == nil {
		t.Fatal("alternate look without base image accepted")
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, asset.PrimaryVersionID, "", "", nil); err != nil {
		t.Fatal(err)
	}
	imageID := seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, asset.PrimaryVersionID, imageID, []string{imageID}); err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, "", "", []string{imageID}); err == nil {
		t.Fatal("missing identity snapshot accepted")
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, asset.PrimaryVersionID, imageID, []string{imageID, "other-image"}); err == nil {
		t.Fatal("mixed identities accepted")
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, asset.PrimaryVersionID, imageID, []string{"other-image"}); err == nil {
		t.Fatal("wrong image accepted")
	}
	if err := service.ValidateCharacterIdentityReference("foreign", asset.ID, next.ID, asset.PrimaryVersionID, imageID, []string{imageID}); err == nil {
		t.Fatal("foreign owner accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", imageID).Update("status", model.ResourceStatusPending).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, asset.PrimaryVersionID, imageID, []string{imageID}); err == nil {
		t.Fatal("unready reference accepted")
	}
}

func TestCharacterTurnaroundIdentityUsesEarliestBaseLookImage(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", `{"clothing":"白衣"}`).Error; err != nil {
		t.Fatal(err)
	}
	next, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: asset.PrimaryVersionID, Profile: CharacterReferenceProfile{Name: "战斗装", LookID: "combat", Enabled: true}, Definition: map[string]any{"clothing": "黑甲"}})
	if err != nil {
		t.Fatal(err)
	}
	basePicture := model.AssetVersion{ID: "base-image", AssetID: asset.ID, Version: 3, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"clothing":"白衣"}`, ReferenceProfileJSON: `{"lookId":"daily","enabled":true}`}
	if err := db.Create(&basePicture).Error; err != nil {
		t.Fatal(err)
	}
	baseImage := seedReadyCharacterReference(t, db, project.UserID, basePicture.ID)
	if err := db.Model(&model.AssetRepresentation{}).Where("asset_version_id = ?", basePicture.ID).Update("task_id", "base-image-task").Error; err != nil {
		t.Fatal(err)
	}
	variantImage := seedReadyCharacterReference(t, db, project.UserID, next.ID)
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, basePicture.ID, baseImage, []string{baseImage}); err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, next.ID, variantImage, []string{variantImage}); err == nil {
		t.Fatal("variant face replaced original identity")
	}
}

func TestCharacterTurnaroundIdentityRejectsExpressionOnlyAndArchivedSources(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	baseImage := seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
	if err := db.Model(&model.AssetRepresentation{}).Where("asset_version_id = ?", asset.PrimaryVersionID).Update("role", "expression_sheet").Error; err != nil {
		t.Fatal(err)
	}
	next, err := service.CreateCharacterLook(project.UserID, project.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: asset.PrimaryVersionID, Profile: CharacterReferenceProfile{Name: "战斗装", LookID: "combat", Enabled: true}, Definition: map[string]any{"clothing": "黑甲"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, asset.PrimaryVersionID, baseImage, []string{baseImage}); err == nil {
		t.Fatal("expression sheet accepted as identity base")
	}
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", next.ID).Update("status", model.AssetVersionStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, next.ID, "", "", nil); err == nil {
		t.Fatal("archived target accepted")
	}
}

func TestCharacterTurnaroundIdentityUsesFirstIsolatedLookAfterSplit(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", `{"clothing":"造型1：白衣；造型2：黑甲"}`).Error; err != nil {
		t.Fatal(err)
	}
	base, err := service.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, ExtractCharacterLooksRequest{BaseVersionID: base.ID, ExpectedUpdatedAt: base.UpdatedAt})
	if err != nil || len(created) != 2 {
		t.Fatal(created, err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, created[0].ID, "", "", nil); err != nil {
		t.Fatal("first isolated look cannot create base", err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, created[1].ID, "", "", nil); err == nil {
		t.Fatal("later look created without base")
	}
	imageID := seedReadyCharacterReference(t, db, project.UserID, base.ID)
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, created[1].ID, base.ID, imageID, []string{imageID}); err != nil {
		t.Fatal("original face lost after splitting legacy definition", err)
	}
}
