package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

type videoPromptModelSnapshot struct {
	TextModel         string           `json:"textModel"`
	TextFallbackModel string           `json:"textFallbackModel"`
	Channels          []map[string]any `json:"channels"`
}

type videoPromptTextFailure struct {
	label string
	cause error
}

func (failure videoPromptTextFailure) Error() string {
	return failure.label + "调用失败：" + generation.DiagnosticSummary(failure.cause.Error())
}

func (failure videoPromptTextFailure) Unwrap() error { return failure.cause }

func videoPromptSnapshotCandidate(snapshot videoPromptModelSnapshot, selection string) map[string]any {
	candidate := map[string]any{"modelSelection": selection}
	channelID, modelName, found := strings.Cut(selection, "::")
	if !found || channelID == "" || modelName == "" {
		candidate["configError"] = "文本模型缺少渠道身份，请重新选择文本模型"
		return candidate
	}
	for _, channel := range snapshot.Channels {
		if channel["id"] != channelID {
			continue
		}
		if enabled, ok := channel["enabled"].(bool); ok && !enabled {
			break
		}
		if models, ok := channel["models"].([]any); ok {
			available := false
			for _, name := range models {
				available = available || name == modelName
			}
			if !available {
				candidate["configError"] = "所选文本模型已不在渠道目录中，请重新选择"
				return candidate
			}
		}
		protocol, _ := channel["interfaceType"].(string)
		if profiles, ok := channel["modelProfiles"].([]any); ok {
			for _, raw := range profiles {
				profile, _ := raw.(map[string]any)
				if profile["model"] != modelName {
					continue
				}
				if value, _ := profile["protocol"].(string); value != "" {
					protocol = value
				}
				if capability, _ := profile["capability"].(string); capability != "" && capability != "text" {
					candidate["configError"] = "所选模型不是文本模型"
					return candidate
				}
				if logicalID, _ := profile["logicalModelId"].(string); logicalID != "" {
					candidate["logicalModelId"] = logicalID
				}
			}
		}
		config := map[string]any{"model": modelName, "interfaceType": protocol, "count": "1"}
		for _, key := range []string{"apiFormat", "baseUrl", "apiKey", "secretKey", "headers", "credentialRef"} {
			if value, ok := channel[key]; ok {
				config[key] = value
			}
		}
		candidate["config"] = config
		return candidate
	}
	candidate["configError"] = "所选文本模型渠道不可用，请在模型配置中重新选择"
	return candidate
}

func (s *Service) videoPromptTextRequest(task *model.Task, candidate map[string]any) (generation.Input, error) {
	var request generation.Input
	if message, _ := candidate["configError"].(string); message != "" {
		return request, errors.New(message)
	}
	config, ok := candidate["config"].(map[string]any)
	logicalID, _ := candidate["logicalModelId"].(string)
	modelName, _ := config["model"].(string)
	if !ok || (strings.TrimSpace(modelName) == "" && logicalID == "") {
		return request, errors.New("未配置可用文本模型")
	}
	textInput, err := s.resolveManagedBeefAPISecrets(map[string]any{"mode": "text", "config": config})
	if err != nil {
		return request, err
	}
	selected, err := (taskCatalogAdapter{s}).Select(task.UserID, localtask.SelectRequest{Input: textInput, LogicalModelID: logicalID, Type: "canvas_text", Operation: "text"})
	if err != nil {
		return request, err
	}
	raw, err := json.Marshal(selected.Input)
	if err != nil {
		return request, err
	}
	if err := json.Unmarshal(raw, &request); err != nil {
		return request, err
	}
	request.Mode, request.Config.SystemPrompt = "text", videoPromptPreflightInstruction
	if err := generation.ValidateGenerationInterfaceWithRegistry(s.protocolRegistry(), "text", request.Config.InterfaceType); err != nil {
		return request, err
	}
	request.TextOptions.Stream = new(bool)
	return request, nil
}

func videoPromptTextCanFallback(ctx context.Context, err error) bool {
	if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, errVideoPromptRepairRejected) {
		return false
	}
	switch generation.ClassifyError(err).Category {
	case generation.CategoryCancelled, generation.CategoryModerationInput, generation.CategoryModerationReference, generation.CategoryModerationOutput:
		return false
	}
	return true
}

func (s *Service) editVideoPromptWithFallback(ctx context.Context, task *model.Task, repair map[string]any, instruction string, names []string, kind string) (string, []videoPromptReplacement, error) {
	candidates := []map[string]any{repair}
	if fallback, ok := repair["fallback"].(map[string]any); ok {
		primaryID, _ := repair["modelSelection"].(string)
		fallbackID, _ := fallback["modelSelection"].(string)
		primaryConfig, _ := json.Marshal(repair["config"])
		fallbackConfig, _ := json.Marshal(fallback["config"])
		if !(primaryID != "" && primaryID == fallbackID) && !(repair["config"] != nil && string(primaryConfig) == string(fallbackConfig)) {
			candidates = append(candidates, fallback)
		}
	}
	textCtx := s.videoPromptEditingContext(ctx, task, kind)
	var failures []error
	for index, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return "", nil, err
		}
		label := "主文本模型"
		if index > 0 {
			label = "兜底文本模型"
			stage := "主文本模型调用失败，正在使用兜底文本模型（视频尚未提交）"
			if kind == "prompt_repair" {
				stage = "主文本模型调用失败，正在使用兜底文本模型合规润色（视频尚未重新提交）"
			}
			if err := s.repo.WithContext(ctx).UpdateTaskStageForLease(task.ID, task.LeaseOwner, stage); err != nil {
				return "", nil, err
			}
			task.Stage = stage
			_ = s.log(task.UserID, task.ID, "info", stage, "")
		}
		request, err := s.videoPromptTextRequest(task, candidate)
		if err == nil {
			request.Prompt = instruction
			for attempt := 0; attempt < 2; attempt++ {
				result, callErr := generation.Execute(textCtx, request)
				if ctx.Err() != nil {
					return "", nil, ctx.Err()
				}
				if callErr != nil {
					err = callErr
					break
				}
				response, _ := result["text"].(string)
				prompt, edits, parseErr := parseVideoPromptPreflight(task.Prompt, response, names)
				if parseErr == nil {
					return prompt, edits, nil
				}
				if errors.Is(parseErr, errVideoPromptRepairRejected) {
					return "", nil, parseErr
				}
				if attempt == 1 {
					err = parseErr
					break
				}
				_ = s.log(task.UserID, task.ID, "info", "合规改写格式或引用校验未通过，正在请求文本模型纠正；尚未重新提交视频", "")
				request.Prompt += "\n上一次编辑结果未通过校验：" + parseErr.Error() + "。只从editableFragments选择精确局部片段，不编辑只读引用、名称或数字，不输出全文。只输出系统要求的JSON。"
			}
		}
		if !videoPromptTextCanFallback(ctx, err) {
			return "", nil, err
		}
		failures = append(failures, videoPromptTextFailure{label: label, cause: err})
		_ = s.log(task.UserID, task.ID, "warn", failures[len(failures)-1].Error(), "")
	}
	return "", nil, errors.Join(failures...)
}
