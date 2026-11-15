package project

import (
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func seedPropMerge(t *testing.T, db *gorm.DB) model.Project {
	t.Helper()
	project := seedProject(t, db, model.Project{ID: "merge-project", UserID: "user-1", Name: "道具合并"})
	for _, id := range []string{"source", "target"} {
		asset := model.Asset{ID: id, UserID: project.UserID, Category: model.AssetCategoryProp, Kind: "image", Title: id, PrimaryVersionID: id + "-v1", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"data":{"storageKey":"resource:` + id + `-image"}}`}
		version := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: id, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"description":"保留原设定","aliases":["` + id + `别名"]}`}
		link := model.ProjectAssetLink{ID: id + "-link", ProjectID: project.ID, AssetID: id}
		for _, row := range []any{&asset, &version, &link} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	return project
}

func TestMergeProjectPropMigratesReferencesAndPreservesSharedOriginals(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	other := seedProject(t, db, model.Project{ID: "other", UserID: project.UserID, Name: "其他项目"})
	for _, row := range []any{
		&model.ProjectAssetLink{ID: "shared-source", ProjectID: other.ID, AssetID: "source"},
		&model.ProjectAssetLink{ID: "shared-target", ProjectID: other.ID, AssetID: "target"},
		&model.ProjectAssetCandidate{ID: "chapter-source", ProjectID: project.ID, UnitID: "chapter-2", Name: "旧道具", NameKey: "旧道具", Category: model.AssetCategoryProp, Status: "confirmed", ResolvedAssetID: "source"},
		&model.Shot{ID: "shot", ProjectID: project.ID, CurrentRevisionID: "revision-1"},
		&model.ShotRevision{ID: "revision-1", ShotID: "shot", Version: 1, VideoPrompt: "拿起@[asset:source]，放在@[asset:target]旁", ImagePrompt: "@[asset:source]"},
		&model.ShotAssetReference{ID: "source-ref", ShotID: "shot", AssetVersionID: "source-v1", Role: "reference", Status: "linked"},
		&model.ShotAssetReference{ID: "target-ref", ShotID: "shot", AssetVersionID: "target-v1", Role: "reference", Status: "linked"},
		&model.ShotArtifact{ID: "old-video", ProjectID: project.ID, ShotID: "shot", Type: "video", Status: "ready", Selected: true},
		&model.Shot{ID: "other-shot", ProjectID: other.ID},
		&model.ShotAssetReference{ID: "other-ref", ShotID: "other-shot", AssetVersionID: "source-v1", Role: "reference", Status: "linked"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Asset.ID != "target" || result.Asset.StorageKey != "resource:target-image" || result.MergedShots != 1 {
		t.Fatalf("merge result = %+v", result)
	}
	var definition map[string]any
	if err := json.Unmarshal([]byte(result.Asset.DefinitionJSON), &definition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Asset.DefinitionJSON, "source别名") || !strings.Contains(result.Asset.DefinitionJSON, "旧道具") {
		t.Fatalf("merged aliases lost: %s", result.Asset.DefinitionJSON)
	}
	var links []model.ProjectAssetLink
	db.Where("project_id = ?", project.ID).Find(&links)
	if len(links) != 1 || links[0].AssetID != "target" {
		t.Fatalf("project links = %+v", links)
	}
	var refs []model.ShotAssetReference
	db.Where("shot_id = ?", "shot").Find(&refs)
	if len(refs) != 1 || refs[0].AssetVersionID != "target-v1" {
		t.Fatalf("references not deduplicated: %+v", refs)
	}
	var shot model.Shot
	db.First(&shot, "id = ?", "shot")
	var revision model.ShotRevision
	db.First(&revision, "id = ?", shot.CurrentRevisionID)
	if revision.Version != 2 || strings.Contains(revision.VideoPrompt, "@[asset:source]") || revision.ImagePrompt != "@[asset:target]" {
		t.Fatalf("current revision = %+v", revision)
	}
	var old model.ShotRevision
	db.First(&old, "id = ?", "revision-1")
	if !strings.Contains(old.VideoPrompt, "@[asset:source]") {
		t.Fatal("historical revision changed")
	}
	var candidate model.ProjectAssetCandidate
	db.First(&candidate, "id = ?", "chapter-source")
	if candidate.ResolvedAssetID != "target" || candidate.UnitID != "chapter-2" {
		t.Fatalf("chapter association = %+v", candidate)
	}
	var artifact model.ShotArtifact
	db.First(&artifact, "id = ?", "old-video")
	if artifact.Status != "stale" || artifact.Selected {
		t.Fatal("old result still current")
	}
	for _, row := range []any{&model.Asset{ID: "source"}, &model.AssetVersion{ID: "source-v1"}, &model.ProjectAssetLink{ID: "shared-source"}, &model.ShotAssetReference{ID: "other-ref"}} {
		if err := db.First(row).Error; err != nil {
			t.Fatalf("shared original removed: %v", err)
		}
	}
	var targetVersion model.AssetVersion
	db.First(&targetVersion, "id = ?", "target-v1")
	if strings.Contains(targetVersion.DefinitionJSON, "source") {
		t.Fatal("merge polluted another project's shared definition")
	}
	if _, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 2}); err == nil {
		t.Fatal("unlinked source merged twice")
	}
}

func TestMergeProjectPropPreservesManualExclusions(t *testing.T) {
	for _, excluded := range []string{"source", "target"} {
		t.Run(excluded, func(t *testing.T) {
			svc, db := newTestService(t, nil)
			project := seedPropMerge(t, db)
			db.Create(&model.Shot{ID: "shot", ProjectID: project.ID})
			for _, id := range []string{"source", "target"} {
				status := "linked"
				if id == excluded {
					status = "excluded"
				}
				db.Create(&model.ShotAssetReference{ID: id + "-ref", ShotID: "shot", AssetVersionID: id + "-v1", Role: "reference", Status: status, SelectionSource: "manual", SelectionLocked: true})
			}
			if _, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 1}); err != nil {
				t.Fatal(err)
			}
			var refs []model.ShotAssetReference
			db.Where("shot_id = ?", "shot").Find(&refs)
			if len(refs) != 1 || refs[0].AssetVersionID != "target-v1" || refs[0].Status != "excluded" || !refs[0].SelectionLocked {
				t.Fatalf("removed prop resurrected: %+v", refs)
			}
		})
	}
}

