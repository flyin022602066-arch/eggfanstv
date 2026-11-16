package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"
)

func TestVideoPromptRepairOnlyExplicitModeration(t *testing.T) {
	task := &model.Task{Type: "canvas_video"}
	for _, scenario := range []struct {
		reason error
		want   bool
	}{
		{errors.New("审核不通过,请修改后重试"), true},
		{errors.New("content policy violation"), true},
		{errors.New("reference image content policy violation"), false},
		{errors.New("connection reset by peer"), false},
		{errors.New("insufficient_quota"), false},
		{generation.StatePendingError{Cause: errors.New("审核不通过")}, false},
		{generation.SubmissionUnknownError{Cause: errors.New("审核不通过")}, false},
	} {
		if got := videoPromptRepairEligible(task, scenario.reason); got != scenario.want {
			t.Fatalf("%v eligible=%v", scenario.reason, got)
		}
	}
	task.FailureDiagnostics = &model.TaskFailureDiagnostics{ExecutionResult: "completed"}
	if videoPromptRepairEligible(task, errors.New("审核不通过")) {
		t.Fatal("completed video must recover its original result")
	}
}

func TestVideoPromptRepairRejectsChangedBindings(t *testing.T) {
	original := "图片1中的角色走向@[asset:scene-1]，参考@图片2，参考@音频1。"
	for _, scenario := range []struct {
		text  string
		valid bool
	}{
		{`{"accepted":true,"replacements":[{"original":"走向","replacement":"离开"}]}`, true},
		{`{"accepted":true,"replacements":[{"original":"图片1","replacement":"图片2"}]}`, false},
		{`{"accepted":true,"replacements":[{"original":"@图片2","replacement":"图片2"}]}`, false},
		{"```json\n{\"accepted\":true,\"replacements\":[{\"original\":\"走向\",\"replacement\":\"离开\"}]}\n```", true},
		{`{"accepted":false}`, false},
		{`{"accepted":true,"prompt":""}`, false},
		{"not-json", false},
	} {
		_, _, err := parseVideoPromptPreflight(original, scenario.text, nil)
		if (err == nil) != scenario.valid {
			t.Fatalf("valid=%v: %v", scenario.valid, err)
		}
	}
}

func TestVideoPromptRepairPreservesRepeatedReferenceMentions(t *testing.T) {
	original := "角色对应图片1，场景对应@图片2。图片1中的角色在@图片2前交谈，伤口鲜血喷涌。"
	response := `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"不展示受伤细节"}]}`
	prompt, edits, err := parseVideoPromptPreflight(original, response, nil)
	if err != nil || len(edits) != 1 || prompt != strings.Replace(original, "伤口鲜血喷涌", "不展示受伤细节", 1) {
		t.Fatalf("all repeated reference mentions and surrounding wording must remain exact: %q %v", prompt, err)
	}
}

