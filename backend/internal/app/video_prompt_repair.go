package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/taskruntime"
)

var videoReferenceToken = regexp.MustCompile(`@?[[]asset:[^]]+[]]|@?(?:图片|视频|音频|image|video|audio)[[:space:]]*[0-9]+`)
var errVideoPromptRepairRejected = errors.New("无法在保留资产绑定的前提下完成合规改写，请人工检查提示词与参考素材")

func videoPromptRepairEligible(task *model.Task, cause error) bool {
	if task == nil || cause == nil || task.CreationSubmissionID != nil || (task.Type != "canvas_video" && !strings.HasPrefix(task.Type, "video_")) {
		return false
	}
	failure := generation.ClassifyError(cause)
	if failure.Uncertain || (failure.Category != generation.CategoryModerationInput && failure.Category != generation.CategoryModerationOutput) {
		return false
	}
	var pending generation.StatePendingError
	var unknown generation.SubmissionUnknownError
	if errors.As(cause, &pending) || errors.As(cause, &unknown) {
		return false
	}
	return task.FailureDiagnostics == nil || task.FailureDiagnostics.ExecutionResult != "completed"
}

func (s *Service) videoPromptRepairConfig(input map[string]any) (map[string]any, error) {
	if repair, ok := input["videoPromptRepair"].(map[string]any); ok {
		if enabled, _ := repair["enabled"].(bool); !enabled {
			return nil, nil
		}
		if _, snapshotted := repair["fallback"]; !snapshotted {
			body, err := s.ReadLocalModelConfig()
			if err != nil {
				repair["fallback"] = map[string]any{"configError": "读取文本兜底配置失败：" + generation.DiagnosticSummary(err.Error())}
				return repair, nil
			}
			var snapshot videoPromptModelSnapshot
			if len(body) > 0 {
				if err := json.Unmarshal(body, &snapshot); err != nil {
					repair["fallback"] = map[string]any{"configError": "文本兜底配置无法解析，请重新保存模型配置"}
					return repair, nil
				}
			}
			if snapshot.TextFallbackModel != "" {
				repair["fallback"] = videoPromptSnapshotCandidate(snapshot, snapshot.TextFallbackModel)
			}
		}
		return repair, nil
	}
	body, err := s.ReadLocalModelConfig()
	if err != nil {
		return nil, err
	}
	var snapshot videoPromptModelSnapshot
	if json.Unmarshal(body, &snapshot) != nil || (snapshot.TextModel == "" && snapshot.TextFallbackModel == "") {
		return nil, errors.New("未配置文本模型，无法自动合规润色；请先设置默认文本模型")
	}
	repair := videoPromptSnapshotCandidate(snapshot, snapshot.TextModel)
	repair["enabled"] = true
	if snapshot.TextFallbackModel != "" && snapshot.TextFallbackModel != snapshot.TextModel {
		repair["fallback"] = videoPromptSnapshotCandidate(snapshot, snapshot.TextFallbackModel)
	}
	return repair, nil
}