func TestMergeProjectPropWorkspaceUsesTargetForVideoSubmission(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	for _, row := range []any{
		&model.ProjectUnit{ID: "chapter", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "测试章节"},
		&model.Shot{ID: "shot", ProjectID: project.ID, UnitID: "chapter", CurrentRevisionID: "before-merge"},
		&model.ShotRevision{ID: "before-merge", ShotID: "shot", Version: 1, VideoPrompt: "拿起@[asset: source ]，再看向@[asset:target]", Action: "保持@[asset:source ]外形一致", ActionBeatsJSON: `[{"type":"asset_context","propNames":["source","target"]}]`},
		&model.ShotAssetReference{ID: "old-image", ShotID: "shot", AssetVersionID: "source-v1", Role: "reference", Status: "linked"},
		&model.ShotAssetReference{ID: "kept-image", ShotID: "shot", AssetVersionID: "target-v1", Role: "reference", Status: "linked"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 1}); err != nil {
		t.Fatal(err)
	}
	workspace, err := svc.ProjectUnitWorkspace(project.UserID, project.ID, "chapter")
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Assets) != 1 || workspace.Assets[0].ID != "target" || len(workspace.ShotReferences) != 1 {
		t.Fatalf("submission workspace contains duplicate props: %+v", workspace)
	}
	reference := workspace.ShotReferences[0]
	if reference.Status != "linked" || reference.AssetVersionID != "target-v1" || reference.Asset.ID != "target" || reference.Asset.StorageKey != "resource:target-image" || reference.ReferencedVersion.AssetID != "target" {
		t.Fatalf("submission would use the wrong reference image: %+v", reference)
	}
	var current model.ShotRevision
	for _, revision := range workspace.ShotRevisions {
		if revision.ID == workspace.Shots[0].CurrentRevisionID {
			current = revision
		}
	}
	if current.VideoPrompt != "拿起@[asset:target]，再看向@[asset:target]" || current.Action != "保持@[asset:target]外形一致" {
		t.Fatalf("submission prompt still references the merged-away prop: %+v", current)
	}
	var historical model.ShotRevision
	if err := db.First(&historical, "id = ?", "before-merge").Error; err != nil || historical.VideoPrompt != "拿起@[asset: source ]，再看向@[asset:target]" {
		t.Fatalf("historical prompt changed: %+v, %v", historical, err)
	}
}

