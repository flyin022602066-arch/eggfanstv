package repository

import (
	"encoding/base64"
	"encoding/json"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/doubaobrowser"
	"path/filepath"
	"testing"
	"time"
)

func TestResumeUnconfirmedBrowserTasksOnlyRestoresQueryOnlyWork(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "recovery.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := database.DB()
	defer connection.Close()
	if err := database.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	tasks := []model.Task{
		{ID: "unknown", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusFailed, Stage: "submission_unknown", Error: "connection interrupted", Attempts: 1, Prompt: "original prompt"},
		{ID: "refused", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusFailed, Stage: "任务失败"},
		{ID: "other", UserID: "owner", Type: "canvas_video", Model: "nono::model", Status: model.TaskStatusFailed, Stage: "submission_unknown"},
		{ID: "cancelled", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusCancelled, Stage: "submission_unknown"},
		{ID: "leased", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusFailed, Stage: "submission_unknown", LeaseOwner: "manual-recovery:active", LeaseExpiresAt: ptrTime(time.Now().Add(time.Minute))},
	}
	encoded, _ := json.Marshal(doubaobrowser.Receipt{TaskID: tasks[0].ID, ProfileID: "550e8400-e29b-41d4-a716-446655440000"})
	tasks[0].ProviderRequestID = "doubao-browser:" + base64.RawURLEncoding.EncodeToString(encoded)
	tasks = append(tasks,
		model.Task{ID: "missing-receipt", UserID: "owner", Type: "canvas_video", Model: tasks[0].Model, Status: model.TaskStatusFailed, Stage: "submission_unknown", Error: "original lookup failed"},
		model.Task{ID: "foreign-receipt", UserID: "owner", Type: "canvas_video", Model: tasks[0].Model, Status: model.TaskStatusFailed, Stage: "submission_unknown", ProviderRequestID: tasks[0].ProviderRequestID},
	)
	older := tasks[0]
	older.ID, older.ProjectID, older.InputJSON = "older-shot-attempt", "project", `{"metadata":{"shotId":"shot","artifactType":"video"}}`
	older.CreatedAt = time.Now().Add(-time.Hour)
	encoded, _ = json.Marshal(doubaobrowser.Receipt{TaskID: older.ID, ProfileID: "550e8400-e29b-41d4-a716-446655440000"})
	older.ProviderRequestID = "doubao-browser:" + base64.RawURLEncoding.EncodeToString(encoded)
	completed := model.Task{ID: "new-shot-attempt", UserID: older.UserID, ProjectID: older.ProjectID, Type: older.Type, Model: "nono::video", Status: model.TaskStatusSucceeded, InputJSON: older.InputJSON, CreatedAt: time.Now()}
	stopped := tasks[0]
	stopped.ID, stopped.Status = "stopped-with-receipt", model.TaskStatusCancelled
	encoded, _ = json.Marshal(doubaobrowser.Receipt{TaskID: stopped.ID, ProfileID: "550e8400-e29b-41d4-a716-446655440000"})
	stopped.ProviderRequestID = "doubao-browser:" + base64.RawURLEncoding.EncodeToString(encoded)
	tasks = append(tasks, older, completed, stopped)
	if err := database.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	repository := New(database)
	if err := repository.ResumeUnconfirmedDoubaoBrowserTasks(); err != nil {
		t.Fatal(err)
	}
	if err := repository.ResumeUnconfirmedDoubaoBrowserTasks(); err != nil {
		t.Fatal(err)
	}
	restored, _ := repository.Task("unknown")
	if restored.Status != model.TaskStatusRunning || restored.PollStage != "submitted" || restored.Error != "" || restored.CompletedAt != nil || restored.Attempts != 1 || restored.Prompt != tasks[0].Prompt {
		t.Fatalf("unsafe recovery: %+v", restored)
	}
	for _, original := range tasks[1:] {
		stored, _ := repository.Task(original.ID)
		if stored.Status != original.Status || stored.PollStage != original.PollStage {
			t.Fatalf("unrelated task changed: %s", original.ID)
		}
	}
}
