package app

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ensureFailedProviderAttemptLogged fills the task-level audit gap only when no
// provider log exists. This normally represents a preflight failure; the coarse
// request/state variants also preserve visibility if primary log persistence failed.
func (s *Service) ensureFailedProviderAttemptLogged(task model.Task, taskErr error) {
	if s == nil || s.repo == nil || strings.TrimSpace(task.ID) == "" || taskErr == nil {
		return
	}
	hasLog, err := s.repo.HasAPICallLogForTask(task.ID)
	if err != nil {
		log.Printf("provider attempt log lookup failed: task_id=%s error=%v", task.ID, err)
		return
	}
	if hasLog {
		return
	}

	metadata := providerAnalyticsContext{
		UserID:            task.UserID,
		TaskID:            task.ID,
		TraceID:           task.TraceID,
		RequestID:         task.RequestID,
		Capability:        capabilityFromTaskType(task.Type),
		Operation:         task.Operation,
		Model:             task.Model,
		ProviderRequestID: task.ProviderRequestID,
	}
	decodedTask := task
	if decrypted, decryptErr := s.decryptTaskInputJSON(task.InputJSON); decryptErr == nil {
		decodedTask.InputJSON = decrypted
		if value, ok := withProviderAnalytics(context.Background(), s, decodedTask).Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok {
			metadata = value
		}
	}

	now := time.Now()
	startedAt := now
	if task.StartedAt != nil && !task.StartedAt.IsZero() {
		startedAt = *task.StartedAt
	}
	path := "/task/provider-preflight"
	errorCode := "request_not_sent"
	statusCode := 0
	var httpErr providerHTTPError
	if errors.As(taskErr, &httpErr) {
		path = "/task/provider-request"
		errorCode = "provider_request_unlogged"
		statusCode = httpErr.StatusCode
	} else if strings.TrimSpace(metadata.ProviderRequestID) != "" {
		path = "/task/provider-state"
		errorCode = "provider_state_unlogged"
	}
	callLog := model.ApiCallLog{
		UserID:            metadata.UserID,
		TraceID:           metadata.TraceID,
		RequestID:         metadata.RequestID,
		ChannelID:         metadata.ChannelID,
		TaskID:            metadata.TaskID,
		Source:            "backend-task",
		Capability:        metadata.Capability,
		Operation:         metadata.Operation,
		RequestKind:       "create",
		APIFormat:         "internal",
		Method:            "INTERNAL",
		Path:              path,
		Model:             metadata.Model,
		Status:            model.ApiCallStatusFailed,
		StatusCode:        statusCode,
		DurationMs:        now.Sub(startedAt).Milliseconds(),
		ProviderRequestID: metadata.ProviderRequestID,
		ErrorCode:         errorCode,
		Error:             truncateRunes(s.UserFacingErrorMessage(taskErr), 2_000),
		StartedAt:         startedAt,
		CreatedAt:         now,
	}
	var avatar eggfansAvatarRequestError
	if errors.As(taskErr, &avatar) {
		callLog.Capability = "asset"
		callLog.Operation = avatar.Operation
		callLog.RequestKind = eggfansAvatarRequestKindPrefix + avatar.Operation
		callLog.APIFormat = "eggfans-avatar"
		callLog.Method = avatar.Method
		callLog.Path = avatar.Path
		callLog.Model = avatar.RoutingModel
		callLog.ProviderRequestID = ""
		callLog.ErrorCode = taskFailureErrorCode(taskErr)
		if errors.As(taskErr, &httpErr) {
			callLog.ResponseBody = SanitizeAPICallPayload([]byte(httpErr.Body), "application/json")
		}
		var input canvasGenerationInput
		if json.Unmarshal([]byte(decodedTask.InputJSON), &input) == nil {
			if upstream, parseErr := url.Parse(input.Config.BaseURL); parseErr == nil && upstream.Host != "" {
				callLog.UpstreamURL = upstream.Scheme + "://" + upstream.Host + avatar.Path
			}
		}
	}
	if err := s.LogAPICall(callLog); err != nil {
		log.Printf("provider attempt log write failed: task_id=%s error=%v", task.ID, err)
	}
}
