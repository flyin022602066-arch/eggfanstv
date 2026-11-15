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
	"infinite-canvas/backend/internal/provider/doubaobrowser"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
)

func TestDoubaoBrowserLocalAdmissionCapabilitiesAndDurableReceipt(t *testing.T) {
	root := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "fixture.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	defer connection.Close()
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	s := NewLocal(repository.New(db), root)
	defer s.Close()
	owner, err := s.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"mode": "video", "prompt": "fixture", "config": map[string]any{"interfaceType": doubaobrowser.Protocol, "model": "seedance_v2.0_std", "baseUrl": "https://www.doubao.com", "videoSeconds": "12", "size": "9:16"}}
	task, err := s.CreateLocalTask(owner.ID, localtask.CreateRequest{Type: "canvas_video", Prompt: "fixture", Model: "doubao-browser::seedance_v2.0_std", Input: input})
	if err != nil {
		t.Fatal("task admission:", err)
	}
	resolved, err := s.resolveProviderConfig(generation.Config{InterfaceType: doubaobrowser.Protocol, Model: "seedance_v2.0_std", APIKey: "fixture-must-strip", SecretKey: "fixture-must-strip"})
	if err != nil || resolved.APIKey != "" || resolved.SecretKey != "" {
		t.Fatal("credential isolation:", err)
	}
	prepared := generation.Input{Mode: "video", Config: resolved}
	if err := (appConfigPort{s}).ApplyCapabilities(context.Background(), &prepared); err != nil || prepared.VideoCapability == nil || prepared.VideoCapability.Duration.Max != 15 {
		t.Fatal("native capability not applied:", err)
	}
	until := time.Now().Add(time.Minute)
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusRunning, "lease_owner": "fixture-worker", "lease_expires_at": until}).Error; err != nil {
		t.Fatal(err)
	}
	task.Status, task.LeaseOwner, task.LeaseExpiresAt = model.TaskStatusRunning, "fixture-worker", &until
	attempt := model.RouteAttempt{ID: "fixture-attempt", TaskID: task.ID, DispatchState: "submission_unknown", Status: "dispatching"}
	if err := db.Create(&attempt).Error; err != nil {
		t.Fatal(err)
	}
	ctx := generation.WithCallMeta(context.Background(), generation.CallMeta{TaskID: task.ID, UserID: owner.ID})
	ctx = context.WithValue(ctx, imageTaskContext{}, *task)
	ctx = context.WithValue(ctx, imageAttemptContext{}, attempt.ID)
	receipt := generation.EncodeDoubaoBrowserTask(doubaobrowser.Receipt{TaskID: task.ID, ProfileID: "550e8400-e29b-41d4-a716-446655440000"})
	if err := (hanbaoReceipt{s}).RecordAccepted(ctx, receipt); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.Task(task.ID)
	storedAttempt, _ := s.repo.LatestRouteAttempt(task.ID)
	if stored.ProviderRequestID != receipt || storedAttempt.ProviderRequestID != receipt || storedAttempt.DispatchState != "accepted" {
		t.Fatal("task and attempt receipt not atomic")
	}
	body, _ := json.Marshal(input)
	if !s.shouldDeferVideoProviderTask(*stored, string(body), generation.StatePendingError{TaskID: receipt, Cause: errors.New("fixture pending")}) {
		t.Fatal("original browser task cannot resume")
	}
	foreign := generation.EncodeDoubaoBrowserTask(doubaobrowser.Receipt{TaskID: "foreign-task", ProfileID: "550e8400-e29b-41d4-a716-446655440000"})
	if (hanbaoReceipt{s}).RecordAccepted(ctx, foreign) == nil {
		t.Fatal("foreign task receipt accepted")
	}
	if err := db.Model(stored).Update("lease_owner", "other-worker").Error; err != nil {
		t.Fatal(err)
	}
	if (hanbaoReceipt{s}).RecordAccepted(ctx, receipt) == nil {
		t.Fatal("stale worker overwrote receipt")
	}
}
