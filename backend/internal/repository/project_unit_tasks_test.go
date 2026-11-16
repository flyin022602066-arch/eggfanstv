package repository

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestProjectUnitGenerationTasksRetainsCompletedOlderEpisodes(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "tasks.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := database.DB()
	defer connection.Close()
	if err := database.AutoMigrate(&model.Task{}, &model.Shot{}, &model.ShotArtifact{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	shots := []model.Shot{{ID: "shot", ProjectID: "project", UnitID: "episode"}, {ID: "other-shot", ProjectID: "project", UnitID: "other-episode"}}
	if err := database.Create(&shots).Error; err != nil {
		t.Fatal(err)
	}
	context := `{"metadata":{"shotId":"shot","chapterId":"episode","workflowStepId":"video-step","artifactType":"video"}}`
	tasks := []model.Task{
		{ID: "old-ghost", UserID: "owner", ProjectID: "project", Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: context, CreatedAt: now.Add(-3 * time.Hour), UpdatedAt: now},
		{ID: "completed", UserID: "owner", ProjectID: "project", Type: "canvas_video", Status: model.TaskStatusSucceeded, InputJSON: context, CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "foreign", UserID: "other-owner", ProjectID: "project", Status: model.TaskStatusRunning, InputJSON: context, CreatedAt: now},
		{ID: "invalid-json", UserID: "owner", ProjectID: "project", InputJSON: "invalid", CreatedAt: now},
	}
	for index := range 150 {
		tasks = append(tasks, model.Task{ID: fmt.Sprintf("recent-%d", index), UserID: "owner", ProjectID: "project", InputJSON: `{"metadata":{"shotId":"other-shot","artifactType":"video"}}`, CreatedAt: now})
	}
	if err := database.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: "video", ProjectID: "project", UnitID: "episode", ShotID: "shot", TaskID: "completed", Type: "video", ResourceID: "original-video", Status: "ready", Selected: true}
	if err := database.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	repository := New(database)
	actual, err := repository.ProjectUnitGenerationTasks("owner", "project", "episode")
	if err != nil || len(actual) != 1 || actual[0].ID != "completed" {
		t.Fatalf("episode state contaminated: %+v %v", actual, err)
	}
	rerun := model.Task{ID: "new-rerun", UserID: "owner", ProjectID: "project", Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: context, CreatedAt: now.Add(time.Second)}
	if err := database.Create(&rerun).Error; err != nil {
		t.Fatal(err)
	}
	actual, err = repository.ProjectUnitGenerationTasks("owner", "project", "episode")
	if err != nil || len(actual) != 2 || actual[0].ID != rerun.ID || actual[1].ID != "completed" {
		t.Fatalf("new attempt or original video missing: %+v %v", actual, err)
	}
	actual, err = repository.ProjectUnitGenerationTasks("owner", "project", "")
	if err != nil || len(actual) != 3 {
		t.Fatalf("full project must retain latest tasks and history, not all task rows: %d %v", len(actual), err)
	}
}
