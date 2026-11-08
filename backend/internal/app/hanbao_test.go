package app

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/hanbao"
	"infinite-canvas/backend/internal/repository"
)

func TestHanbaoLocalTaskAdmissionDurableReceiptAndResume(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "hanbao-test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	s := NewLocal(repository.New(db), dir)
	owner, err := s.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"mode": "video", "prompt": "fixture prompt", "config": map[string]any{"interfaceType": "hanbao-video", "model": "seedance_v2.5", "baseUrl": "https://www.doubao.com", "videoSeconds": "5", "size": "16:9"}}
	task, err := s.CreateLocalTask(owner.ID, toTaskCreateRequest(CreateTaskRequest{Type: "canvas_video", Prompt: "fixture prompt", Input: input}))
	if err != nil {
		t.Fatalf("native task admission=%v", err)
	}
	until := time.Now().Add(time.Minute)
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusRunning, "lease_owner": "hanbao-test", "lease_expires_at": until}).Error; err != nil {
		t.Fatal(err)
	}
	task.Status, task.LeaseOwner, task.LeaseExpiresAt = model.TaskStatusRunning, "hanbao-test", &until
	attempt := model.RouteAttempt{ID: "hanbao-attempt", TaskID: task.ID, DispatchState: "submission_unknown", Status: "dispatching"}
	if err := db.Create(&attempt).Error; err != nil {
		t.Fatal(err)
	}
	ctx := generation.WithCallMeta(context.Background(), generation.CallMeta{TaskID: task.ID, UserID: owner.ID})
	ctx = context.WithValue(ctx, imageTaskContext{}, *task)
	ctx = context.WithValue(ctx, imageAttemptContext{}, attempt.ID)
	receipt := generation.EncodeHanbaoTask(hanbao.TaskRef{SubmitID: "cv:a:b:opaque", Account: "actual"})
	if err := (hanbaoReceipt{s}).RecordAccepted(ctx, receipt); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.Task(task.ID)
	storedAttempt, _ := s.repo.LatestRouteAttempt(task.ID)
	if stored.ProviderRequestID != receipt || storedAttempt.ProviderRequestID != receipt || storedAttempt.DispatchState != "accepted" {
		t.Fatal("task/attempt receipt not atomic")
	}
	if err := s.HanbaoDomain().Save(hanbao.DefaultSettings()); !errors.Is(err, hanbao.ErrBusy) {
		t.Fatal("accepted suspended task allowed profile mutation", err)
	}
	body, _ := json.Marshal(input)
	if !s.shouldDeferVideoProviderTask(*stored, string(body), generation.StatePendingError{TaskID: receipt, Cause: errors.New("query_error")}) {
		t.Fatal("accepted Hanbao task cannot resume polling")
	}
	if err := db.Model(stored).Update("lease_owner", "other-worker").Error; err != nil {
		t.Fatal(err)
	}
	if (hanbaoReceipt{s}).RecordAccepted(ctx, receipt) == nil {
		t.Fatal("stale worker overwrote receipt")
	}
}
