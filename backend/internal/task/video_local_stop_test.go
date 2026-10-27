package task

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func localStopTestService(t *testing.T) (*Service, *repository.Repository, *gorm.DB, *drainRuntime, *captureProvider) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "tasks.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.Result{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	repo := repository.New(db)
	runtime := &drainRuntime{}
	provider := &captureProvider{}
	service := NewService(NewStore(repo), Dependencies{Runtime: runtime, Provider: provider, Present: identityPresent{}})
	return service, repo, db, runtime, provider
}

func TestStopVideoLocallyFencesWorkersWithoutCallingProvider(t *testing.T) {
	service, repo, db, runtime, provider := localStopTestService(t)
	now := time.Now()
	task := model.Task{
		ID: "video", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusRunning,
		ProviderRequestID: "upstream-video", InputJSON: `{"metadata":{"shotId":"shot"}}`,
		LeaseOwner: "worker", LeaseExpiresAt: &now, PollStage: "poll", NextPollAt: &now,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		stopped, err := service.StopVideoLocally(task.UserID, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if stopped.Status != model.TaskStatusCancelled || stopped.Stage != "本地已停止" || stopped.CompletedAt == nil {
			t.Fatalf("stop receipt = %#v", stopped)
		}
		if stopped.LeaseOwner != "" || stopped.LeaseExpiresAt != nil || stopped.PollStage != "" || stopped.NextPollAt != nil {
			t.Fatal("local scheduler state was not cleared")
		}
	}
	stored, err := repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ProviderRequestID != task.ProviderRequestID || stored.InputJSON != task.InputJSON || stored.ProviderCancelStatus != "" {
		t.Fatal("local stop changed upstream identity or claimed upstream cancellation")
	}
	if runtime.stopped.Load() != task.ID || runtime.dispatch.Load() != 0 {
		t.Fatal("local wait not stopped or provider work dispatched")
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if len(provider.ids) != 0 {
		t.Fatal("local stop called upstream cancellation")
	}
	if err := repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "poll", time.Second); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale poll resurrected task: %v", err)
	}
	task.Status = model.TaskStatusSucceeded
	if err := repo.SaveTaskCompletion(&task, model.TaskStatusRunning, []model.Result{{ID: "late-result", TaskID: task.ID}}); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("stale completion overwrote local stop: %v", err)
	}
	claimed, err := repo.ClaimNextTask("next-worker", time.Minute)
	if err != nil || claimed != nil {
		t.Fatalf("stopped task claimed again: %v %v", claimed, err)
	}
	var count int64
	if err := db.Model(&model.Result{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("late result persisted: %d %v", count, err)
	}
}

func TestStopVideoLocallyChecksOwnerTypeAndTerminalState(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		userID string
		kind   string
		status model.TaskStatus
	}{
		{"foreign-owner", "intruder", "canvas_video", model.TaskStatusRunning},
		{"image", "owner", "canvas_image", model.TaskStatusRunning},
		{"succeeded", "owner", "canvas_video", model.TaskStatusSucceeded},
		{"failed", "owner", "canvas_video", model.TaskStatusFailed},
		{"normal-cancel", "owner", "canvas_video", model.TaskStatusCancelled},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			service, repo, db, runtime, _ := localStopTestService(t)
			task := model.Task{ID: "task", UserID: "owner", Type: testCase.kind, Status: testCase.status}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := service.StopVideoLocally(testCase.userID, task.ID); err == nil {
				t.Fatal("invalid stop accepted")
			}
			stored, err := repo.Task(task.ID)
			if err != nil || stored.Status != task.Status || stored.Stage != "" || runtime.stopped.Load() != nil {
				t.Fatal("rejected operation modified task or stopped its worker")
			}
		})
	}
}

func TestStopVideoLocallyAcceptsQueuedVideoTypes(t *testing.T) {
	for _, kind := range []string{"canvas_video", "canvas_video_edit", "video_generation"} {
		t.Run(kind, func(t *testing.T) {
			service, repo, db, _, _ := localStopTestService(t)
			task := model.Task{ID: "queued", UserID: "owner", Type: kind, Status: model.TaskStatusQueued}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := service.StopVideoLocally(task.UserID, task.ID); err != nil {
				t.Fatal(err)
			}
			stored, err := repo.Task(task.ID)
			if err != nil || stored.Status != model.TaskStatusCancelled {
				t.Fatal("queued video was not stopped")
			}
		})
	}
}

func TestLocalVideoStopDoesNotBlockExplicitRetry(t *testing.T) {
	store := newMemStore()
	service := domainService(store, func(deps *Dependencies) {
		deps.Failures = failClass{block: true, category: generation.CategorySubmissionUncertain}
	})
	locallyStopped := model.Task{ID: "stopped", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusCancelled, Stage: "本地已停止", InputJSON: `{}`, Error: "本地停止跟进；上游未取消"}
	store.tasks[locallyStopped.ID] = locallyStopped
	if retried, err := service.Retry(locallyStopped.UserID, locallyStopped.ID); err != nil || retried.Status != model.TaskStatusQueued {
		t.Fatalf("local stop is not explicitly retryable: %v %v", retried, err)
	}
	uncertain := model.Task{ID: "uncertain", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusFailed, Stage: "submission_unknown", InputJSON: `{}`, Error: "提交状态未知"}
	store.tasks[uncertain.ID] = uncertain
	if _, err := service.Retry(uncertain.UserID, uncertain.ID); err == nil {
		t.Fatal("upstream submission uncertainty must remain protected")
	}
}
