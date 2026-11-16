package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"
)

func TestVideoPromptPreflightAppliesOnlyExactLocalEdits(t *testing.T) {
	original := "【15秒 16:9】\nKaelen（图片1）进入森林，伤口鲜血喷涌。\nSera（图片2）：Keep moving.\n落：远景定格。"
	response := `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"受伤细节不作展示","reason":"去除血腥特写"}]}`
	prompt, edits, err := parseVideoPromptPreflight(original, response, []string{"Kaelen", "Sera"})
	if err != nil || prompt != strings.Replace(original, "伤口鲜血喷涌", "受伤细节不作展示", 1) || len(edits) != 1 {
		t.Fatalf("local edit failed: %q %+v %v", prompt, edits, err)
	}
}

func TestVideoPromptPreflightMinimalWordRulePreservesUntouchedBytes(t *testing.T) {
	original := "  【15秒 16:9】\r\n起：Kaelen（@图片1）握住@[asset:prop-1]，鲜血喷涌。\r\nSera（@图片2）：  Keep moving!\r\n落：缓慢拉远；背景、服装与光线不变。  "
	response := `{"accepted":true,"replacements":[{"original":"鲜血喷涌","replacement":"不展示伤情","reason":"去除血腥细节"}]}`
	prompt, _, err := parseVideoPromptPreflight(original, response, []string{"Kaelen", "Sera"})
	if err != nil || prompt != strings.Replace(original, "鲜血喷涌", "不展示伤情", 1) {
		t.Fatalf("word-only editing altered unrelated text or whitespace: %q %v", prompt, err)
	}
	for _, rule := range []string{"先检测敏感词汇", "不得借机润色正常内容", "未命中部分必须逐字保留", "不得规避平台审核"} {
		if !strings.Contains(videoPromptPreflightInstruction, rule) {
			t.Fatalf("minimal-edit instruction missing %q", rule)
		}
	}
}

func preflightFixture(t *testing.T, handler http.HandlerFunc) (*Service, *gorm.DB, *httptest.Server) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "preflight.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := database.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.AutoMigrate(&model.Task{}, &model.TaskLog{}, &model.SystemSetting{}, &model.Resource{}, &model.Asset{}, &model.AssetRepresentation{}, &model.CanvasProject{}, &model.Result{}, &model.TaskTextDelta{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	service := &Service{repo: repository.New(database), dataDir: t.TempDir(), mode: serviceModeLocal, coordinator: platform.NewLocalCoordinator()}
	return service, database, server
}

