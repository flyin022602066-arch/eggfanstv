package database

import (
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestCharacterLookMigrationPreservesV17Bindings(t *testing.T) {
	db, _ := openFileDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"DELETE FROM local_schema_migrations WHERE version >= 18",
		"INSERT INTO asset_versions(id,asset_id,version,definition_json) VALUES('old-version','hero',1,'{\"clothing\":\"white\"}')",
		"INSERT INTO shot_asset_references(id,shot_id,asset_version_id,role,status) VALUES('old-ref','shot','old-version','reference','linked')",
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, field := range characterLookColumns {
		if err := db.Exec("ALTER TABLE " + field.table + " DROP COLUMN " + field.column).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, _ := listSchemaMigrations(db)
	if RequireLocalSchema(db) == nil {
		t.Fatal("old schema accepted")
	}
	for i := 0; i < 2; i++ {
		if err := MigrateLocalSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := RequireLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := assertLedgerImmutable(db, before); err != nil {
		t.Fatal(err)
	}
	var ref model.ShotAssetReference
	if err := db.First(&ref, "id = ?", "old-ref").Error; err != nil || ref.AssetVersionID != "old-version" || ref.SelectionLocked {
		t.Fatal(ref, err)
	}
	var version model.AssetVersion
	if err := db.First(&version, "id = ?", "old-version").Error; err != nil || version.DefinitionJSON != `{"clothing":"white"}` {
		t.Fatal(version, err)
	}
	if err := db.Exec("ALTER TABLE shot_asset_references DROP COLUMN selection_reason").Error; err != nil {
		t.Fatal(err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("damaged current schema accepted")
	}
}
