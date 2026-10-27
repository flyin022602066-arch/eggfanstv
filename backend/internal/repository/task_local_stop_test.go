package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestStopVideoTaskLocallyRequiresOwnerAndVideoType(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	tasks := []model.Task{
		{ID: "owner-video", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusRunning, ProviderRequestID: "retained"},
		{ID: "other-owner-video", UserID: "other", Type: "canvas_video", Status: model.TaskStatusRunning},
		{ID: "owner-image", UserID: "owner", Type: "canvas_image", Status: model.TaskStatusRunning},
	}
	for _, task := range tasks {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	now := time.Now()
	for _, attempt := range []struct {
		user, id string
		want     bool
	}{{"owner", "owner-video", true}, {"intruder", "other-owner-video", false}, {"owner", "owner-image", false}} {
		stopped, err := repo.StopVideoTaskLocallyIfStatus(attempt.user, attempt.id, model.TaskStatusRunning, now)
		if err != nil || stopped != attempt.want {
			t.Fatalf("stop %s: got %v, %v; want %v", attempt.id, stopped, err, attempt.want)
		}
	}
	var unrelated model.Task
	if err := db.First(&unrelated, "id = ?", "other-owner-video").Error; err != nil {
		t.Fatal(err)
	}
	if unrelated.Status != model.TaskStatusRunning {
		t.Fatal("a different owner's task was modified")
	}
	var video model.Task
	if err := db.First(&video, "id = ?", "owner-video").Error; err != nil {
		t.Fatal(err)
	}
	if video.Status != model.TaskStatusCancelled || video.ProviderRequestID != "retained" || video.Stage != "本地已停止" {
		t.Fatalf("local stop altered unexpected fields: %#v", video)
	}
}
