package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

func fallbackTaskFixture(t *testing.T, service *Service, database *gorm.DB, server *httptest.Server, id string) *model.Task {
	t.Helper()
	task := preflightTaskFixture(t, service, database, server, id)
	plain, err := service.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	_ = json.Unmarshal([]byte(plain), &input)
	input["videoPromptRepair"].(map[string]any)["fallback"] = map[string]any{"modelSelection": "backup::backup-text", "config": map[string]any{"model": "backup-text", "interfaceType": "claude-api", "apiFormat": "claude", "baseUrl": server.URL + "/backup", "apiKey": "synthetic-backup-key"}}
	if err := service.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	task.InputJSON = string(raw)
	if err := database.Model(task).Update("input_json", task.InputJSON).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func TestVideoPromptPreflightFallbackSwitchesOnlyTextRoute(t *testing.T) {
	primaryCalls, fallbackCalls := 0, 0
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		if strings.HasPrefix(request.URL.Path, "/backup/") {
			fallbackCalls++
			if body["model"] != "backup-text" || request.Header.Get("x-api-key") != "synthetic-backup-key" || strings.Contains(request.Header.Get("Authorization"), "synthetic-text-key") {
				t.Error("fallback protocol or credentials contaminated")
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"id": "fallback-text-receipt", "content": []any{map[string]any{"type": "text", "text": `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"受伤细节不作展示"}]}`}}})
			return
		}
		primaryCalls++
		writer.WriteHeader(http.StatusServiceUnavailable)
		_, _ = writer.Write([]byte(`{"error":{"message":"model service unavailable","code":"service_unavailable"}}`))
	})
	task := fallbackTaskFixture(t, service, database, server, "fallback-preflight")
	var before map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &before)
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	persisted, _ := service.repo.Task(task.ID)
	if primaryCalls != 1 || fallbackCalls != 1 || !strings.Contains(persisted.Prompt, "受伤细节不作展示") {
		t.Fatalf("calls=%d/%d prompt=%q", primaryCalls, fallbackCalls, persisted.Prompt)
	}
	if persisted.ProviderRequestID != "" || persisted.PollStage != "" || strings.Contains(persisted.InputJSON, "synthetic-backup-key") {
		t.Fatal("fallback leaked secret or contaminated video receipt")
	}
	var after map[string]any
	_ = json.Unmarshal([]byte(persisted.InputJSON), &after)
	for _, key := range []string{"config", "referenceImages", "referenceVideos", "referenceAudios", "videoPromptRepair"} {
		first, _ := json.Marshal(before[key])
		second, _ := json.Marshal(after[key])
		if string(first) != string(second) {
			t.Fatalf("fallback altered %s", key)
		}
	}
}

func TestVideoPromptPreflightFallbackAfterInvalidOutputKeepsOriginalPrompt(t *testing.T) {
	primaryCalls, fallbackCalls := 0, 0
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/backup/") {
			fallbackCalls++
			_ = json.NewEncoder(writer).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"accepted":true,"replacements":[]}`}}})
			return
		}
		primaryCalls++
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "not-json"}}}})
	})
	task := fallbackTaskFixture(t, service, database, server, "invalid-output-fallback")
	original := task.Prompt
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || primaryCalls != 2 || fallbackCalls != 1 || task.Prompt != original {
		t.Fatalf("calls=%d/%d err=%v", primaryCalls, fallbackCalls, err)
	}
}

func TestVideoPromptRepairFallbackPreservesChildVideoAndBindings(t *testing.T) {
	primaryCalls, fallbackCalls := 0, 0
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/backup/") {
			fallbackCalls++
			_ = json.NewEncoder(writer).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"accepted":true,"replacements":[{"original":"伤口鲜血喷涌","replacement":"受伤细节不作展示"}]}`}}})
			return
		}
		primaryCalls++
		writer.WriteHeader(http.StatusTooManyRequests)
		_, _ = writer.Write([]byte(`{"error":{"code":"insufficient_quota","message":"insufficient quota"}}`))
	})
	task := fallbackTaskFixture(t, service, database, server, "fallback-repair")
	var before map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &before)
	repaired, err := service.tryRepairVideoPrompt(context.Background(), task, errors.New("审核不通过,请修改后重试"))
	if err != nil || !repaired || primaryCalls != 1 || fallbackCalls != 1 {
		t.Fatalf("repair=%v calls=%d/%d err=%v", repaired, primaryCalls, fallbackCalls, err)
	}
	var child model.Task
	if err := database.Where("id <> ?", task.ID).First(&child).Error; err != nil {
		t.Fatal(err)
	}
	if child.Model != task.Model || child.Status != model.TaskStatusQueued || child.Prompt != strings.Replace(task.Prompt, "伤口鲜血喷涌", "受伤细节不作展示", 1) {
		t.Fatal("fallback changed video route or prompt beyond local edit")
	}
	var after map[string]any
	_ = json.Unmarshal([]byte(child.InputJSON), &after)
	for _, key := range []string{"config", "referenceImages", "referenceVideos", "referenceAudios", "videoPromptRepair"} {
		first, _ := json.Marshal(before[key])
		second, _ := json.Marshal(after[key])
		if string(first) != string(second) {
			t.Fatalf("repair changed %s", key)
		}
	}
	if strings.Contains(child.InputJSON, "synthetic-backup-key") {
		t.Fatal("child leaked fallback credential")
	}
}

