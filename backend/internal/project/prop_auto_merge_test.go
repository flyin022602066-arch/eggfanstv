package project

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestPropCandidateConfirmationReusesSameNameAcrossChapters(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "prop-project", UserID: "user-1", Name: "道具去重"})
	for _, unitID := range []string{"first", "second"} {
		unit := model.ProjectUnit{ID: unitID, ProjectID: project.ID, Title: unitID, Kind: model.ProjectUnitKindChapter}
		candidate := model.ProjectAssetCandidate{ID: unitID + "-candidate", ProjectID: project.ID, UnitID: unitID, Name: "铜钥匙", NameKey: "铜钥匙", Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{"description":"铜制旧钥匙"}`, CreatedAt: time.Now(), UpdatedAt: time.Now()}
		for _, row := range []any{&unit, &candidate} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	first, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, "first-candidate", ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, "second-candidate", ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("same-name prop created twice: %s, %s", first.ID, second.ID)
	}
	assets, err := service.ProjectAssets(project.UserID, project.ID)
	if err != nil || len(assets) != 1 || assets[0].VersionCount != 1 {
		t.Fatalf("duplicate assets or empty versions: %+v, %v", assets, err)
	}
	links, err := service.repo.ProjectAssetUnitLinks(project.UserID, project.ID)
	if err != nil || len(links) != 2 {
		t.Fatalf("chapter associations lost: %+v, %v", links, err)
	}
}

func TestAutoMergeSameNamePropsPreservesVersionsAndExclusions(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	if err := db.Model(&model.Asset{}).Where("id IN ?", []string{"source", "target"}).Update("title", "药箱").Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.AssetVersion{ID: "source-v2", AssetID: "source", Version: 2, DefinitionJSON: `{"description":"第二版"}`},
		&model.AssetRepresentation{ID: "source-image", TaskID: "source-task", AssetVersionID: "source-v1", MediaType: "image", Role: "reference", ResourceID: "first-image"},
		&model.AssetRepresentation{ID: "source-image-2", TaskID: "source-task-2", AssetVersionID: "source-v2", MediaType: "image", Role: "reference", ResourceID: "second-image"},
		&model.Shot{ID: "shot", ProjectID: project.ID},
		&model.ShotAssetReference{ID: "manual", ShotID: "shot", AssetVersionID: "source-v2", Role: "reference", Status: "excluded", SelectionSource: "manual", SelectionLocked: true},
		&model.ShotArtifact{ID: "ready-video", ProjectID: project.ID, ShotID: "shot", Type: "video", Status: "ready", Selected: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := service.MergeSameNameProjectProps(project.UserID, project.ID)
	if err != nil || result.Merged != 1 || result.Deferred != 0 {
		t.Fatalf("auto merge = %+v, %v", result, err)
	}
	assets, err := service.ProjectAssets(project.UserID, project.ID)
	if err != nil || len(assets) != 1 || assets[0].VersionCount != 3 {
		t.Fatalf("merged assets = %+v, %v", assets, err)
	}
	var reference model.ShotAssetReference
	if err := db.First(&reference, "shot_id = ?", "shot").Error; err != nil {
		t.Fatal(err)
	}
	var version model.AssetVersion
	db.First(&version, "id = ?", reference.AssetVersionID)
	if reference.Status != "excluded" || !reference.SelectionLocked || version.AssetID != assets[0].ID || !strings.Contains(version.DefinitionJSON, "第二版") {
		t.Fatalf("manual version lost: %+v, %+v", reference, version)
	}
	var artifact model.ShotArtifact
	db.First(&artifact, "id = ?", "ready-video")
	if artifact.Status != "ready" || !artifact.Selected {
		t.Fatalf("existing video changed: %+v", artifact)
	}
	result, err = service.MergeSameNameProjectProps(project.UserID, project.ID)
	if err != nil || result.Merged != 0 {
		t.Fatalf("merge not idempotent: %+v, %v", result, err)
	}
}

func TestAutoMergeSameNamePropsDefersBusyGroupsAndRejectsForeignProject(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	db.Model(&model.Asset{}).Where("id IN ?", []string{"source", "target"}).Update("title", "药箱")
	db.Create(&model.Task{ID: "busy", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_image", Status: "running", InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"source"}}`})
	result, err := service.MergeSameNameProjectProps(project.UserID, project.ID)
	if err != nil || result.Merged != 0 || result.Deferred != 1 {
		t.Fatalf("busy group = %+v, %v", result, err)
	}
	if _, err := service.MergeSameNameProjectProps("other-user", project.ID); err == nil {
		t.Fatal("foreign project accepted")
	}
	var projectAfter model.Project
	db.First(&projectAfter, "id = ?", project.ID)
	if projectAfter.Revision != project.Revision {
		t.Fatal("busy rollback changed revision")
	}
}

func TestAutoMergePropsRetainsPrimaryImageWithoutRepresentation(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	if err := db.Model(&model.Asset{}).Where("id IN ?", []string{"source", "target"}).Updates(map[string]any{"title": "药箱", "created_at": time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", "target").Update("created_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "source-image", UserID: project.UserID, Kind: "image", Status: "ready"}).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.MergeSameNameProjectProps(project.UserID, project.ID)
	if err != nil || result.Merged != 1 {
		t.Fatalf("merge = %+v, %v", result, err)
	}
	var representations []model.AssetRepresentation
	if err := db.Joins("JOIN asset_versions v ON v.id = asset_representations.asset_version_id").Where("v.asset_id = ?", "target").Find(&representations).Error; err != nil {
		t.Fatal(err)
	}
	if len(representations) != 1 || representations[0].ResourceID != "source-image" || representations[0].TaskID != "" {
		t.Fatalf("copied primary image missing: %+v", representations)
	}
}

func TestPropCandidateExplicitTargetIsNotOverriddenBySameName(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	if err := db.Model(&model.Asset{}).Where("id = ?", "source").Update("title", "药箱").Error; err != nil {
		t.Fatal(err)
	}
	candidate := model.ProjectAssetCandidate{ID: "candidate", ProjectID: project.ID, Name: "药箱", NameKey: "药箱", Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	result, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, candidate.ID, ConfirmProjectAssetCandidateRequest{AssetID: "target"})
	if err != nil || result.ID != "target" {
		t.Fatalf("explicit selection overridden: %+v, %v", result, err)
	}
}
