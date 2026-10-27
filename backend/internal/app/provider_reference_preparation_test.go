package app

import (
	"context"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestVideoReferencePreparationStageRespectsExecutionLease(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.TaskLog{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	expiresAt := time.Now().Add(time.Minute)
	task := model.Task{ID: "reference-stage-task", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning, LeaseOwner: "owner-1", LeaseExpiresAt: &expiresAt}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	ctx := withProviderAnalytics(context.Background(), svc, task)
	input := canvasGenerationInput{Mode: "video", ReferenceImages: []providerMedia{{URL: "https://h.uguu.se/prepared.png"}}}
	if err := svc.hydrateGenerationMedia(ctx, "user-1", &input, providerMediaHydrationPolicy{requireURL: true}); err != nil {
		t.Fatal(err)
	}
	saved, err := svc.repo.Task(task.ID)
	if err != nil || saved.Stage != "参考素材已准备完成，正在提交视频" || saved.Progress != 0 {
		t.Fatalf("incorrect preparation stage: task=%#v err=%v", saved, err)
	}
	logs, err := svc.repo.TaskLogs(task.UserID, task.ID)
	if err != nil || len(logs) != 2 || logs[0].Message != "正在准备参考图片 1/1（链接检查/图床上传，尚未提交视频）" {
		t.Fatalf("preparation log missing: logs=%#v err=%v", logs, err)
	}
	task.LeaseOwner = "stale-owner"
	stale := withProviderAnalytics(context.Background(), svc, task)
	if err := svc.noteVideoReferencePreparation(stale, "must-not-overwrite"); err == nil {
		t.Fatal("stale worker overwrote preparation stage")
	}
	saved, err = svc.repo.Task(task.ID)
	if err != nil || saved.Stage != "参考素材已准备完成，正在提交视频" {
		t.Fatal("stale worker changed task progress")
	}
}
