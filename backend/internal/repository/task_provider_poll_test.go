package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeferredProviderPollKeepsOriginalTaskIdentityWithoutImmediateReclaim(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-poll-defer?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "task-1", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning,
		LeaseOwner: "worker-1", LeaseExpiresAt: ptrTime(time.Now().Add(time.Minute)), ProviderRequestID: "provider-task-1",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	diagnostic := &model.TaskFailureDiagnostics{ExecutionResult: "pending", Requests: []model.TaskRequestEvidence{{Operation: "submit", RequestID: "req-original-submit"}}}
	if err := repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "后台仍在生成", time.Minute, diagnostic); err != nil {
		t.Fatal(err)
	}
	claimed, err := repo.ClaimNextTask("worker-2", 45*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed != nil {
		t.Fatalf("task reclaimed before next poll: %#v", claimed)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("next_poll_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.ClaimNextTask("worker-2", 45*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.ID != task.ID || claimed.ProviderRequestID != task.ProviderRequestID {
		t.Fatalf("reclaimed task = %#v", claimed)
	}
	if claimed.FailureDiagnostics == nil || claimed.FailureDiagnostics.ExecutionResult != "pending" || claimed.FailureDiagnostics.Requests[0].RequestID != "req-original-submit" {
		t.Fatalf("reclaimed diagnostics = %+v", claimed.FailureDiagnostics)
	}
}

func TestUpdateTaskProviderProgressIsMonotonic(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-progress?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task-progress", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning, Stage: "正在连接上游"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, progress := range []int{12, 48, 31, 76} {
		if err := repo.UpdateTaskProviderProgress(task.ID, progress); err != nil {
			t.Fatal(err)
		}
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Progress != 76 || stored.Stage != "上游生成中" {
		t.Fatalf("stored progress = %d, stage = %q", stored.Progress, stored.Stage)
	}
}

func ptrTime(value time.Time) *time.Time { return &value }

func TestResumeFailedProviderPollPreservesOriginalRequestAndRequiresLease(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-poll-resume?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "failed-task", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusFailed,
		ProviderRequestID: "original-provider-task", InputJSON: `{"model":"original-model"}`, Attempts: 1,
		Error: "connection interrupted", CompletedAt: ptrTime(time.Now()),
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if err := repo.ClaimFailedTaskProviderRecovery(task.ID, "other-user", "manual-recovery:other", time.Minute); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("foreign user recovery = %v", err)
	}
	owner := "manual-recovery:owner"
	if err := repo.ClaimFailedTaskProviderRecovery(task.ID, task.UserID, owner, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := repo.ResumeFailedTaskProviderPoll(task.ID, "other-owner", task.ProviderRequestID, "processing"); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("wrong lease resumed: %v", err)
	}
	if err := repo.ResumeFailedTaskProviderPoll(task.ID, owner, "different-task", "processing"); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("wrong provider task resumed: %v", err)
	}
	if err := repo.ResumeFailedTaskProviderPoll(task.ID, owner, task.ProviderRequestID, "processing"); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusRunning || stored.Error != "" || stored.CompletedAt != nil || stored.InputJSON != task.InputJSON || stored.ProviderRequestID != task.ProviderRequestID || stored.Attempts != 1 {
		t.Fatalf("resumed task changed original identity or completion: %#v", stored)
	}
	claimed, err := repo.ClaimNextTask("worker-resume", time.Minute)
	if err != nil || claimed == nil || claimed.ID != task.ID || claimed.ProviderRequestID != task.ProviderRequestID {
		t.Fatalf("worker cannot continue original task: %#v, %v", claimed, err)
	}
	if err := repo.ResumeFailedTaskProviderPoll(task.ID, owner, task.ProviderRequestID, "processing"); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("duplicate recovery resumed: %v", err)
	}
}
