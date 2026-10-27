package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCharacterFacePresetsMigrationUpgradesV16WithoutChangingProjectData(t *testing.T) {
	db, _ := openFileDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"DELETE FROM local_schema_migrations WHERE version >= 17",
		"ALTER TABLE projects DROP COLUMN character_face_presets_json",
		"ALTER TABLE projects ADD COLUMN private_project_note TEXT",
		`INSERT INTO projects(id,user_id,name,default_image_model,default_video_model,revision,private_project_note) VALUES('existing','owner','原有项目','image-model','video-model',9,'keep')`,
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := listSchemaMigrations(db)
	if err != nil {
		t.Fatal(err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("old workspace accepted before upgrade")
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := MigrateLocalSchema(db); err != nil {
			t.Fatal(err)
		}
		if err := RequireLocalSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var project model.Project
	if err := db.First(&project, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if project.Name != "原有项目" || project.UserID != "owner" || project.DefaultImageModel != "image-model" || project.DefaultVideoModel != "video-model" || project.Revision != 9 || project.CharacterFacePresetsJSON != "" {
		t.Fatalf("existing project changed: %+v", project)
	}
	mustColumn(t, db, "projects", "private_project_note", "keep")
	if err := assertLedgerImmutable(db, before); err != nil {
		t.Fatal(err)
	}
	after, err := listSchemaMigrations(db)
	if err != nil || len(after) != len(before)+1 || after[len(after)-1].Name != "project-character-face-presets" {
		t.Fatalf("migration ledger: %+v, %v", after, err)
	}
	presets := `{"male":{"resourceId":"face-resource","assetIds":["lead"]}}`
	if err := db.Model(&project).Update("character_face_presets_json", presets).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&project, "id = ?", "existing").Error; err != nil || project.CharacterFacePresetsJSON != presets {
		t.Fatalf("preset lost on restart migration: %+v, %v", project, err)
	}
	if err := db.Exec("ALTER TABLE projects DROP COLUMN character_face_presets_json").Error; err != nil {
		t.Fatal(err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("damaged face preset schema accepted")
	}
}