func TestVideoPromptRepairPreservesInputAndRetriesOnce(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "repair.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := database.DB()
	defer connection.Close()
	if err := database.AutoMigrate(&model.Task{}, &model.TaskLog{}, &model.SystemSetting{}, &model.Resource{}, &model.Asset{}, &model.AssetRepresentation{}, &model.CanvasProject{}, &model.Result{}, &model.TaskTextDelta{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	calls := 0
	videoCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if request.URL.Path == "/prod-api/v1/videos" {
			videoCalls++
			params, _ := body["params"].(map[string]any)
			images, _ := body["image_urls"].([]any)
			if body["prompt"] != "图片1中的角色平静告别，远景定格。" || body["model"] != "original-video" || params["duration"] != float64(15) || params["ratio"] != "16:9" || len(images) != 1 || images[0] != "https://example.invalid/character.png" {
				t.Error("actual retried video request lost edited prompt, settings or reference binding")
			}
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"error":{"code":"invalid_request","message":"offline terminal fixture"}}`))
			return
		}
		calls++
		encoded, _ := json.Marshal(body)
		if body["model"] != "fixture-text" || !strings.Contains(string(encoded), "不得规避平台审核") {
			t.Error("compliance editing instruction or text model lost")
		}
		writer.Header().Set("Content-Type", "application/json")
		content := `{"accepted":true,"replacements":[{"original":"图片1","replacement":"图片2"}]}`
		if calls > 1 {
			content = `{"accepted":true,"replacements":[{"original":"发生冲突","replacement":"平静告别，远景定格"}]}`
			if !strings.Contains(string(encoded), "上一次编辑结果未通过校验") {
				t.Error("text model was not instructed to correct the rejected binding")
			}
		}
		response := map[string]any{"id": "text-result-not-video-receipt", "choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}}
		_ = json.NewEncoder(writer).Encode(response)
	}))
	defer server.Close()
	service := &Service{repo: repository.New(database), dataDir: t.TempDir(), mode: serviceModeLocal, coordinator: platform.NewLocalCoordinator()}
	input := map[string]any{"mode": "video", "prompt": "图片1中的角色发生冲突。", "config": map[string]any{"interfaceType": "nono-video", "model": "original-video", "size": "16:9", "videoSeconds": "15", "apiKey": "synthetic-video-key"}, "referenceImages": []any{map[string]any{"id": "bound-character", "url": "https://example.invalid/character.png"}}, "metadata": map[string]any{"shotId": "shot", "resolvedCharacterVersions": []any{map[string]any{"assetId": "character", "versionId": "look"}}}, "videoPromptRepair": map[string]any{"enabled": true, "config": map[string]any{"interfaceType": "chat-completion", "apiFormat": "openai", "baseUrl": server.URL + "/v1", "apiKey": "synthetic-text-key", "model": "fixture-text"}}}
	input["config"].(map[string]any)["baseUrl"] = server.URL + "/prod-api/v1"
	if err := service.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	expires := time.Now().Add(time.Minute)
	task := model.Task{ID: "repair-parent", UserID: "owner", Type: "canvas_video", Status: model.TaskStatusRunning, LeaseOwner: "worker", LeaseExpiresAt: &expires, InputJSON: string(raw), Prompt: "图片1中的角色发生冲突。", Model: "nono::original-video", ProviderRequestID: "failed-original-receipt"}
	if err := database.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repaired, err := service.tryRepairVideoPrompt(context.Background(), &task, errors.New("审核不通过,请修改后重试"))
	if err != nil || !repaired {
		t.Fatalf("repair=%v err=%v", repaired, err)
	}
	var children []model.Task
	database.Where("id <> ?", task.ID).Find(&children)
	if calls != 2 || len(children) != 1 {
		t.Fatalf("calls=%d children=%d", calls, len(children))
	}
	child := children[0]
	var actual map[string]any
	_ = json.Unmarshal([]byte(child.InputJSON), &actual)
	for _, key := range []string{"config", "referenceImages"} {
		before, _ := json.Marshal(input[key])
		after, _ := json.Marshal(actual[key])
		if string(before) != string(after) {
			t.Fatalf("%s changed", key)
		}
	}
	if child.ProviderRequestID != "" || child.Prompt != "图片1中的角色平静告别，远景定格。" || child.Status != model.TaskStatusQueued || strings.Contains(child.InputJSON, "synthetic-video-key") {
		t.Fatalf("unsafe child state: %s %s", child.ID, child.Status)
	}
	plain, err := service.decryptTaskInputJSON(child.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	var request generation.Input
	if err := json.Unmarshal([]byte(plain), &request); err != nil {
		t.Fatal(err)
	}
	_, submitErr := generation.RunVideoTaskWithPolicy(context.Background(), request, generation.DefaultVideoPollPolicy())
	if submitErr == nil || videoCalls != 1 {
		t.Fatalf("retried video protocol was not actually submitted exactly once: calls=%d err=%v", videoCalls, submitErr)
	}
	child.LeaseOwner = "next-worker"
	if repeated, err := service.tryRepairVideoPrompt(context.Background(), &child, errors.New("审核不通过")); repeated || err != nil || calls != 2 {
		t.Fatalf("repair loop: %v %v calls=%d", repeated, err, calls)
	}
	parent, _ := service.repo.Task(task.ID)
	if parent.Status != model.TaskStatusFailed || parent.ProviderRequestID != "failed-original-receipt" || parent.PollStage != "" {
		t.Fatal("original receipt or true failure was lost")
	}
	if err := database.Model(&model.Task{}).Where("id = ?", parent.ID).Updates(map[string]any{"failure_diagnostics": `{"summary":"审核未通过；自动合规润色未提交：合规润色改变了素材引用编号"}`}).Error; err != nil {
		t.Fatal(err)
	}
	parent, _ = service.repo.Task(task.ID)
	queued, queueErr := service.queueVideoPromptRepair(parent)
	if queueErr != nil || queued.Status != model.TaskStatusQueued {
		t.Fatalf("a failed text-only repair must be retryable without submitting the original video: %v", queueErr)
	}
	stored, _ := service.repo.Task(parent.ID)
	var queuedInput struct {
		Metadata map[string]any `json:"metadata"`
	}
	_ = json.Unmarshal([]byte(stored.InputJSON), &queuedInput)
	if queuedInput.Metadata["videoPromptRepairAttempt"] != nil || videoCalls != 1 {
		t.Fatal("text repair retries must reset only the failed editing attempt, never submit original video")
	}
}
