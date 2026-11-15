package database

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/taskdelivery"
)

func TestResourceSourceMigrationUpgradesExistingV18Storage(t *testing.T) {
	db, databasePath := openFileDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"DELETE FROM local_schema_migrations WHERE version > 18",
		"DROP TABLE resources",
		"CREATE TABLE resources (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, status TEXT, provider TEXT," +
			"endpoint TEXT, bucket TEXT, storage_setting_id TEXT, object_key TEXT, public_url TEXT," +
			"mime_type TEXT, size INTEGER, width INTEGER, height INTEGER, duration_ms INTEGER, e_tag TEXT," +
			"playback_status TEXT, playback_object_key TEXT, playback_error TEXT, upload_key TEXT, error TEXT," +
			"created_at DATETIME, updated_at DATETIME, temporary_image_url TEXT, temporary_image_uploaded_at DATETIME," +
			"temporary_image_expires_at DATETIME, temporary_media_url TEXT, temporary_media_uploaded_at DATETIME," +
			"temporary_media_expires_at DATETIME, private_note TEXT)",
		"INSERT INTO resources(id,user_id,kind,status,object_key,size,private_note) VALUES('existing-video','owner','video','ready','original.mp4',30587826,'keep')",
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := listSchemaMigrations(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "before-upgrade", UserID: "owner", Kind: "video"}).Error; err == nil || !strings.Contains(err.Error(), "source_resource_id") {
		t.Fatalf("expected the reported storage error, got %v", err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("old resource schema accepted as ready")
	}
	for attempt := 0; attempt < 2; attempt++ {
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
	var existing model.Resource
	if err := db.First(&existing, "id = ?", "existing-video").Error; err != nil || existing.ObjectKey != "original.mp4" || existing.Size != 30587826 {
		t.Fatalf("existing resource changed: %+v, %v", existing, err)
	}
	var privateNote string
	if err := db.Raw("SELECT private_note FROM resources WHERE id='existing-video'").Scan(&privateNote).Error; err != nil || privateNote != "keep" {
		t.Fatalf("extension data lost: %q, %v", privateNote, err)
	}
	resource := model.Resource{ID: "retrieved-video", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, SourceResourceID: "existing-video", ObjectKey: "retrieved.mp4", Size: 30587826}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatalf("retrieved video cannot be stored after upgrade: %v", err)
	}
	if err := db.First(&resource, "id = ?", "retrieved-video").Error; err != nil || resource.SourceResourceID != "existing-video" {
		t.Fatal(resource, err)
	}
	repo := repository.New(db)
	dataDir := filepath.Dir(databasePath)
	assets := restartMigratedAssetService(t, repo, dataDir)
	ingestor := taskdelivery.NewIngestor(taskdelivery.IngestDeps{Store: taskdelivery.NewAssetInlineStore(assets)})
	videoBytes := []byte("local-video-download-fixture")
	video := map[string]interface{}{"url": "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(videoBytes), "width": 1280, "height": 720, "durationMs": 30000}
	var resourceID string
	for attempt := 0; attempt < 2; attempt++ {
		stored, err := ingestor.IngestResult("owner", map[string]interface{}{"video": video}, taskdelivery.IngestOptions{EnforceQuota: true, IdentityPrefix: "original-video-task"})
		if err != nil {
			t.Fatalf("video result ingest failed: %v", err)
		}
		media := stored["video"].(map[string]interface{})
		currentID, _ := media["resourceId"].(string)
		if currentID == "" || attempt > 0 && currentID != resourceID {
			t.Fatalf("recovery changed resource identity: %q -> %q", resourceID, currentID)
		}
		resourceID = currentID
	}
	saved, err := repo.Resource(resourceID)
	if err != nil || saved.Status != model.ResourceStatusReady || saved.DurationMs != 30000 {
		t.Fatalf("video is not ready: %+v, %v", saved, err)
	}
	content, err := os.ReadFile(filepath.Join(dataDir, "resources", filepath.FromSlash(saved.ObjectKey)))
	if err != nil || !bytes.Equal(content, videoBytes) {
		t.Fatalf("stored video bytes changed: %v", err)
	}
	if err := db.Exec("DROP INDEX idx_resources_source_resource_id").Error; err != nil {
		t.Fatal(err)
	}
	if RequireLocalSchema(db) == nil {
		t.Fatal("missing source-resource index accepted as ready")
	}
	if err := db.Exec("ALTER TABLE resources DROP COLUMN source_resource_id").Error; err != nil {
		t.Fatal(err)
	}
	if err := RequireLocalSchema(db); err == nil || !strings.Contains(err.Error(), "resources.source_resource_id") {
		t.Fatalf("missing column in current schema accepted: %v", err)
	}
}

func TestResourceSourceMigrationRollsBackWithLedgerFailure(t *testing.T) {
	db, _ := openFileDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"DELETE FROM local_schema_migrations WHERE version=19",
		"DROP INDEX idx_resources_source_resource_id",
		"ALTER TABLE resources DROP COLUMN source_resource_id",
		"INSERT INTO resources(id,user_id,kind,status,object_key) VALUES('keep-video','owner','video','ready','keep.mp4')",
		"CREATE TRIGGER fail_resource_source_ledger BEFORE INSERT ON local_schema_migrations WHEN NEW.version=19 BEGIN SELECT RAISE(ABORT,'injected resource-source ledger failure'); END",
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := listSchemaMigrations(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err == nil || !strings.Contains(err.Error(), "injected resource-source ledger failure") {
		t.Fatalf("expected failed migration: %v", err)
	}
	if has, err := sqliteHasColumn(db, "resources", "source_resource_id"); err != nil || has {
		t.Fatalf("column survived transaction rollback: %v, %v", has, err)
	}
	if has, err := sqliteHasNamedIndex(db, "resources", resourceSourceIndex.name); err != nil || has {
		t.Fatalf("index survived transaction rollback: %v, %v", has, err)
	}
	if version, err := currentSchemaVersion(db); err != nil || version != 18 {
		t.Fatalf("failed migration advanced version: %d, %v", version, err)
	}
	if err := assertLedgerImmutable(db, before); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DROP TRIGGER fail_resource_source_ledger").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	var saved model.Resource
	if err := db.First(&saved, "id = ?", "keep-video").Error; err != nil || saved.ObjectKey != "keep.mp4" {
		t.Fatalf("retry lost existing resource: %+v, %v", saved, err)
	}
}
