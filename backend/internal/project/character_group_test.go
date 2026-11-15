package project

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/characterkind"
	"infinite-canvas/backend/internal/model"
)

func TestGroupCandidateConfirmationPreservesMembersAsOneReference(t *testing.T) {
	service, db := newTestService(t, nil)
	project, _ := seedProjectCharacterRepresentation(t, db)
	unit := model.ProjectUnit{ID: "extras-unit", ProjectID: project.ID, SourceText: "三师傅走进凉粉摊，工人与食客群像在旁，工人穿工装，食客穿常服。"}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	details := map[string]any{"characterType": "group", "role": "【群体演员】工人与食客现场用餐", "appearance": "成年男性，面孔各异", "physique": "高矮不同", "clothing": "工人穿工装，食客穿常服", "voiceLanguage": "中文", "voiceAge": "成年", "voiceTimbre": "各有不同", "looks": []map[string]any{{"name": "工人", "clothing": "蓝灰工装"}, {"name": "食客", "clothing": "日常常服"}}}
	created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "工人与食客群像", Category: "character", Details: details}}})
	if err != nil || len(created) != 1 {
		t.Fatalf("group candidate missing: %+v %v", created, err)
	}
	asset, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, created[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 1 || countCharacterLooks(versions) != 1 {
		t.Fatalf("group members split into looks: %+v %v", versions, err)
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(versions[0].DefinitionJSON), &saved); err != nil || !characterkind.IsGroup(asset.Title, saved) || saved["clothing"] != details["clothing"] {
		t.Fatalf("group type or script facts lost: %+v %v", saved, err)
	}
	if err := service.ValidateCharacterIdentityReference(project.UserID, asset.ID, versions[0].ID, "", "", nil); err != nil {
		t.Fatal("group cannot generate without a single face", err)
	}
	if _, err := service.ExtractCharacterLooks(project.UserID, project.ID, asset.ID, ExtractCharacterLooksRequest{BaseVersionID: versions[0].ID, ExpectedUpdatedAt: versions[0].UpdatedAt}); err == nil {
		t.Fatal("group members incorrectly accepted as different looks")
	}
}

func TestGroupLegacyTitleDoesNotSplitMemberOutfits(t *testing.T) {
	source := `{"clothing":"造型1：工装；造型2：常服"}`
	version := model.AssetVersion{ID: "group-version", DefinitionJSON: source}
	extra, err := isolatedCharacterLookVersions(&version, source, "买凉粉的工人与食客群像")
	if err != nil || len(extra) != 0 {
		t.Fatal(extra, err)
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(version.DefinitionJSON), &saved); err != nil || saved["characterType"] != "group" {
		t.Fatal("inferred group type not saved", saved, err)
	}
}
