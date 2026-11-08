package project

import (
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"strings"
	"testing"
	"time"
)

func TestCharacterCandidateCreatesSeparateLookVersions(t *testing.T) {
	s, db := newTestService(t, nil)
	p, _ := seedProjectCharacterRepresentation(t, db)
	unit := model.ProjectUnit{ID: "outfit-chapter", ProjectID: p.ID, Title: "换装", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	definition := map[string]any{"name": "云舒", "role": "女主", "appearance": "黑发", "clothing": "造型1（居家）：黑色睡裙；造型2（兔子睡衣）：粉色连体睡衣；造型3（前置）：白色上衣灰裤", "physique": "纤细", "consistencyPrompt": "黑色睡裙", "multiViewPrompt": "三视图", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "清亮"}
	candidates, err := s.CreateProjectAssetCandidates(p.UserID, p.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "云舒", Category: "character", Details: definition}}})
	if err != nil || len(candidates) != 1 {
		t.Fatal(candidates, err)
	}
	asset, err := s.ConfirmProjectAssetCandidate(p.UserID, p.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 3 {
		t.Fatalf("want three isolated looks, got %d: %v", len(versions), err)
	}
	groups := map[string]bool{}
	for _, v := range versions {
		profile := referenceProfile(v.ReferenceProfileJSON)
		if profile == nil || profile.Preferred {
			t.Fatal("unreviewed look must have group but no final image")
		}
		groups[profile.LookID] = true
		var d map[string]any
		_ = json.Unmarshal([]byte(v.DefinitionJSON), &d)
		if _, ok := d["looks"]; ok {
			t.Fatal("sibling outfits leaked")
		}
	}
	if len(groups) != 3 {
		t.Fatal("looks collapsed")
	}
	if asset.CharacterLookCount != 3 {
		t.Fatalf("look count = %d, want 3", asset.CharacterLookCount)
	}
}

func TestCharacterLookCountSeparatesLooksFromImageHistory(t *testing.T) {
	versions := []model.AssetVersion{
		{DefinitionJSON: `{"clothing":"战术制服"}`, Status: model.AssetVersionStatusConfirmed, ReferenceProfileJSON: `{"lookId":"daily","name":"默认造型"}`},
		{DefinitionJSON: `{"clothing":"战术制服"}`, Status: model.AssetVersionStatusConfirmed, ReferenceProfileJSON: `{"lookId":"daily","name":"默认造型"}`},
	}
	if got := countCharacterLooks(versions); got != 1 {
		t.Fatalf("same look after first image = %d, want 1", got)
	}
	versions = append(versions, model.AssetVersion{Status: model.AssetVersionStatusConfirmed, ReferenceProfileJSON: `{"lookId":"injured","name":"重伤造型"}`})
	versions = append(versions, model.AssetVersion{Status: model.AssetVersionStatusArchived, ReferenceProfileJSON: `{"lookId":"archived"}`})
	if got := countCharacterLooks(versions); got != 2 {
		t.Fatalf("two looks plus history = %d, want 2", got)
	}
}

