package project

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCharacterCandidateDefaultConfirmationReusesIdentity(t *testing.T) {
	for _, name := range []string{"王大牛", "大牛"} {
		t.Run(name, func(t *testing.T) {
			service, db := newTestService(t, nil)
			project, asset := seedProjectCharacterRepresentation(t, db)
			seedReadyCharacterReference(t, db, project.UserID, asset.PrimaryVersionID)
			original := `{"name":"王大牛","aliases":["大牛"],"clothing":"灰色训练服","appearance":"黑发","voiceTimbre":"低沉"}`
			db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("definition_json", original)
			payload, _ := characterAssetPayload(asset.ID, asset.PrimaryVersionID, asset.Title, json.RawMessage(original), time.Now(), time.Now())
			db.Model(&model.Asset{}).Where("id = ?", asset.ID).Update("payload_json", payload)
			unit := model.ProjectUnit{ID: "reuse-chapter", ProjectID: project.ID, Title: "第二十一章", SourceText: "王大牛穿着训练服走入教室，肩头沾着碎冰。", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := db.Create(&unit).Error; err != nil {
				t.Fatal(err)
			}
			details := map[string]any{"role": "王大牛走入教室", "appearance": "神情严肃", "clothing": "训练服；肩头碎冰，具体款式未明确", "physique": "强壮", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "低沉"}
			candidate := model.ProjectAssetCandidate{ID: "legacy-candidate", ProjectID: project.ID, UnitID: unit.ID, Name: name, NameKey: model.AssetCandidateNameKey(name), Category: model.AssetCategoryCharacter, Status: "pending_confirmation", Source: AssetCandidateSourceChapterCharacter, CreatedAt: time.Now(), UpdatedAt: time.Now()}
			encoded, _ := json.Marshal(details)
			candidate.DetailsJSON = string(encoded)
			if err := db.Create(&candidate).Error; err != nil {
				t.Fatal(err)
			}
			result, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, candidate.ID, ConfirmProjectAssetCandidateRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if result.ID != asset.ID {
				t.Fatalf("same character created a separate asset: %s", result.ID)
			}
			versions, _ := service.repo.AssetVersions(asset.ID)
			if len(versions) != 1 || versions[0].DefinitionJSON != original {
				t.Fatal("reuse changed confirmed look or identity", versions)
			}
			if images, _ := service.repo.AssetRepresentations(asset.PrimaryVersionID); len(images) == 0 {
				t.Fatal("reuse lost original reference image")
			}
			links, err := service.repo.ProjectAssetUnitLinks(project.UserID, project.ID)
			if err != nil || len(links) != 1 || links[0].AssetID != asset.ID || links[0].UnitID != unit.ID {
				t.Fatal("chapter association missing", links, err)
			}
		})
	}
}

func TestCharacterCandidateAmbiguousIdentityRequiresExplicitTarget(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	another := asset
	another.ID, another.PrimaryVersionID = "duplicate-character", "duplicate-version"
	if err := db.Create(&another).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AssetVersion{ID: another.PrimaryVersionID, AssetID: another.ID, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ProjectAssetLink{ID: "duplicate-link", ProjectID: project.ID, AssetID: another.ID}).Error; err != nil {
		t.Fatal(err)
	}
	unit := model.ProjectUnit{ID: "ambiguous-unit", ProjectID: project.ID, SourceText: "王大牛来到教室。"}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	details := map[string]any{"role": "来到教室", "appearance": "黑发", "clothing": "灰色训练服", "physique": "强壮", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "低沉"}
	request := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: asset.Title, Category: "character", Details: details}}}
	created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(created) != 1 || created[0].Status != "pending_confirmation" || !strings.Contains(created[0].DetailsJSON, "ambiguous") {
		t.Fatal(created, err)
	}
	if _, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, created[0].ID, ConfirmProjectAssetCandidateRequest{}); err == nil || !strings.Contains(err.Error(), "多个同名角色") {
		t.Fatal("ambiguous identity silently merged or created", err)
	}
	var count int64
	db.Model(&model.Asset{}).Where("user_id = ?", project.UserID).Count(&count)
	if count != 2 {
		t.Fatal("ambiguous identity created another asset", count)
	}
	result, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, created[0].ID, ConfirmProjectAssetCandidateRequest{AssetID: asset.ID})
	if err != nil || result.ID != asset.ID {
		t.Fatal("explicit selection cannot reuse existing identity", result, err)
	}
	versions, err := service.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 1 {
		t.Fatal("explicit reuse fabricated new look", versions, err)
	}
	createdAgain, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(createdAgain) != 0 {
		t.Fatal("confirmed ambiguous candidate was recreated", createdAgain, err)
	}
}