func TestVideoPromptPreflightFallbackLoadsSavedSelectionForLegacyTasks(t *testing.T) {
	calls := 0
	service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasPrefix(request.URL.Path, "/backup/") {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		calls++
		_ = json.NewEncoder(writer).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"accepted":true,"replacements":[]}`}}})
	})
	snapshot := map[string]any{"textModel": "missing::unavailable", "textFallbackModel": "backup::backup-text", "channels": []any{map[string]any{"id": "backup", "enabled": true, "models": []any{"backup-text"}, "interfaceType": "chat-completion", "apiKey": "synthetic-backup-key", "baseUrl": server.URL + "/backup", "modelProfiles": []any{map[string]any{"model": "backup-text", "protocol": "claude-api", "capability": "text"}}}}}
	raw, _ := json.Marshal(snapshot)
	if err := service.SaveLocalModelConfig(raw); err != nil {
		t.Fatal(err)
	}
	task := preflightTaskFixture(t, service, database, server, "legacy-fallback")
	if err := service.preflightVideoPrompt(context.Background(), task); err != nil || calls != 1 {
		t.Fatalf("legacy fallback calls=%d err=%v", calls, err)
	}
	repair, err := service.videoPromptRepairConfig(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	prompt, _, err := service.editVideoPromptWithFallback(context.Background(), task, repair, videoPromptEditingData(task.Prompt, nil), nil, "prompt_preflight")
	if err != nil || calls != 2 || prompt != task.Prompt {
		t.Fatalf("saved config fallback calls=%d err=%v", calls, err)
	}
	disabled, err := service.videoPromptRepairConfig(map[string]any{"videoPromptRepair": map[string]any{"enabled": false}})
	if err != nil || disabled != nil {
		t.Fatalf("disabled auto editing reenabled: %v", err)
	}
	noFallback, err := service.videoPromptRepairConfig(map[string]any{"videoPromptRepair": map[string]any{"enabled": true, "fallback": nil}})
	if err != nil || noFallback["fallback"] != nil {
		t.Fatalf("explicit fallback opt-out overridden: %v", err)
	}
}

func TestVideoPromptPreflightFallbackDoesNotRepeatSameCandidateOrEditBindings(t *testing.T) {
	for _, scenario := range []string{"same-model", "invalid-binding", "cancelled-lease"} {
		t.Run(scenario, func(t *testing.T) {
			primaryCalls, fallbackCalls := 0, 0
			var database *gorm.DB
			service, store, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
				if strings.HasPrefix(request.URL.Path, "/backup/") {
					fallbackCalls++
					_ = json.NewEncoder(writer).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"accepted":true,"replacements":[{"original":"图片1","replacement":"图片2"}]}`}}})
					return
				}
				primaryCalls++
				if scenario == "cancelled-lease" {
					_ = database.Model(&model.Task{}).Where("id = ?", "fallback-edge").Update("status", model.TaskStatusCancelled).Error
				}
				writer.WriteHeader(http.StatusServiceUnavailable)
			})
			database = store
			task := fallbackTaskFixture(t, service, database, server, "fallback-edge")
			if scenario == "same-model" {
				plain, _ := service.decryptTaskInputJSON(task.InputJSON)
				var input map[string]any
				_ = json.Unmarshal([]byte(plain), &input)
				repair := input["videoPromptRepair"].(map[string]any)
				repair["fallback"] = map[string]any{"config": repair["config"]}
				if err := service.protectTaskSecrets(input); err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(input)
				task.InputJSON = string(raw)
				if err := database.Model(task).Update("input_json", task.InputJSON).Error; err != nil {
					t.Fatal(err)
				}
			}
			original := task.Prompt
			err := service.preflightVideoPrompt(context.Background(), task)
			wantFallback := 0
			if scenario == "invalid-binding" {
				wantFallback = 2
			}
			if err == nil || primaryCalls != 1 || fallbackCalls != wantFallback || task.Prompt != original {
				t.Fatalf("calls=%d/%d err=%v", primaryCalls, fallbackCalls, err)
			}
		})
	}
}

func TestVideoPromptPreflightFallbackDoesNotOverrideSuccessRefusalOrCancellation(t *testing.T) {
	for _, scenario := range []string{"success", "refusal", "cancelled", "moderation", "all-failed"} {
		t.Run(scenario, func(t *testing.T) {
			primaryCalls, fallbackCalls := 0, 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			service, database, server := preflightFixture(t, func(writer http.ResponseWriter, request *http.Request) {
				if strings.HasPrefix(request.URL.Path, "/backup/") {
					fallbackCalls++
					writer.WriteHeader(http.StatusBadGateway)
					return
				}
				primaryCalls++
				if scenario == "cancelled" {
					cancel()
					return
				}
				if scenario == "all-failed" {
					writer.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				if scenario == "moderation" {
					writer.WriteHeader(http.StatusBadRequest)
					_, _ = writer.Write([]byte(`{"error":{"code":"content_policy_violation","message":"content policy violation"}}`))
					return
				}
				content := `{"accepted":true,"replacements":[]}`
				if scenario == "refusal" {
					content = `{"accepted":false,"replacements":[]}`
				}
				_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}}}})
			})
			task := fallbackTaskFixture(t, service, database, server, "fallback-"+scenario)
			original := task.Prompt
			err := service.preflightVideoPrompt(ctx, task)
			if scenario == "success" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("failure falsely reported as success")
			}
			if scenario == "cancelled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("lost cancellation: %v", err)
			}
			wantFallback := 0
			if scenario == "all-failed" {
				wantFallback = 1
				var upstream generation.HTTPError
				if !errors.As(err, &upstream) || upstream.StatusCode != http.StatusServiceUnavailable {
					t.Fatalf("upstream diagnostic cause lost: %v", err)
				}
				if !strings.Contains(err.Error(), "兜底") {
					t.Fatalf("missing fallback reason: %v", err)
				}
			}
			if primaryCalls != 1 || fallbackCalls != wantFallback || task.Prompt != original {
				t.Fatalf("unexpected calls=%d/%d err=%v", primaryCalls, fallbackCalls, err)
			}
		})
	}
}
