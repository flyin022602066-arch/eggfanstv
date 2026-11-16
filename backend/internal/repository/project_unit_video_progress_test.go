package repository

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"path/filepath"
	"testing"
)

func TestProjectUnitVideoProgressCountsDistinctReadyShots(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "progress.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := database.DB()
	defer connection.Close()
	if err := database.AutoMigrate(&model.ProjectUnit{}, &model.Shot{}, &model.ShotArtifact{}); err != nil {
		t.Fatal(err)
	}
	units := []model.ProjectUnit{{ID: "first", ProjectID: "project"}, {ID: "second", ProjectID: "project"}, {ID: "empty", ProjectID: "project"}, {ID: "other", ProjectID: "outside"}}
	shots := []model.Shot{{ID: "a", ProjectID: "project", UnitID: "first"}, {ID: "b", ProjectID: "project", UnitID: "first"}, {ID: "c", ProjectID: "project", UnitID: "second"}, {ID: "d", ProjectID: "outside", UnitID: "other"}}
	artifacts := []model.ShotArtifact{
		{ID: "ready", ProjectID: "project", UnitID: "first", ShotID: "a", Type: "video", Version: 1, Selected: true, Status: "ready", ResourceID: "video-a"},
		{ID: "duplicate", ProjectID: "project", UnitID: "first", ShotID: "a", Type: "video", Version: 2, Selected: true, Status: "ready", ResourceID: "video-a2"},
		{ID: "stale", ProjectID: "project", UnitID: "first", ShotID: "b", Type: "video", Version: 1, Selected: true, Status: "stale", ResourceID: "video-b"},
		{ID: "unselected", ProjectID: "project", UnitID: "first", ShotID: "b", Type: "video", Version: 2, Status: "ready", ResourceID: "video-b2"},
		{ID: "missing", ProjectID: "project", UnitID: "first", ShotID: "b", Type: "video", Version: 3, Selected: true, Status: "ready"},
		{ID: "deleted", ProjectID: "project", UnitID: "first", ShotID: "removed", Type: "video", Version: 1, Selected: true, Status: "ready", ResourceID: "deleted-video"},
		{ID: "foreign", ProjectID: "outside", UnitID: "first", ShotID: "b", Type: "video", Version: 4, Selected: true, Status: "ready", ResourceID: "foreign-video"},
		{ID: "image", ProjectID: "project", UnitID: "first", ShotID: "b", Type: "storyboard", Version: 1, Selected: true, Status: "ready", ResourceID: "image"},
		{ID: "second-ready", ProjectID: "project", UnitID: "second", ShotID: "c", Type: "video", Version: 1, Selected: true, Status: "ready", ResourceID: "video-c"},
	}
	for _, values := range []any{&units, &shots, &artifacts} {
		if err := database.Create(values).Error; err != nil {
			t.Fatal(err)
		}
	}
	counts, err := New(database).ProjectUnitVideoProgress("project")
	if err != nil {
		t.Fatal(err)
	}
	if len(counts) != 3 || counts["first"].ShotCount != 2 || counts["first"].ReadyVideoCount != 1 || counts["second"].ReadyVideoCount != 1 || counts["empty"].ShotCount != 0 {
		t.Fatalf("unexpected counts: %#v", counts)
	}
	if err := database.Model(&model.ShotArtifact{}).Where("id = ?", "missing").Update("resource_id", "recovered-video").Error; err != nil {
		t.Fatal(err)
	}
	counts, err = New(database).ProjectUnitVideoProgress("project")
	if err != nil || counts["first"].ReadyVideoCount != 2 {
		t.Fatalf("completion not refreshed: %#v, %v", counts, err)
	}
}