func preflightTaskFixture(t *testing.T, service *Service, database *gorm.DB, server *httptest.Server, id string) *model.Task {
	t.Helper()
	prompt := "【15秒 16:9】图片1中的Kaelen站定，伤口鲜血喷涌。"
	input := map[string]any{"mode": "video", "prompt": prompt, "config": map[string]any{"interfaceType": "nono-video", "model": "original-video", "baseUrl": server.URL + "/prod-api/v1", "size": "16:9", "videoSeconds": "15", "videoGenerateAudio": "true", "apiKey": "synthetic-video-key"}, "referenceImages": []any{map[string]any{"id": "character-image", "name": "Kaelen", "url": "https://example.invalid/character.png"}}, "referenceVideos": []any{}, "referenceAudios": []any{}, "metadata": map[string]any{"nodeId": "node-1", "videoPromptProtectedNames": []any{"Kaelen"}, "resolvedCharacterVersions": []any{map[string]any{"assetId": "character", "versionId": "look"}}}, "videoPromptRepair": map[string]any{"enabled": true, "config": map[string]any{"interfaceType": "chat-completion", "apiFormat": "openai", "baseUrl": server.URL + "/v1", "apiKey": "synthetic-text-key", "model": "fixture-text"}}}
	if err := service.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	expires := time.Now().Add(time.Minute)
	task := &model.Task{ID: id, UserID: "owner", Type: "canvas_video", Status: model.TaskStatusRunning, LeaseOwner: "worker", LeaseExpiresAt: &expires, InputJSON: string(raw), Prompt: prompt, Model: "nono::original-video"}
	if err := database.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func TestVideoPromptPreflightPersistsBeforeNativeVideoSubmission(t *testing.T) {
	calls, videoCalls := 0, 0
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		if request.URL.Path == "/prod-api/v1/videos" {
			videoCalls++
			params, _ := body["params"].(map[string]any)
			images, _ := body["image_urls"].([]any)
			if body["prompt"] != "【15秒 16:9】图片1中的Kaelen站定，受伤细节不作展示。" || params["duration"] != float64(15) || params["ratio"] != "16:9" || len(images) != 1 || body["model"] != "original-video" {
				t.Error("native video payload changed beyond prompt")
			}
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"error":{"code":"invalid_request","message":"offline fixture"}}`))
			return
		}
		calls++
		encoded, _ := json.Marshal(body)
		if !strings.Contains(string(encoded), "不得规避平台审核") {
			t.Error("missing compliance boundary")
		}
		content := `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"受伤细节不作展示","reason":"去除血腥特写"}]}`
		_ = json.NewEncoder(writer).Encode(map[string]any{"id": "text-response-not-video-receipt", "choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
	})
	task := preflightTaskFixture(t, service, database, server, "preflight-task")
	var before map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &before)
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	persisted, err := service.repo.Task(task.ID)
	if err != nil || persisted.Prompt != task.Prompt || calls != 1 || videoCalls != 0 {
		t.Fatalf("preflight persistence: %v", err)
	}
	if persisted.ProviderRequestID != "" || persisted.PollStage != "" {
		t.Fatal("text preflight contaminated the video receipt")
	}
	var after map[string]any
	_ = json.Unmarshal([]byte(persisted.InputJSON), &after)
	for _, key := range []string{"config", "referenceImages", "referenceVideos", "referenceAudios", "videoPromptRepair"} {
		first, _ := json.Marshal(before[key])
		second, _ := json.Marshal(after[key])
		if string(first) != string(second) {
			t.Fatalf("preflight altered %s", key)
		}
	}
	if strings.Contains(persisted.InputJSON, "synthetic-video-key") || strings.Contains(persisted.InputJSON, "synthetic-text-key") {
		t.Fatal("credential persisted unprotected")
	}
	if err := service.preflightVideoPrompt(context.Background(), persisted); err != nil || calls != 1 {
		t.Fatalf("same submission rechecked: %v", err)
	}
	plain, err := service.decryptTaskInputJSON(persisted.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	var input generation.Input
	_ = json.Unmarshal([]byte(plain), &input)
	_, err = generation.RunVideoTaskWithPolicy(context.Background(), input, generation.DefaultVideoPollPolicy())
	if err == nil || videoCalls != 1 {
		t.Fatalf("native video submission count=%d err=%v", videoCalls, err)
	}
}

func TestVideoPromptPreflightProtectsCancellationAndExistingReceipts(t *testing.T) {
	var service *Service
	var database *gorm.DB
	var calls atomic.Int32
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		_ = database.Model(&model.Task{}).Where("id = ?", "cancelled-task").Update("status", model.TaskStatusCancelled).Error
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"accepted":true,"replacements":[]}`}}}})
	})
	task := preflightTaskFixture(t, service, database, server, "cancelled-task")
	original := task.Prompt
	if err := service.preflightVideoPrompt(context.Background(), task); !errors.Is(err, repository.ErrTaskStateConflict) {
		t.Fatalf("cancel race accepted: %v", err)
	}
	stored, _ := service.repo.Task(task.ID)
	if stored.Status != model.TaskStatusCancelled || stored.Prompt != original {
		t.Fatal("cancelled task overwritten")
	}
	task.ProviderRequestID = "existing-upstream-task"
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 1 {
		t.Fatal("existing receipt re-edited")
	}
	task.ProviderRequestID, task.PollStage = "", "browser_receipt_lookup"
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 1 {
		t.Fatal("unknown submission re-edited")
	}
}