func TestMergeProjectPropReusesOldAliasesInLaterChapters(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	if _, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 1}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ProjectUnit{ID: "later-unit", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "后续章节"}).Error; err != nil {
		t.Fatal(err)
	}
	candidates, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: "shot_asset_match", Candidates: []AssetCandidateInput{{Name: "source别名", Category: "prop", UnitID: "later-unit"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].ResolvedAssetID != "target" || candidates[0].Status != "confirmed" {
		t.Fatalf("old alias created another prop: %+v", candidates)
	}
}

func TestMergeProjectPropAllowsUnrelatedGeneration(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedPropMerge(t, db)
	if err := db.Create(&model.Task{ID: "unrelated-image", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"another-prop"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MergeProjectProp(project.UserID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: "target", ExpectedRevision: 1}); err != nil {
		t.Fatalf("unrelated asset blocked merge: %v", err)
	}
}

func TestMergeProjectPropRejectsInvalidAndBusyWritesAtomically(t *testing.T) {
	for _, kind := range []string{"foreign", "self", "category", "unlinked", "stale", "archived", "image-task", "shot-task"} {
		t.Run(kind, func(t *testing.T) {
			svc, db := newTestService(t, nil)
			project := seedPropMerge(t, db)
			userID, targetID, revision := project.UserID, "target", int64(1)
			switch kind {
			case "foreign":
				userID = "other-user"
			case "self":
				targetID = "source"
			case "category":
				db.Model(&model.Asset{}).Where("id = ?", "target").Update("category", "character")
			case "unlinked":
				db.Where("id = ?", "target-link").Delete(&model.ProjectAssetLink{})
			case "stale":
				revision = 2
			case "archived":
				db.Model(&project).Update("status", model.ProjectStatusArchived)
			case "image-task":
				db.Create(&model.Task{ID: "active-image", UserID: userID, ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"operation":"project_asset_image","assetId":"source"}}`})
			case "shot-task":
				db.Create(&model.Shot{ID: "shot", ProjectID: project.ID})
				db.Create(&model.ShotAssetReference{ID: "ref", ShotID: "shot", AssetVersionID: "source-v1", Status: "linked"})
				db.Create(&model.Task{ID: "active-video", UserID: userID, Status: model.TaskStatusRunning})
				db.Create(&model.ProductionTaskLink{ID: "active-link", TaskID: "active-video", ProjectID: project.ID, ShotID: "shot"})
			}
			if _, err := svc.MergeProjectProp(userID, project.ID, "source", MergeProjectPropRequest{TargetAssetID: targetID, ExpectedRevision: revision}); err == nil {
				t.Fatal("invalid merge accepted")
			}
			var sourceLinks int64
			db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", project.ID, "source").Count(&sourceLinks)
			if sourceLinks != 1 {
				t.Fatal("failed merge removed source")
			}
			db.First(&project, "id = ?", project.ID)
			if project.Revision != 1 {
				t.Fatal("failed merge changed revision")
			}
		})
	}
}