func TestCharacterCandidateKeepsNewLooksAcrossChapters(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	unit := model.ProjectUnit{ID: "outfit-chapter", ProjectID: p.ID, Title: "第二章", SourceText: "她换上粉色兔耳睡衣。", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	base := map[string]any{"name": asset.Title, "role": "女主", "aliases": []string{"小云"}, "appearance": "黑发", "clothing": "白色上衣", "physique": "纤细", "consistencyPrompt": "同一身份", "multiViewPrompt": "三视图", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "清亮"}
	encoded, _ := json.Marshal(base)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	base["clothing"] = "粉色兔耳睡衣"
	base["looks"] = []map[string]any{{"name": "兔耳睡衣", "clothing": "粉色兔耳睡衣", "changeReason": "由白色上衣换为粉色兔耳睡衣", "sourceEvidence": "她换上粉色兔耳睡衣"}}
	req := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: asset.Title, Category: "character", Details: base}}}
	candidates, err := s.CreateProjectAssetCandidates(p.UserID, p.ID, req)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("new outfit discarded: %d %v", len(candidates), err)
	}
	if duplicate, err := s.CreateProjectAssetCandidates(p.UserID, p.ID, req); err != nil || len(duplicate) != 0 {
		t.Fatalf("pending outfit duplicated: %+v %v", duplicate, err)
	}
	if _, err := s.ConfirmProjectAssetCandidate(p.UserID, p.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{}); err != nil {
		t.Fatal(err)
	}
	versions, _ := s.repo.AssetVersions(asset.ID)
	if len(versions) != 2 {
		t.Fatal("new outfit not merged", len(versions))
	}
	profile := referenceProfile(versions[0].ReferenceProfileJSON)
	if profile == nil || !strings.Contains(profile.Description, "由白色上衣换为粉色兔耳睡衣") {
		t.Fatal("confirmed look lost difference explanation", profile)
	}
	var next map[string]any
	_ = json.Unmarshal([]byte(versions[0].DefinitionJSON), &next)
	if next["clothing"] != "粉色兔耳睡衣" {
		t.Fatal("old outfit contaminated new version", next)
	}
	if reps, _ := s.repo.AssetRepresentations(versions[0].ID); len(reps) != 0 {
		t.Fatal("new outfit inherited incorrect image")
	}
	if duplicate, err := s.CreateProjectAssetCandidates(p.UserID, p.ID, req); err != nil || len(duplicate) != 0 {
		t.Fatalf("confirmed outfit duplicated: %+v %v", duplicate, err)
	}
}

func TestCharacterLookExtractionPreservesHistoryAndIsIdempotent(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, p.UserID, asset.PrimaryVersionID)
	mixed := `{"appearance":"黑发","clothing":"造型1（居家）：黑裙；造型2（兔耳）：粉色睡衣；造型3（前置）：白衣灰裤"}`
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", mixed).Error; err != nil {
		t.Fatal(err)
	}
	base, _ := s.repo.AssetVersion(asset.PrimaryVersionID)
	req := ExtractCharacterLooksRequest{BaseVersionID: base.ID, ExpectedUpdatedAt: base.UpdatedAt}
	if _, err := s.ExtractCharacterLooks("foreign", p.ID, asset.ID, req); err == nil {
		t.Fatal("foreign accepted")
	}
	stale := req
	stale.ExpectedUpdatedAt = stale.ExpectedUpdatedAt.Add(-time.Second)
	if _, err := s.ExtractCharacterLooks(p.UserID, p.ID, asset.ID, stale); err == nil {
		t.Fatal("stale accepted")
	}
	created, err := s.ExtractCharacterLooks(p.UserID, p.ID, asset.ID, req)
	if err != nil || len(created) != 3 {
		t.Fatalf("%+v %v", created, err)
	}
	for _, v := range created {
		if reps, _ := s.repo.AssetRepresentations(v.ID); len(reps) != 0 {
			t.Fatal("incorrect inherited image")
		}
	}
	old, _ := s.repo.AssetVersion(base.ID)
	if old.DefinitionJSON != mixed {
		t.Fatal("history overwritten")
	}
	if reps, _ := s.repo.AssetRepresentations(base.ID); len(reps) == 0 {
		t.Fatal("history image lost")
	}
	if repeat, err := s.ExtractCharacterLooks(p.UserID, p.ID, asset.ID, req); err != nil || len(repeat) != 0 {
		t.Fatalf("not idempotent: %+v %v", repeat, err)
	}
	if versions, _ := s.repo.AssetVersions(asset.ID); len(versions) != 4 {
		t.Fatal("duplicate versions", len(versions))
	}
}

func TestCharacterTurnaroundRejectsCombinedLooks(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", `{"clothing":"白衬衫；后换为黑裙"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateCharacterTurnaroundSource(p.UserID, asset.ID, asset.PrimaryVersionID); err == nil {
		t.Fatal("combined outfit accepted")
	}
	if err := s.ValidateCharacterTurnaroundSource("foreign", asset.ID, asset.PrimaryVersionID); err == nil {
		t.Fatal("foreign accepted")
	}
}
