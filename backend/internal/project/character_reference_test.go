package project

import (
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"strings"
	"testing"
	"time"
)

func TestCharacterReferenceCatalogAndProfiles(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	seedReadyCharacterReference(t, db, p.UserID, asset.PrimaryVersionID)
	if _, err := s.CharacterReferenceCatalog("foreign", p.ID); err == nil {
		t.Fatal("foreign catalog accepted")
	}
	version, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	profile := CharacterReferenceProfile{Name: "日常装", LookID: "daily", Description: "白色衬衫", Enabled: true, Preferred: true, Default: true}
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, version.ID, SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: version.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, version.ID, SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: version.UpdatedAt}); err == nil {
		t.Fatal("stale metadata overwrite accepted")
	}
	catalog, err := s.CharacterReferenceCatalog(p.UserID, p.ID)
	if err != nil || len(catalog.Versions) != 1 || catalog.Versions[0].ReferenceProfile.Name != "日常装" {
		t.Fatalf("catalog=%+v err=%v", catalog, err)
	}
	look, err := s.CreateCharacterLook(p.UserID, p.ID, asset.ID, CreateCharacterLookRequest{BaseVersionID: version.ID, Profile: CharacterReferenceProfile{Name: "战斗装", LookID: "combat", Enabled: true}, Definition: map[string]any{"clothing": "黑色作战服"}})
	if err != nil {
		t.Fatal(err)
	}
	reps, err := s.repo.AssetRepresentations(look.ID)
	if err != nil || len(reps) != 0 {
		t.Fatal("new look must not inherit old clothes images", reps, err)
	}
	catalog, err = s.CharacterReferenceCatalog(p.UserID, p.ID)
	if err != nil || len(catalog.Versions) != 2 {
		t.Fatal(catalog, err)
	}
}

func TestCharacterReferenceProfileRevisionRemainsMonotonic(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	expected := time.Now().Add(time.Hour)
	if err := db.Model(&model.AssetVersion{}).Where("id = ?", asset.PrimaryVersionID).Update("updated_at", expected).Error; err != nil {
		t.Fatal(err)
	}
	req := SaveCharacterReferenceProfileRequest{ExpectedUpdatedAt: expected, Profile: CharacterReferenceProfile{Name: "日常", LookID: "daily", Enabled: true}}
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, asset.PrimaryVersionID, req); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil || !stored.UpdatedAt.After(expected) {
		t.Fatalf("revision did not advance: updated=%v expected=%v err=%v", stored.UpdatedAt, expected, err)
	}
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, asset.PrimaryVersionID, req); err == nil {
		t.Fatal("stale profile revision accepted")
	}
}

func TestCharacterReferenceChoiceAtomicLocksAndConflicts(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	revision := func() int64 {
		project, err := s.Owned(p.UserID, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		return project.Revision
	}
	unit := model.ProjectUnit{ID: "u", ProjectID: p.ID, Title: "第一章", CreatedAt: now, UpdatedAt: now}
	shot := model.Shot{ID: "s", ProjectID: p.ID, UnitID: unit.ID, CurrentRevisionID: "r", Title: "镜头", CreatedAt: now, UpdatedAt: now}
	resource := model.Resource{ID: "image", UserID: p.UserID, Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady}
	for _, row := range []any{&unit, &shot, &resource, &model.AssetRepresentation{ID: "rep", AssetVersionID: asset.PrimaryVersionID, ResourceID: resource.ID, Role: "primary", MediaType: "image"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	version, _ := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, version.ID, SaveCharacterReferenceProfileRequest{ExpectedUpdatedAt: version.UpdatedAt, Profile: CharacterReferenceProfile{Name: "日常", LookID: "daily", Enabled: true, Preferred: true}}); err != nil {
		t.Fatal(err)
	}
	choice := CharacterReferenceChoice{ShotID: shot.ID, AssetID: asset.ID, VersionID: asset.PrimaryVersionID, Status: "resolved", Source: "manual", Locked: true, Reason: "手动指定日常装", ExpectedShotRevisionID: shot.CurrentRevisionID}
	req := SaveCharacterReferenceChoicesRequest{ExpectedRevision: revision(), Choices: []CharacterReferenceChoice{choice}}
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, req); err == nil {
		t.Fatal("stale batch accepted")
	}
	choice.Source = "auto"
	choice.Locked = false
	req.ExpectedRevision = revision()
	req.Choices = []CharacterReferenceChoice{choice}
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, req); err == nil || !strings.Contains(err.Error(), "锁定") {
		t.Fatal("auto overwrote lock", err)
	}
	choice.Source = "manual"
	req.Choices = []CharacterReferenceChoice{choice}
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "t", UserID: p.UserID, Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ProductionTaskLink{ID: "pt", ProjectID: p.ID, ShotID: shot.ID, TaskID: "t"}).Error; err != nil {
		t.Fatal(err)
	}
	req.ExpectedRevision = revision()
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, req); err == nil || !strings.Contains(err.Error(), "生成") {
		t.Fatal("busy shot updated", err)
	}
	if got := revision(); got != req.ExpectedRevision {
		t.Fatal("rejected transaction bumped revision", got)
	}
}

