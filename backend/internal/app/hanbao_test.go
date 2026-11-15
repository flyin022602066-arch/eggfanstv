package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
	localtask "infinite-canvas/backend/internal/task"
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
	if stored.Stage != "已提交，等待查询上游状态" || stored.Progress != 0 {
		t.Fatalf("accepted receipt kept misleading connection stage: %s %d", stored.Stage, stored.Progress)
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

func TestHanbaoDiagnosticsDistinguishRuntimeAndUpstream(t *testing.T) {
	for _, source := range []string{"local_runtime", "local_validation", "upstream_response"} {
		t.Run(source, func(t *testing.T) {
			task := &model.Task{ID: "fixture", Stage: "正在连接上游"}
			var err error = &hanbao.CallError{Source: source, Stage: "text2video", Code: "3", Reason: "明确的失败详情"}
			if source == "local_runtime" {
				err = generation.SubmissionUnknownError{Cause: hanbao.UncertainError{Reason: err.Error(), Cause: err}}
			}
			captureTaskFailureDiagnostics(task, err, "unknown")
			diagnostic := task.FailureDiagnostics
			if diagnostic.Source != source || !strings.Contains(diagnostic.Summary, "明确的失败详情") || !strings.Contains(diagnostic.Summary, "code=3") {
				t.Fatalf("details lost: %+v", diagnostic)
			}
			if source == "local_runtime" && diagnostic.ExecutionResult != "pending" {
				t.Fatalf("uncertain submission was marked terminal: %+v", diagnostic)
			}
			if source == "upstream_response" && diagnostic.ProviderCode != "3" {
				t.Fatal("upstream code lost")
			}
		})
	}
}

func TestHanbaoRetrievedVideoPersistsAndBindsOriginalCanvasNode(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "retrieved.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), dir)
	owner, err := service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	receipt := generation.EncodeHanbaoTask(hanbao.TaskRef{SubmitID: "cv:original:receipt", Account: "fixture-account"})
	now := time.Now()
	task := model.Task{
		ID: "retrieved-hanbao-video", UserID: owner.ID, ProjectID: "original-canvas", Type: "canvas_video",
		Model: "hanbao::seedance_v2.5", Status: model.TaskStatusRunning, ProviderRequestID: receipt,
		Stage: "视频已取回，正在保存", CreatedAt: now, UpdatedAt: now,
		InputJSON: `{"mode":"video","metadata":{"source":"canvas","nodeId":"original-video-node"}}`,
	}
	canvasJSON := json.RawMessage(`{"id":"original-canvas","title":"Offline recovery fixture","revision":0,"nodes":[{"id":"original-video-node","type":"video","metadata":{"taskId":"retrieved-hanbao-video","status":"loading"}}],"connections":[]}`)
	if _, err := service.UpsertUserCanvasProject(owner.ID, canvasJSON); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	clip := []byte("offline video download fixture")
	result, err := service.persistTaskGeneratedMediaResult(task, map[string]any{
		"mode": "video", "video": map[string]any{"dataUrl": generation.DataURL("video/mp4", clip), "mimeType": "video/mp4"},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.saveTaskCompletionWithinStorageQuota(&task, encoded, nil, false); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := service.DeliverSucceededTask(task); err != nil {
			t.Fatal(err)
		}
	}
	stored, err := service.Task(owner.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded || stored.Stage != "任务完成" || stored.ProviderRequestID != receipt || stored.ResultState != localtask.ResultStateReady || len(stored.Outputs) != 1 {
		t.Fatalf("original task did not become a delivered success: %+v", stored)
	}
	intents := service.CanvasBindingIntents(task)
	if len(intents) != 1 || intents[0].TargetBinding == nil || intents[0].TargetBinding.NodeID != "original-video-node" || intents[0].AssetID != stored.Outputs[0].MaterializedAssetID {
		t.Fatalf("video not bound to original canvas node: %+v", intents)
	}
	canvasJSON, err = service.UserCanvasProject(owner.ID, task.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	var canvas struct {
		Nodes []struct {
			ID       string `json:"id"`
			Metadata struct {
				AssetID    string `json:"assetId"`
				StorageKey string `json:"storageKey"`
			} `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(canvasJSON, &canvas); err != nil {
		t.Fatal(err)
	}
	if len(canvas.Nodes) != 1 || canvas.Nodes[0].ID != "original-video-node" || canvas.Nodes[0].Metadata.AssetID != stored.Outputs[0].MaterializedAssetID || canvas.Nodes[0].Metadata.StorageKey != "resource:"+stored.Outputs[0].ResourceID {
		t.Fatalf("saved canvas does not contain retrieved video: %s", canvasJSON)
	}
	var resource model.Resource
	if err := db.First(&resource, "id = ?", stored.Outputs[0].ResourceID).Error; err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(dir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil || string(content) != string(clip) {
		t.Fatalf("retrieved bytes were not preserved: %v", err)
	}
	var assetCount int64
	if err := db.Model(&model.Asset{}).Where("user_id = ?", owner.ID).Count(&assetCount).Error; err != nil || assetCount != 1 {
		t.Fatalf("delivery duplicated video asset: count=%d error=%v", assetCount, err)
	}
}

func TestHanbaoManualRecoveryValidatesReceiptWithoutDispatch(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "recovery.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), dir)
	owner, err := service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	for _, receipt := range []string{"", "hanbao:invalid"} {
		task := model.Task{ID: newID(), UserID: owner.ID, Type: "canvas_video", Status: model.TaskStatusFailed, ProviderRequestID: receipt, Model: "hanbao::seedance_v2.5", InputJSON: `{"mode":"video","config":{"interfaceType":"hanbao-video","model":"seedance_v2.5"}}`}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		_, err := service.QueryFailedVideoTask(context.Background(), owner.ID, task.ID)
		if err == nil || (receipt != "" && !strings.Contains(err.Error(), "回执")) {
			t.Fatalf("Hanbao recovery not wired or invalid receipt accepted: %v", err)
		}
		stored, _ := service.repo.Task(task.ID)
		if stored.Status != model.TaskStatusFailed || stored.LeaseOwner != "" {
			t.Fatal("invalid recovery modified task")
		}
		if _, err := service.QueryFailedVideoTask(context.Background(), "other-user", task.ID); err == nil {
			t.Fatal("foreign task query accepted")
		}
		if receipt != "" {
			lease := "manual-recovery:test"
			if err := service.repo.ClaimFailedTaskProviderRecovery(task.ID, owner.ID, lease, time.Minute); err != nil {
				t.Fatal(err)
			}
			task.LeaseOwner = "stale-owner"
			cause := &hanbao.CallError{Source: "upstream_response", Stage: "视频结果失败", Reason: "参考素材不符合要求"}
			if _, err := service.confirmHanbaoQueryFailure(&task, "failed", cause); !errors.Is(err, repository.ErrTaskProviderRecoveryConflict) {
				t.Fatal("stale worker overwrote failure", err)
			}
			task.LeaseOwner = lease
			task.FailureDiagnostics = &model.TaskFailureDiagnostics{Source: "local_runtime", ExecutionResult: "pending"}
			result, err := service.confirmHanbaoQueryFailure(&task, "failed", cause)
			if err != nil || result.Task.Stage == "submission_unknown" || result.Task.FailureDiagnostics.Source != "upstream_response" || result.Task.FailureDiagnostics.ExecutionResult != "failed" || !strings.Contains(result.Task.FailureDiagnostics.Summary, "参考素材不符合要求") {
				t.Fatalf("query failure lost: %+v %v", result, err)
			}
			stored, _ := service.repo.Task(task.ID)
			if stored.ProviderRequestID != receipt || stored.Status != model.TaskStatusFailed || stored.LeaseOwner != "" {
				t.Fatal("query changed task identity or lease")
			}
		}
	}
}
