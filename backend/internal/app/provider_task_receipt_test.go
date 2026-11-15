package app

import (
	"context"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestVideoRecoveryHydratesOnlyOriginalTaskReceipt(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.Task{}, &model.RouteAttempt{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	service := &Service{repo: repository.New(db)}
	task := model.Task{ID: "original-video", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusFailed}
	for _, item := range []any{
		&task,
		&model.RouteAttempt{ID: "original-attempt", TaskID: task.ID, RouteRun: 1, AttemptNumber: 1, DispatchState: "accepted", ProviderRequestID: "original-provider-id"},
		&model.RouteAttempt{ID: "another-attempt", TaskID: "other-video", RouteRun: 99, AttemptNumber: 99, DispatchState: "accepted", ProviderRequestID: "wrong-provider-id"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	service.hydrateTaskProviderRequestID(&task)
	if task.ProviderRequestID != "original-provider-id" {
		t.Fatalf("original route receipt was lost or mixed with another task: %q", task.ProviderRequestID)
	}
	task.ProviderRequestID = "existing-provider-id"
	service.hydrateTaskProviderRequestID(&task)
	if task.ProviderRequestID != "existing-provider-id" {
		t.Fatal("existing receipt was replaced")
	}
	missing := model.Task{ID: "missing-video", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusFailed}
	if err := db.Create(&missing).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.QueryFailedVideoTask(context.Background(), "other-user", missing.ID); err == nil {
		t.Fatal("foreign task recovery allowed")
	}
	_, err = service.QueryFailedVideoTask(context.Background(), "owner", missing.ID)
	if err == nil || !strings.Contains(err.Error(), "本地未记录上游任务 ID") || !strings.Contains(err.Error(), "不会重新提交生成") {
		t.Fatalf("missing receipt did not explain query-only recovery: %v", err)
	}
	stored, err := service.repo.Task(missing.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ProviderRequestID != "" || stored.LeaseOwner != "" {
		t.Fatalf("missing receipt query altered original task: %+v %v", stored, err)
	}
}