func TestVideoPromptPreflightChecksIndependentSubmissionsConcurrently(t *testing.T) {
	entered := make(chan struct{}, 6)
	release := make(chan struct{})
	var closeOnce sync.Once
	defer closeOnce.Do(func() { close(release) })
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		entered <- struct{}{}
		<-release
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"accepted":true,"replacements":[]}`}}}})
	})
	tasks := []*model.Task{}
	for index := 0; index < 6; index++ {
		tasks = append(tasks, preflightTaskFixture(t, service, database, server, fmt.Sprintf("parallel-%d", index)))
	}
	results := make(chan error, len(tasks))
	for _, task := range tasks {
		go func() { results <- service.preflightVideoPrompt(context.Background(), task) }()
	}
	for range tasks {
		select {
		case <-entered:
		case <-time.After(10 * time.Second):
			t.Fatal("one text preflight queued the other video tasks")
		}
	}
	closeOnce.Do(func() { close(release) })
	for range tasks {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestVideoPromptPreflightAllowsUnchangedSafePrompt(t *testing.T) {
	original := "图片1中的角色走入森林。\n落：远景定格。"
	prompt, edits, err := parseVideoPromptPreflight(original, `{"accepted":true,"replacements":[]}`, nil)
	if err != nil || prompt != original || len(edits) != 0 {
		t.Fatalf("safe prompt changed: %q %+v %v", prompt, edits, err)
	}
}

func TestVideoPromptPreflightNeverEditsReadOnlyBindings(t *testing.T) {
	original := "【15秒 16:9】Morwenna（图片5）从图片1离开，Alaric（图片6）跟随。\n起：图片3（旧信）收好，伤口鲜血喷涌。\n落：图片4（传讯铜管）留在桌下。"
	names := []string{"Morwenna", "Alaric", "旧信", "传讯铜管"}
	data := videoPromptEditingData(original, names)
	var payload struct{ EditableFragments []string }
	if err := json.Unmarshal([]byte(strings.SplitN(data, "\n", 2)[1]), &payload); err != nil {
		t.Fatal(err)
	}
	for _, fragment := range payload.EditableFragments {
		if len(videoPromptProtectedRanges(fragment, names)) > 0 {
			t.Fatalf("read-only binding exposed for editing: %q", fragment)
		}
	}
	response := `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"不展示受伤细节"}]}`
	prompt, _, err := parseVideoPromptPreflight(original, response, names)
	if err != nil || prompt != strings.Replace(original, "伤口鲜血喷涌", "不展示受伤细节", 1) {
		t.Fatalf("safe local repair failed: %v", err)
	}
	for _, pair := range [][2]string{{"图片5", "图片6"}, {"图片3（旧信）收好", "图片3（旧信）藏好"}, {"Morwenna", "Alaric"}, {"15秒", "30秒"}, {"伤口鲜血喷涌", "看向图片9"}} {
		reply, _ := json.Marshal(map[string]any{"accepted": true, "replacements": []videoPromptReplacement{{Original: pair[0], Replacement: pair[1]}}})
		if _, _, err := parseVideoPromptPreflight(original, string(reply), names); err == nil {
			t.Fatalf("binding edit accepted: %q", pair)
		}
	}
}

func TestVideoPromptPreflightRechecksNewTaskRunAndChangedDraft(t *testing.T) {
	var calls atomic.Int32
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(writer).Encode(map[string]any{"id": "text-only-receipt", "choices": []any{map[string]any{"message": map[string]any{"content": `{"accepted":true,"replacements":[]}`}}}})
	})
	task := preflightTaskFixture(t, service, database, server, "first-task")
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 1 {
		t.Fatalf("same submission checked again: %v", err)
	}
	task.RouteRun++
	if err := database.Model(&model.Task{}).Where("id = ?", task.ID).Update("route_run", task.RouteRun).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 2 {
		t.Fatalf("new run not checked: %v", err)
	}
	task.Prompt += "远景定格。"
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	input["prompt"] = task.Prompt
	raw, _ := json.Marshal(input)
	task.InputJSON = string(raw)
	if err := database.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"prompt": task.Prompt, "input_json": task.InputJSON}).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 3 {
		t.Fatalf("changed draft not checked: %v", err)
	}
	cloned := *task
	cloned.ID = "cloned-task"
	if err := database.Create(&cloned).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.preflightVideoPrompt(context.Background(), &cloned); err != nil || calls.Load() != 4 {
		t.Fatalf("cloned submission not checked: %v", err)
	}
}

func TestVideoPromptPreflightCorrectsInvalidEditBeforeSubmitting(t *testing.T) {
	var calls atomic.Int32
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		content := `{"accepted":true,"replacements":[{"original":"图片1","replacement":"图片2"}]}`
		if calls.Add(1) == 2 {
			content = `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"不展示受伤细节"}]}`
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}}}})
	})
	task := preflightTaskFixture(t, service, database, server, "corrected-task")
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls.Load() != 2 || !strings.Contains(task.Prompt, "图片1中的Kaelen") || strings.Contains(task.Prompt, "图片2") {
		t.Fatalf("invalid replacement was not corrected safely: %v", err)
	}
}

func TestVideoPromptPreflightRejectsUnsafeOrAmbiguousEdits(t *testing.T) {
	original := "【15秒 16:9】Kaelen（图片1）站定，Sera（图片2）离开。受伤细节。受伤细节。"
	for _, response := range []string{
		`{"accepted":false}`,
		`{"accepted":true,"replacements":[{"original":"Kaelen","replacement":"Marcus"}]}`,
		`{"accepted":true,"replacements":[{"original":"图片1","replacement":"图片2"}]}`,
		`{"accepted":true,"replacements":[{"original":"15秒","replacement":"30秒"}]}`,
		`{"accepted":true,"replacements":[{"original":"受伤细节","replacement":"远景"}]}`,
		`{"accepted":true,"replacements":[{"original":"不存在的字词","replacement":"远景"}]}`,
		`{"accepted":true,"replacements":[{"original":"站定","replacement":"站定\n新镜头"}]}`,
		`{"accepted":true,"replacements":[{"original":"站定","replacement":"离开"},{"original":"站定，","replacement":"离开。"}]}`,
		`{"accepted":true,"prompt":"全文重写"}`,
		`not-json`,
	} {
		if _, _, err := parseVideoPromptPreflight(original, response, []string{"Kaelen", "Sera"}); err == nil {
			t.Fatalf("invalid edit accepted: %s", response)
		}
	}
}
