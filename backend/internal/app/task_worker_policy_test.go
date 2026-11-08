package app

import (
	"context"
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWorkerExecutionTimeoutPreservesRuntimeProfile(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	configured := defaultRuntimePolicy()
	configured.Task.TextTimeoutMinutes = 13
	encoded, err := json.Marshal(configured)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	for _, mode := range []serviceMode{serviceModeHosted, serviceModeLocal} {
		service := &Service{repo: repository.New(db), mode: mode}
		policy, err := service.RuntimePolicy()
		if err != nil {
			t.Fatal(err)
		}
		for _, taskType := range []string{"canvas_text", "canvas_image", "canvas_audio"} {
			timeout, err := (appTaskPolicy{service: service}).ExecutionTimeout(context.Background(), taskType)
			want := taskExecutionTimeoutWithPolicy(taskType, policy.Task)
			if err != nil || timeout != want {
				t.Fatalf("mode=%s task=%s timeout=%s want=%s error=%v", mode, taskType, timeout, want, err)
			}
		}
	}
}