func seedReadyCharacterReference(t *testing.T, db *gorm.DB, owner, versionID string) string {
	t.Helper()
	resource := model.Resource{ID: "image-" + versionID, UserID: owner, Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady}
	for _, row := range []any{&resource, &model.AssetRepresentation{ID: "rep-" + versionID, AssetVersionID: versionID, ResourceID: resource.ID, Role: "primary", MediaType: "image"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return resource.ID
}

func TestCharacterReferenceSubmissionAndScriptReview(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	imageID := seedReadyCharacterReference(t, db, p.UserID, asset.PrimaryVersionID)
	now := time.Now()
	unit := model.ProjectUnit{ID: "unit", ProjectID: p.ID, Title: "章", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	req := CreateProjectShotRequest{UnitID: unit.ID, Title: "镜头", Description: "白衣推门", DurationMs: 15000, Revision: ShotRevisionInput{PlotDescription: "白衣推门", Action: "抬手"}}
	shot, err := s.CreateProjectShot(p.UserID, p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	ref := model.ShotAssetReference{ID: "ref", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked", SelectionStatus: "resolved", SelectionSource: "auto", SelectionRevisionID: shot.CurrentRevisionID, CreatedAt: now}
	if err := db.Create(&ref).Error; err != nil {
		t.Fatal(err)
	}
	input := CharacterReferenceSubmission{ProjectID: p.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Snapshot: []CharacterReferenceSnapshot{{AssetID: asset.ID, VersionID: asset.PrimaryVersionID, ResourceID: imageID}}}
	if err := s.ValidateCharacterReferenceSubmission(p.UserID, input, []string{imageID}); err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateCharacterReferenceSubmission(p.UserID, input, []string{"wrong-image"}); err == nil {
		t.Fatal("wrong submitted resource accepted")
	}
	wrong := input
	wrong.Snapshot = []CharacterReferenceSnapshot{{AssetID: asset.ID, VersionID: "foreign", ResourceID: imageID}}
	if err := s.ValidateCharacterReferenceSubmission(p.UserID, wrong, []string{imageID}); err == nil {
		t.Fatal("wrong version accepted")
	}
	if err := s.ValidateCharacterReferenceSubmission("foreign-user", input, []string{imageID}); err == nil {
		t.Fatal("foreign project accepted")
	}
	req.ID = shot.ID
	unchanged, err := s.CreateProjectShot(p.UserID, p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	input.RevisionID = unchanged.CurrentRevisionID
	if err := s.ValidateCharacterReferenceSubmission(p.UserID, input, []string{imageID}); err != nil {
		t.Fatal("unchanged script lost review", err)
	}
	req.Revision.Action = "脱下白衣换上黑甲"
	changed, err := s.CreateProjectShot(p.UserID, p.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	input.RevisionID = changed.CurrentRevisionID
	if err := s.ValidateCharacterReferenceSubmission(p.UserID, input, []string{imageID}); err == nil {
		t.Fatal("changed script did not require review")
	}
}

func TestCharacterReferenceRequiresImageAndRollsBackWholeBatch(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	version, _ := s.repo.AssetVersion(asset.PrimaryVersionID)
	profile := CharacterReferenceProfile{Name: "日常", LookID: "daily", Enabled: true, Preferred: true}
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, version.ID, SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: version.UpdatedAt}); err == nil {
		t.Fatal("missing image marked as final")
	}
	seedReadyCharacterReference(t, db, p.UserID, version.ID)
	if err := s.SaveCharacterReferenceProfile(p.UserID, p.ID, asset.ID, version.ID, SaveCharacterReferenceProfileRequest{Profile: profile, ExpectedUpdatedAt: version.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	unit := model.ProjectUnit{ID: "unit", ProjectID: p.ID, Title: "章", CreatedAt: now, UpdatedAt: now}
	for _, row := range []any{&unit, &model.Shot{ID: "s1", ProjectID: p.ID, UnitID: unit.ID, CurrentRevisionID: "r1"}, &model.Shot{ID: "s2", ProjectID: p.ID, UnitID: unit.ID, CurrentRevisionID: "r2"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	project, _ := s.Owned(p.UserID, p.ID)
	choices := []CharacterReferenceChoice{{ShotID: "s1", AssetID: asset.ID, VersionID: version.ID, Status: "resolved", Source: "auto", Reason: "白衣", ExpectedShotRevisionID: "r1"}, {ShotID: "s2", AssetID: asset.ID, VersionID: version.ID, Status: "resolved", Source: "auto", Reason: "白衣", ExpectedShotRevisionID: "old"}}
	if err := s.SaveCharacterReferenceChoices(p.UserID, p.ID, unit.ID, SaveCharacterReferenceChoicesRequest{ExpectedRevision: project.Revision, Choices: choices}); err == nil {
		t.Fatal("stale second shot accepted")
	}
	var count int64
	if err := db.Model(&model.ShotAssetReference{}).Where("shot_id = ?", "s1").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("partial batch committed", count, err)
	}
	after, _ := s.Owned(p.UserID, p.ID)
	if after.Revision != project.Revision {
		t.Fatal("failed batch bumped revision")
	}
}

func TestCharacterRedrawKeepsPinnedReferenceAndUsesRequestedBase(t *testing.T) {
	s, db := newTestService(t, nil)
	p, asset := seedProjectCharacterRepresentation(t, db)
	now := time.Now()
	shot := model.Shot{ID: "s", ProjectID: p.ID, CurrentRevisionID: "r", CreatedAt: now, UpdatedAt: now}
	ref := model.ShotAssetReference{ID: "ref", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked", SelectionLocked: true, CreatedAt: now}
	resource := model.Resource{ID: "image", UserID: p.UserID, Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady}
	for _, row := range []any{&shot, &ref, &resource} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ReplaceProjectCharacterRepresentations(p.UserID, p.ID, asset.ID, ReplaceCharacterRepresentationsRequest{Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: resource.ID}}}); err != nil {
		t.Fatal(err)
	}
	var stored model.ShotAssetReference
	if err := db.First(&stored, "id = ?", ref.ID).Error; err != nil || stored.AssetVersionID != ref.AssetVersionID {
		t.Fatal("redraw changed pinned reference", stored, err)
	}
	if _, err := s.UpdateProjectCharacter(p.UserID, p.ID, asset.ID, UpdateProjectCharacterRequest{Name: asset.Title, Definition: map[string]any{"clothing": "战斗装"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.BindCharacterTurnaroundFromVersion(p.UserID, p.ID, asset.ID, asset.PrimaryVersionID, "old-base-task", resource.ID, ""); err != nil {
		t.Fatal(err)
	}
	card, err := s.ProjectCharacter(p.UserID, p.ID, asset.ID)
	if err != nil || card.Character.Definition["clothing"] == "战斗装" {
		t.Fatal("old-base task used latest clothing", card, err)
	}
}