func (s *Service) tryRepairVideoPrompt(ctx context.Context, task *model.Task, cause error) (bool, error) {
	if !s.IsLocalMode() || !videoPromptRepairEligible(task, cause) {
		return false, nil
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return false, err
	}
	metadata, _ := input["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		input["metadata"] = metadata
	}
	if metadata["videoPromptRepairAttempt"] != nil {
		return false, nil
	}
	plain, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return false, err
	}
	var plainInput map[string]any
	if err := json.Unmarshal([]byte(plain), &plainInput); err != nil {
		return false, err
	}
	repair, err := s.videoPromptRepairConfig(plainInput)
	if err != nil || repair == nil {
		return false, err
	}
	metadata["videoPromptRepairAttempt"] = 1
	metadata["videoPromptRepairOriginalPrompt"] = task.Prompt
	marked, err := json.Marshal(input)
	if err != nil {
		return false, err
	}
	if err := s.repo.WithContext(ctx).BeginVideoPromptRepair(task, string(marked)); err != nil {
		return false, err
	}
	task.InputJSON = string(marked)
	if err := ctx.Err(); err != nil {
		return false, err
	}
	names := videoPromptProtectedNames(plainInput)
	instruction := "请按系统要求做真正的局部合规编辑。审核原因：" + generation.DiagnosticSummary(cause.Error()) + "\n" + videoPromptEditingData(task.Prompt, names)
	prompt, edits, err := s.editVideoPromptWithFallback(ctx, task, repair, instruction, names, "prompt_repair")
	if err != nil {
		return false, fmt.Errorf("自动合规润色失败：%w", err)
	}
	if len(edits) == 0 {
		return false, errors.New("合规润色未产生必要的局部修改，未重复提交原提示词")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	input["prompt"] = prompt
	metadata["videoPromptRepairParentTaskId"] = task.ID
	metadata["clientOperationId"] = "compliant-video:" + task.ID
	metadata["retryOf"] = task.ID
	delete(metadata, "videoPromptRepairRequestedReason")
	childJSON, err := json.Marshal(input)
	if err != nil {
		return false, err
	}
	child := model.Task{ID: newID(), UserID: task.UserID, ProjectID: task.ProjectID, Type: task.Type, Status: model.TaskStatusQueued, Stage: "合规润色完成，待提交生成", Prompt: prompt, Operation: task.Operation, Provider: task.Provider, Model: task.Model, LogicalModelID: task.LogicalModelID, LogicalModelRevisionID: task.LogicalModelRevisionID, RouteID: task.RouteID, ChannelModelID: task.ChannelModelID, RouteRun: 1, InputJSON: string(childJSON)}
	operationID := "compliant-video:" + task.ID
	child.ClientOperationID = &operationID
	captureTaskFailureDiagnostics(task, cause, "upstream_response")
	task.Error = persistableTaskFailureMessage(cause)
	if err := s.repo.WithContext(ctx).CompleteVideoPromptRepair(task, &child, task.FailureDiagnostics); err != nil {
		return false, err
	}
	_ = s.log(task.UserID, task.ID, "info", "已完成一次合规润色并创建独立重试任务，资产绑定和生成参数未变", child.ID)
	return true, nil
}

func requestedVideoPromptRepair(task *model.Task) (bool, error) {
	var probe struct {
		Metadata map[string]any `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &probe) != nil {
		return false, nil
	}
	reason, _ := probe.Metadata["videoPromptRepairRequestedReason"].(string)
	return reason != "", errors.New(reason)
}

func (s *Service) queueVideoPromptRepair(task *model.Task) (*model.Task, error) {
	if s.IsDraining() {
		return nil, errors.New("软件正在退出，尚未重新提交")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return nil, err
	}
	metadata, _ := input["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		input["metadata"] = metadata
	}
	if metadata["videoPromptRepairAttempt"] != nil {
		failedBeforeSubmission := metadata["videoPromptRepairParentTaskId"] == nil && task.FailureDiagnostics != nil && strings.Contains(task.FailureDiagnostics.Summary, "自动合规润色未提交")
		if !failedBeforeSubmission {
			return nil, BadAuthRequest("本轮已自动合规润色一次；请查看真实审核原因并人工修改，未重复提交原提示词")
		}
		delete(metadata, "videoPromptRepairAttempt")
	}
	metadata["videoPromptRepairRequestedReason"] = task.Error
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	if err := s.repo.QueueVideoPromptRepair(task, string(raw)); err != nil {
		return nil, err
	}
	stored, err := s.repo.TaskForUser(task.UserID, task.ID)
	if err != nil {
		return nil, err
	}
	return taskForOutput(*stored), nil
}

func (s *Service) videoPromptRepairOutcome(ctx context.Context, task *model.Task, cause error, terminal *taskTerminalCoordinator) taskruntime.Outcome {
	repaired, repairErr := s.tryRepairVideoPrompt(ctx, task, cause)
	if repaired {
		return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Applied: true}
	}
	if repairErr != nil {
		cause = fmt.Errorf("%w；自动合规润色未提交：%s", cause, generation.DiagnosticSummary(repairErr.Error()))
	}
	return executionFailureOutcome(terminal, task, cause, false, task.ProviderRequestID != "", false)
}
