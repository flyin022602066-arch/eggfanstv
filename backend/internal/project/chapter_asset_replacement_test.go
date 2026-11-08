package project

import (
	"encoding/json"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestChapterAssetReextractReplacesDraftsAndKeepsConfirmedAndOtherChapters(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "project-1", UserID: "user-1", Name: "短剧"})
	unit := seedChapter(t, svc, project.ID)
	other, err := svc.CreateProjectUnit(project.UserID, project.ID, CreateProjectUnitRequest{Kind: "chapter", Title: "第二集", SourceText: "其他剧情"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	shot := model.Shot{ID: "chapter-shot", ProjectID: project.ID, UnitID: unit.ID, Title: "本集镜头"}
	if err := db.Create(&shot).Error; err != nil {
		t.Fatal(err)
	}
	drafts := []model.ProjectAssetCandidate{
		{ID: "old-character", ProjectID: project.ID, UnitID: unit.ID, Name: "小红帽", NameKey: model.AssetCandidateNameKey("小红帽"), Category: model.AssetCategoryCharacter, Status: "pending_confirmation", Source: AssetCandidateSourceChapterCharacter, DetailsJSON: mustReplacementJSON(t, validChapterCharacterDetails()), CreatedAt: now, UpdatedAt: now},
		{ID: "old-scene", ProjectID: project.ID, UnitID: unit.ID, Name: "森林", NameKey: model.AssetCandidateNameKey("森林"), Category: model.AssetCategoryEnvironment, Status: "pending_confirmation", DetailsJSON: `{"description":"旧森林"}`, CreatedAt: now, UpdatedAt: now},
		{ID: "old-prop", ProjectID: project.ID, UnitID: unit.ID, Name: "旧篮子", NameKey: model.AssetCandidateNameKey("旧篮子"), Category: model.AssetCategoryProp, Status: "pending_confirmation", Source: "manual", DetailsJSON: `{}`, CreatedAt: now, UpdatedAt: now},
		{ID: "shot-only-draft", ProjectID: project.ID, ShotID: shot.ID, Name: "镜头草稿", NameKey: model.AssetCandidateNameKey("镜头草稿"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`, CreatedAt: now, UpdatedAt: now},
		{ID: "other-draft", ProjectID: project.ID, UnitID: other.ID, Name: "雨伞", NameKey: model.AssetCandidateNameKey("雨伞"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`, CreatedAt: now, UpdatedAt: now},
		{ID: "confirmed", ProjectID: project.ID, UnitID: unit.ID, Name: "已确认道具", NameKey: model.AssetCandidateNameKey("已确认道具"), Category: model.AssetCategoryProp, Status: "confirmed", DetailsJSON: `{}`, CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&drafts).Error; err != nil {
		t.Fatal(err)
	}
	seedSucceededChapterTask(t, db, chapterTaskSeed{ID: "new-extract", UserID: project.UserID, ProjectID: project.ID, ChapterID: unit.ID, Kind: chapterApplyCharacters})
	details := validChapterCharacterDetails()
	details["appearance"] = "最新外貌描述"
	req := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, SourceTaskID: "new-extract", Candidates: []AssetCandidateInput{
		{UnitID: unit.ID, Name: "小红帽", Category: "character", Details: details},
		{UnitID: unit.ID, Name: "森林", Category: "environment", Details: map[string]any{"description": "最新森林"}},
		{UnitID: unit.ID, Name: "镜头草稿", Category: "prop", Details: map[string]any{"description": "最新道具"}},
	}}
	created, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 3 {
		t.Fatalf("latest result created %d candidates, want 3; old drafts blocked extraction", len(created))
	}
	var current []model.ProjectAssetCandidate
	if err := db.Find(&current).Error; err != nil {
		t.Fatal(err)
	}
	if len(current) != 5 {
		t.Fatalf("stored %d candidates, want 3 latest + confirmed + other chapter", len(current))
	}
	for _, c := range current {
		if c.ID == "old-character" || c.ID == "old-scene" || c.ID == "old-prop" || c.ID == "shot-only-draft" {
			t.Fatalf("stale draft remains: %s", c.ID)
		}
	}
	if created[0].DetailsJSON == drafts[0].DetailsJSON {
		t.Fatal("new character details were discarded")
	}
	replay, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, req)
	if err != nil || len(replay) != 3 || replay[0].ID != created[0].ID {
		t.Fatalf("replay changed latest drafts: %#v %v", replay, err)
	}
	seedSucceededChapterTask(t, db, chapterTaskSeed{ID: "next-extract", UserID: project.UserID, ProjectID: project.ID, ChapterID: unit.ID, Kind: chapterApplyCharacters})
	next, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, SourceTaskID: "next-extract", Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "最终道具", Category: "prop", Details: map[string]any{"description": "最终版本"}}}})
	if err != nil || len(next) != 1 {
		t.Fatalf("next extraction: %#v %v", next, err)
	}
	if _, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, req); err != nil {
		t.Fatal(err)
	}
	var latest []model.ProjectAssetCandidate
	if err := db.Where("unit_id = ? AND status = ?", unit.ID, "pending_confirmation").Find(&latest).Error; err != nil {
		t.Fatal(err)
	}
	if len(latest) != 1 || latest[0].ID != next[0].ID {
		t.Fatalf("old receipt restored stale drafts: %#v", latest)
	}
}

