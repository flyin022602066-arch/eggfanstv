package project

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestCharacterFacePresetsPersistValidateAndClear(t *testing.T) {
	svc, db := newTestService(t, nil)
	project := seedProject(t, db, model.Project{ID: "face-project", UserID: "user-1", Name: "主角预设测试"})
	other := seedProject(t, db, model.Project{ID: "other-project", UserID: "user-1", Name: "其他项目"})
	hero, err := svc.CreateProjectCharacter("user-1", project.ID, CreateProjectCharacterRequest{Name: "男主", Definition: map[string]any{"clothing": "古装"}})
	if err != nil {
		t.Fatal(err)
	}
	heroine, err := svc.CreateProjectCharacter("user-1", project.ID, CreateProjectCharacterRequest{Name: "女主"})
	if err != nil {
		t.Fatal(err)
	}
	foreignCharacter, err := svc.CreateProjectCharacter("user-1", other.ID, CreateProjectCharacterRequest{Name: "其他项目角色"})
	if err != nil {
		t.Fatal(err)
	}
	face := model.Resource{ID: kernel.NewID(), UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	foreign := face
	foreign.ID, foreign.UserID = kernel.NewID(), "user-2"
	pending := face
	pending.ID, pending.Status = kernel.NewID(), model.ResourceStatusPending
	video := face
	video.ID, video.Kind, video.MimeType = kernel.NewID(), "video", "video/mp4"
	if err := db.Create(&[]model.Resource{face, foreign, pending, video}).Error; err != nil {
		t.Fatal(err)
	}
	encode := func(entries map[string]characterFacePreset) string {
		value, err := json.Marshal(entries)
		if err != nil {
			t.Fatal(err)
		}
		return string(value)
	}
	raw := encode(map[string]characterFacePreset{"male": {ResourceID: face.ID, FileName: "男主.png", AssetIDs: []string{hero.Asset.ID}}, "female": {ResourceID: face.ID, AssetIDs: []string{heroine.Asset.ID}}})
	updated, err := svc.UpdateProject("user-1", project.ID, UpdateProjectRequest{CharacterFacePresetsJSON: &raw})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.Owned("user-1", project.ID)
	if err != nil || loaded.CharacterFacePresetsJSON != updated.CharacterFacePresetsJSON {
		t.Fatalf("presets not persisted: %v", err)
	}
	if _, err := svc.UpdateProject("user-2", project.ID, UpdateProjectRequest{CharacterFacePresetsJSON: &raw}); err == nil {
		t.Fatal("foreign project was writable")
	}
	for name, invalid := range map[string]string{
		"foreign-resource":        encode(map[string]characterFacePreset{"male": {ResourceID: foreign.ID}}),
		"pending-resource":        encode(map[string]characterFacePreset{"male": {ResourceID: pending.ID}}),
		"video-resource":          encode(map[string]characterFacePreset{"male": {ResourceID: video.ID}}),
		"other-project-character": encode(map[string]characterFacePreset{"male": {ResourceID: face.ID, AssetIDs: []string{foreignCharacter.Asset.ID}}}),
		"two-faces-one-character": encode(map[string]characterFacePreset{"male": {ResourceID: face.ID, AssetIDs: []string{hero.Asset.ID}}, "female": {ResourceID: face.ID, AssetIDs: []string{hero.Asset.ID}}}),
		"bad-json":                "null", "unknown-role": `{"extra":{}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.UpdateProject("user-1", project.ID, UpdateProjectRequest{CharacterFacePresetsJSON: &invalid}); err == nil {
				t.Fatal("invalid preset accepted")
			}
		})
	}
	unbound := encode(map[string]characterFacePreset{"male": {ResourceID: face.ID}})
	if _, err := svc.UpdateProject("user-1", project.ID, UpdateProjectRequest{CharacterFacePresetsJSON: &unbound}); err != nil {
		t.Fatal("reference before extraction must be savable:", err)
	}
	empty := "{}"
	if _, err := svc.UpdateProject("user-1", project.ID, UpdateProjectRequest{CharacterFacePresetsJSON: &empty}); err != nil {
		t.Fatal(err)
	}
	loaded, err = svc.Owned("user-1", project.ID)
	if err != nil || loaded.CharacterFacePresetsJSON != "{}" {
		t.Fatalf("presets not cleared: %v", err)
	}
}
