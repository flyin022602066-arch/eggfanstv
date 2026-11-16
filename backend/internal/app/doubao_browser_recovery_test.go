package app

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/doubaobrowser"
	"infinite-canvas/backend/internal/repository"
)

func TestBrowserReceiptQueryFailuresKeepTheirRealReason(t *testing.T) {
	for _, status := range []string{"failed", "pending"} {
		t.Run(status, func(t *testing.T) {
			database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "query.db")), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			connection, _ := database.DB()
			defer connection.Close()
			if err := database.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(time.Minute)
			task := model.Task{ID: "original", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusFailed, LeaseOwner: "manual-recovery:fixture", LeaseExpiresAt: &expires}
			if err := database.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			service := &Service{repo: repository.New(database)}
			cause := error(errors.New("上游审核未通过"))
			expectedStatus, expectedExecution := "failed", "failed"
			if status == "pending" {
				cause = generation.StatePendingError{Cause: errors.New("本地查询连接中断")}
				expectedStatus, expectedExecution = "query_error", "pending"
			}
			result, err := service.confirmBrowserQueryFailure(&task, status, cause)
			if err != nil || result.Recovered || result.ProviderStatus != expectedStatus || result.Task.Status != model.TaskStatusFailed || result.Task.FailureDiagnostics.ExecutionResult != expectedExecution {
				t.Fatalf("incorrect query state: %+v %v", result, err)
			}
			if result.Task.FailureDiagnostics.Summary == "" {
				t.Fatal("real query reason missing")
			}
		})
	}
}

func TestBrowserReceiptRecoveryOnlyRestoresTheOriginalLeasedTask(t *testing.T) {
	for _, scenario := range []string{"original", "foreign-receipt", "lost-lease", "invalid-attempt"} {
		t.Run(scenario, func(t *testing.T) {
			database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "recovery.db")), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			connection, _ := database.DB()
			defer connection.Close()
			if err := database.AutoMigrate(&model.Task{}, &model.RouteAttempt{}); err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(time.Minute)
			task := model.Task{ID: "original-video", UserID: "owner", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", Status: model.TaskStatusRunning, PollStage: "browser_receipt_lookup", LeaseOwner: "worker", LeaseExpiresAt: &expires, Prompt: "original prompt", Attempts: 1}
			attempt := model.RouteAttempt{ID: "original-attempt", TaskID: task.ID, RouteRun: 1, AttemptNumber: 1, DispatchState: "submission_unknown"}
			if scenario == "invalid-attempt" {
				attempt.DispatchState = "failed"
			}
			if err := database.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if err := database.Create(&attempt).Error; err != nil {
				t.Fatal(err)
			}
			if scenario == "lost-lease" {
				task.LeaseOwner = "stale-worker"
			}
			receipt := doubaobrowser.Receipt{TaskID: task.ID, ProfileID: "550e8400-e29b-41d4-a716-446655440000"}
			if scenario == "foreign-receipt" {
				receipt.TaskID = "other-task"
			}
			service := &Service{repo: repository.New(database)}
			lookups := 0
			err = service.restoreDoubaoBrowserReceipt(context.Background(), &task, func(_ context.Context, owner, id string) (doubaobrowser.Receipt, error) {
				lookups++
				if owner != "owner" || id != "original-video" {
					t.Fatal("lookup identity changed")
				}
				return receipt, nil
			})
			stored, readErr := service.repo.Task(task.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			savedAttempt, _ := service.repo.LatestRouteAttempt(task.ID)
			if lookups != 1 || stored.Prompt != "original prompt" || stored.Attempts != 1 {
				t.Fatal("recovery changed original request")
			}
			if scenario == "original" {
				if err != nil || stored.ProviderRequestID != generation.EncodeDoubaoBrowserTask(receipt) || stored.PollStage != "submitted" || savedAttempt.DispatchState != "accepted" {
					t.Fatalf("receipt not restored: %+v %v", stored, err)
				}
			} else if err == nil || stored.ProviderRequestID != "" || stored.PollStage != "browser_receipt_lookup" || savedAttempt.DispatchState != attempt.DispatchState {
				t.Fatalf("unsafe recovery or partial transaction: %+v %v", stored, err)
			}
		})
	}
}