func TestCharacterCandidateIdentityMatchingIsProjectScopedAndNameFirst(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	matches, err := service.matchingProjectCharactersWithCandidates([]model.Asset{asset, {ID: "other", Title: "李大牛", Category: model.AssetCategoryCharacter, PayloadJSON: `{"data":{"definition":{"aliases":["大牛"]}}}`}}, nil, "王大牛", map[string]any{"aliases": []string{"大牛"}})
	if err != nil || len(matches) != 1 || matches[0].ID != asset.ID {
		t.Fatal("generic alias overrode exact standard name", matches, err)
	}
	matches, err = service.matchingProjectCharactersWithCandidates([]model.Asset{asset}, []model.ProjectAssetCandidate{{Category: model.AssetCategoryCharacter, Status: "confirmed", ResolvedAssetID: asset.ID, Name: "王犟"}}, "王犟", nil)
	if err != nil || len(matches) != 1 || matches[0].ID != asset.ID {
		t.Fatal("explicitly confirmed alias was not reused", matches, err)
	}
	unit := model.ProjectUnit{ID: "scope-unit", ProjectID: project.ID, SourceText: "林夏进门。"}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	foreign := model.Asset{ID: "foreign", UserID: "different-user", Category: model.AssetCategoryCharacter, Title: "林夏", PrimaryVersionID: "foreign-version", Kind: "entity", Status: model.AssetVersionStatusConfirmed}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	details := map[string]any{"role": "进门", "appearance": "黑发", "clothing": "白衣", "physique": "纤细", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "清亮", "_characterMatch": map[string]any{"assetId": foreign.ID, "mode": "reuse"}}
	created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: foreign.Title, Category: "character", Details: details}}})
	if err != nil || len(created) != 1 || created[0].Status != "pending_confirmation" || created[0].ResolvedAssetID != "" || strings.Contains(created[0].DetailsJSON, "_characterMatch") {
		t.Fatal("untrusted target or another user was reused", created, err)
	}
	if _, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, created[0].ID, ConfirmProjectAssetCandidateRequest{AssetID: foreign.ID}); err == nil {
		t.Fatal("foreign target accepted")
	}
}

func TestCharacterCandidateRequiresVerbatimLookEvidence(t *testing.T) {
	for _, evidence := range []string{"", "她换上红裙", "少女"} {
		_, changed, err := provenCharacterLookChanges(map[string]any{"looks": []map[string]any{{"name": "红裙", "clothing": "红裙", "changeReason": "换装", "sourceEvidence": evidence}}}, "少女走进教室。")
		if err != nil || changed {
			t.Fatal("fabricated or insufficient evidence created look", evidence, err)
		}
	}
}

func TestCharacterCandidatesKeepDistinctMastersWithSharedMembershipAndClothing(t *testing.T) {
	service, db := newTestService(t, nil)
	project, _ := seedProjectCharacterRepresentation(t, db)
	unit := model.ProjectUnit{ID: "masters-unit", ProjectID: project.ID, SourceText: "大师傅苦劝，二师傅摇头，三师傅捂嘴。"}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"大师傅", "二师傅", "三师傅"} {
		details := map[string]any{"aliases": []string{"九浮屠之一"}, "role": "与徒弟在密室交谈", "appearance": "白发", "clothing": "深色常服", "physique": "硬朗", "voiceLanguage": "中文", "voiceAge": "老年", "voiceTimbre": "浑厚"}
		created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: name, Category: "character", Details: details}}})
		if err != nil || len(created) != 1 || created[0].Status != "pending_confirmation" {
			t.Fatalf("%s was discarded or merged: %+v %v", name, created, err)
		}
		confirmed, err := service.ConfirmProjectAssetCandidate(project.UserID, project.ID, created[0].ID, ConfirmProjectAssetCandidateRequest{})
		if err != nil || confirmed.Title != name {
			t.Fatalf("%s confirmation merged another member: %+v %v", name, confirmed, err)
		}
	}
}

func TestCharacterCandidateExtractionReusesUnprovenLookChanges(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	unit := model.ProjectUnit{ID: "reuse-chapter", ProjectID: project.ID, SourceText: "王大牛穿着训练服走入教室。", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	details := map[string]any{"role": "走入教室", "appearance": "黑发", "clothing": "训练服，其他未明确", "physique": "强壮", "voiceLanguage": "中文", "voiceAge": "青年", "voiceTimbre": "低沉"}
	request := CreateAssetCandidatesRequest{Source: AssetCandidateSourceChapterCharacter, Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: asset.Title, Category: "character", Details: details}}}
	created, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 || created[0].Status != "confirmed" || created[0].ResolvedAssetID != asset.ID {
		t.Fatalf("expected chapter association reusing confirmed character: %+v", created)
	}
	repeated, err := service.CreateProjectAssetCandidates(project.UserID, project.ID, request)
	if err != nil || len(repeated) != 0 {
		t.Fatal("reuse duplicated chapter association", repeated, err)
	}
}
