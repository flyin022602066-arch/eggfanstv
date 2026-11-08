package project

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChapterSceneReuseKeepsChapterAssociationWithoutChangingAsset(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "scene-project", UserID: "user-1", Name: "场景测试"})
	first := seedChapter(t, service, project.ID)
	second, err := service.CreateProjectUnit(project.UserID, project.ID, CreateProjectUnitRequest{Title: "第二章", SourceText: "她走进更衣室。"})
	if err != nil {
		t.Fatal(err)
	}
	request := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: first.ID, Name: "更衣室", Category: "environment", Details: map[string]any{"description": "金属柜与长凳"}}}}
	candidates, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(candidates) != 1 {
		t.Fatal(candidates, err)
	}
	asset, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	request.Candidates[0].UnitID = second.ID
	reused, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(reused) != 1 || reused[0].Status != "confirmed" || reused[0].ResolvedAssetID != asset.ID {
		t.Fatal("existing scene lost chapter association", reused, err)
	}
	links, err := service.repo.ProjectAssetUnitLinks(project.UserID, project.ID)
	if err != nil || len(links) != 2 {
		t.Fatal(links, err)
	}
	repeated, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(repeated) != 0 {
		t.Fatal("duplicate chapter link", repeated, err)
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 1 {
		t.Fatal("reuse created a new version", versions, err)
	}
}

func TestChapterSceneGenericAliasDoesNotDiscardDifferentLocation(t *testing.T) {
	service, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "scene-project", UserID: "user-1", Name: "场景测试"})
	unit := seedChapter(t, service, project.ID)
	request := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "射击训练区", Category: "environment", Details: map[string]any{"aliases": []string{"训练区"}, "description": "移动射击靶"}}}}
	candidates, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(candidates) != 1 {
		t.Fatal(candidates, err)
	}
	if _, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{}); err != nil {
		t.Fatal(err)
	}
	request.Candidates[0].Name = "室内攀爬训练区"
	request.Candidates[0].Details = map[string]any{"aliases": []string{"训练区"}, "description": "攀爬架与软垫"}
	created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(created) != 1 || created[0].Status != "pending_confirmation" || created[0].ResolvedAssetID != "" {
		t.Fatal("generic alias discarded a distinct scene", created, err)
	}
}
