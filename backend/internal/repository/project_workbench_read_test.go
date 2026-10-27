package repository

import (
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProjectOverviewUnitsPendingCandidates(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "overview.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.AutoMigrate(&model.ProjectUnit{}, &model.ProjectAssetCandidate{}, &model.Shot{}, &model.CanvasUnitLink{}); err != nil {
		t.Fatal(err)
	}
	units := []model.ProjectUnit{
		{ID: "confirmed-chapter", ProjectID: "project", Title: "Confirmed", Position: 0},
		{ID: "pending-chapter", ProjectID: "project", Title: "Pending", Position: 1},
		{ID: "empty-chapter", ProjectID: "project", Title: "Empty", Position: 2},
		{ID: "other-chapter", ProjectID: "other-project", Title: "Other", Position: 0},
	}
	if err := database.Create(&units).Error; err != nil {
		t.Fatal(err)
	}
	candidates := []model.ProjectAssetCandidate{
		{ID: "confirmed", ProjectID: "project", UnitID: "confirmed-chapter", Status: "confirmed", ResolvedAssetID: "asset"},
		{ID: "rejected", ProjectID: "project", UnitID: "confirmed-chapter", Status: "rejected"},
		{ID: "pending", ProjectID: "project", UnitID: "pending-chapter", Status: "pending_confirmation"},
		{ID: "mixed-confirmed", ProjectID: "project", UnitID: "pending-chapter", Status: "confirmed"},
		{ID: "other", ProjectID: "other-project", UnitID: "confirmed-chapter", Status: "pending_confirmation"},
	}
	if err := database.Create(&candidates).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(database)
	assertCounts := func(expected []int64) {
		t.Helper()
		rows, err := repo.ProjectOverviewUnits("project", 8)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != len(expected) {
			t.Fatalf("chapters = %d, want %d", len(rows), len(expected))
		}
		for index, row := range rows {
			if row.CandidateCount != expected[index] {
				t.Errorf("chapter %s pending count = %d, want %d", row.ID, row.CandidateCount, expected[index])
			}
		}
	}
	assertCounts([]int64{0, 1, 0})
	if err := database.Model(&model.ProjectAssetCandidate{}).Where("id = ?", "pending").Updates(map[string]any{"status": "confirmed", "resolved_asset_id": "asset"}).Error; err != nil {
		t.Fatal(err)
	}
	assertCounts([]int64{0, 0, 0})
}
