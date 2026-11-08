package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectAssetVersionSyncRepo(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{},
		&model.ProjectAssetLink{},
		&model.Asset{},
		&model.AssetVersion{},
		&model.AssetRepresentation{},
		&model.Shot{},
		&model.ShotAssetReference{},
		&model.ShotArtifact{},
		&model.WorkflowInstance{},
		&model.WorkflowStepInstance{},
	); err != nil {
		t.Fatal(err)
	}
	return New(db), db
}

func TestSaveProjectAssetImagePropagatesNewVersionToAllShotReferences(t *testing.T) {
	repo, db := newProjectAssetVersionSyncRepo(t)
	now := time.Now().UTC()
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "项目", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "scene-1", UserID: "user-1", Category: model.AssetCategoryEnvironment, Kind: "image", Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "scene-v2", Title: "夜景", CreatedAt: now, UpdatedAt: now}
	oldVersion := model.AssetVersion{ID: "scene-v1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, CreatedAt: now, UpdatedAt: now}
	shotOne := model.Shot{ID: "shot-1", ProjectID: project.ID, UnitID: "unit-1", Title: "镜头1", CreatedAt: now, UpdatedAt: now}
	shotTwo := model.Shot{ID: "shot-2", ProjectID: project.ID, UnitID: "unit-1", Title: "镜头2", CreatedAt: now, UpdatedAt: now}
	untouched := model.Asset{ID: "character-1", UserID: "user-1", Category: model.AssetCategoryCharacter, Kind: "image", Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "character-v1", Title: "人物", CreatedAt: now, UpdatedAt: now}
	characterVersion := model.AssetVersion{ID: "character-v1", AssetID: untouched.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, CreatedAt: now, UpdatedAt: now}
	for _, value := range []any{&project, &asset, &oldVersion, &shotOne, &shotTwo, &untouched, &characterVersion} {
		if err := db.Create(value).Error; err != nil {
			t.Fatalf("seed %T: %v", value, err)
		}
	}
	if err := db.Create(&model.ProjectAssetLink{ID: "link-1", ProjectID: project.ID, AssetID: asset.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ProjectAssetLink{ID: "link-2", ProjectID: project.ID, AssetID: untouched.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]model.ShotAssetReference{
		{ID: "ref-1", ShotID: shotOne.ID, AssetVersionID: oldVersion.ID, Role: "reference", Status: "linked", CreatedAt: now},
		{ID: "ref-2", ShotID: shotTwo.ID, AssetVersionID: oldVersion.ID, Role: "reference", Status: "linked", CreatedAt: now.Add(time.Second)},
		{ID: "ref-character", ShotID: shotOne.ID, AssetVersionID: characterVersion.ID, Role: "reference", Status: "linked", CreatedAt: now.Add(2 * time.Second)},
	}).Error; err != nil {
		t.Fatal(err)
	}

	newVersion := &model.AssetVersion{ID: "scene-v2", AssetID: asset.ID, Status: model.AssetVersionStatusConfirmed, CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute)}
	representation := &model.AssetRepresentation{ID: "representation-2", TaskID: "task-2", AssetVersionID: newVersion.ID, Role: "primary", MediaType: "image", CreatedAt: now.Add(time.Minute)}
	asset.UpdatedAt = now.Add(time.Minute)
	if err := repo.SaveProjectAssetImage(project.ID, &asset, newVersion, representation); err != nil {
		t.Fatalf("SaveProjectAssetImage: %v", err)
	}

	var references []model.ShotAssetReference
	if err := db.Order("id").Find(&references).Error; err != nil {
		t.Fatal(err)
	}
	if len(references) != 3 {
		t.Fatalf("reference count = %d, want 3", len(references))
	}
	for _, reference := range references {
		if reference.ID == "ref-1" || reference.ID == "ref-2" {
			if reference.AssetVersionID != newVersion.ID {
				t.Errorf("%s still points to %s, want %s", reference.ID, reference.AssetVersionID, newVersion.ID)
			}
		}
		if reference.ID == "ref-character" && reference.AssetVersionID != characterVersion.ID {
			t.Errorf("character reference changed to %s", reference.AssetVersionID)
		}
	}
	var storedAsset model.Asset
	if err := db.First(&storedAsset, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedAsset.PrimaryVersionID != newVersion.ID {
		t.Fatalf("primary version = %s, want %s", storedAsset.PrimaryVersionID, newVersion.ID)
	}
}

func TestSaveProjectAssetImageRemovesDuplicateNewVersionReference(t *testing.T) {
	_, db := newProjectAssetVersionSyncRepo(t)
	now := time.Now().UTC()
	project := model.Project{ID: "project-2", UserID: "user-2", Name: "项目", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "prop-1", UserID: "user-2", Category: model.AssetCategoryProp, Kind: "image", Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "prop-v2", Title: "道具", CreatedAt: now, UpdatedAt: now}
	oldVersion := model.AssetVersion{ID: "prop-v1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, CreatedAt: now, UpdatedAt: now}
	newVersion := model.AssetVersion{ID: "prop-v2", AssetID: asset.ID, Version: 2, Status: model.AssetVersionStatusConfirmed, CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute)}
	shot := model.Shot{ID: "shot-3", ProjectID: project.ID, UnitID: "unit-2", Title: "镜头", CreatedAt: now, UpdatedAt: now}
	for _, value := range []any{&project, &asset, &oldVersion, &newVersion, &shot} {
		if err := db.Create(value).Error; err != nil {
			t.Fatalf("seed %T: %v", value, err)
		}
	}
	if err := db.Create(&model.ProjectAssetLink{ID: "link-3", ProjectID: project.ID, AssetID: asset.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]model.ShotAssetReference{
		{ID: "old-ref", ShotID: shot.ID, AssetVersionID: oldVersion.ID, Role: "reference", Status: "linked", CreatedAt: now},
		{ID: "new-ref", ShotID: shot.ID, AssetVersionID: newVersion.ID, Role: "reference", Status: "linked", CreatedAt: now.Add(time.Second)},
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		return replaceProjectAssetReferencesTx(tx, project.ID, asset.ID, newVersion.ID, now.Add(2*time.Minute))
	}); err != nil {
		t.Fatalf("replaceProjectAssetReferencesTx: %v", err)
	}
	var references []model.ShotAssetReference
	if err := db.Where("shot_id = ?", shot.ID).Find(&references).Error; err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0].ID != "new-ref" || references[0].AssetVersionID != newVersion.ID {
		t.Fatalf("references after duplicate cleanup = %#v", references)
	}
}