func TestChapterAssetReextractEmptyResultClearsDrafts(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "project-1", UserID: "user-1", Name: "短剧"})
	unit := seedChapter(t, svc, project.ID)
	draft := model.ProjectAssetCandidate{ID: "stale", ProjectID: project.ID, UnitID: unit.ID, Name: "旧道具", NameKey: model.AssetCandidateNameKey("旧道具"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`}
	if err := db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	seedSucceededChapterTask(t, db, chapterTaskSeed{ID: "empty-extract", UserID: project.UserID, ProjectID: project.ID, ChapterID: unit.ID, Kind: chapterApplyCharacters})
	_, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, SourceTaskID: "empty-extract"})
	if err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.ProjectAssetCandidate{}).Where("unit_id = ? AND status = ?", unit.ID, "pending_confirmation").Count(&count)
	if count != 0 {
		t.Fatalf("empty latest result left %d stale drafts", count)
	}
	assertSingleChapterApplyReceipt(t, db, project.UserID, "empty-extract")
}

func TestChapterAssetReextractInvalidResultKeepsDrafts(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "project-1", UserID: "user-1", Name: "短剧"})
	unit := seedChapter(t, svc, project.ID)
	draft := model.ProjectAssetCandidate{ID: "keep", ProjectID: project.ID, UnitID: unit.ID, Name: "旧道具", NameKey: model.AssetCandidateNameKey("旧道具"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`}
	if err := db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	seedSucceededChapterTask(t, db, chapterTaskSeed{ID: "invalid-extract", UserID: project.UserID, ProjectID: project.ID, ChapterID: unit.ID, Kind: chapterApplyCharacters})
	_, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, SourceTaskID: "invalid-extract", Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "", Category: "prop"}}})
	if err == nil {
		t.Fatal("invalid extraction accepted")
	}
	var stored model.ProjectAssetCandidate
	if err := db.First(&stored, "id = ?", draft.ID).Error; err != nil {
		t.Fatal("old draft removed before successful replacement", err)
	}
}

func mustReplacementJSON(t *testing.T, value any) string {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestChapterAssetReextractInsertFailureRollsBackDraftRemoval(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "project-1", UserID: "user-1", Name: "短剧"})
	unit := seedChapter(t, svc, project.ID)
	draft := model.ProjectAssetCandidate{ID: "keep", ProjectID: project.ID, UnitID: unit.ID, Name: "旧道具", NameKey: model.AssetCandidateNameKey("旧道具"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: `{}`}
	if err := db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	seedSucceededChapterTask(t, db, chapterTaskSeed{ID: "rollback-extract", UserID: project.UserID, ProjectID: project.ID, ChapterID: unit.ID, Kind: chapterApplyCharacters})
	if err := db.Exec(`CREATE TRIGGER fail_new_candidate BEFORE INSERT ON project_asset_candidates WHEN NEW.name = '新道具' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	_, err := svc.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, SourceTaskID: "rollback-extract", Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "新道具", Category: "prop", Details: map[string]any{"description": "新道具"}}}})
	if err == nil {
		t.Fatal("expected insert failure")
	}
	var stored model.ProjectAssetCandidate
	if err := db.First(&stored, "id = ?", draft.ID).Error; err != nil {
		t.Fatal("old draft was not restored on rollback", err)
	}
	assertNoChapterApplyReceipt(t, db, project.UserID, "rollback-extract")
}
