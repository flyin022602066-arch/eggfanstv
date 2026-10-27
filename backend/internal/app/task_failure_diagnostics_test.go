package app

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

func TestTaskFailureDiagnosticsPreserveLocalConstraint(t *testing.T) {
	task := &model.Task{ID: "task-local", Stage: "校验参考图"}
	captureTaskFailureDiagnostics(task, BadAuthRequest("当前图片模型最多支持 2 张参考图"), "unknown")
	d := taskSummaryForOutput(*task).FailureDiagnostics
	if d == nil || d.Source != "local_validation" || d.Summary != "当前图片模型最多支持 2 张参考图" || d.ProviderCode != "" || d.CapturedAt == "" {
		t.Fatalf("diagnostics = %+v", d)
	}
}

func TestTaskFailureDiagnosticsPreserveHTTPHeaderAndRedact(t *testing.T) {
	task := &model.Task{ID: "task-http", Stage: "正在生成"}
	err := providerHTTPError{StatusCode: 400, RequestID: "req-header-123", Body: `{"error":{"code":"invalid_size","param":"size","message":"size must be 1024x1024; Authorization: Bearer PRIVATE credential"}}`}
	captureTaskFailureDiagnostics(task, err, "unknown")
	d := taskForOutput(*task).FailureDiagnostics
	if d.Source != "upstream_http" || d.HTTPStatus != 400 || d.RequestID != "req-header-123" || d.ProviderCode != "invalid_size" || d.Param != "size" || !strings.Contains(d.Summary, "1024x1024") || strings.Contains(d.Summary, "PRIVATE") {
		t.Fatalf("diagnostics = %+v", d)
	}
	if taskSummaryForOutput(*task).FailureDiagnostics.Summary != d.Summary {
		t.Fatal("detail and summary disagree")
	}
}

func TestTaskTerminalPersistsDiagnosticBeforeReplacingError(t *testing.T) {
	task := &model.Task{ID: "task-terminal", Status: model.TaskStatusRunning, Stage: "素材下载"}
	repo := &taskTerminalRepositoryStub{task: task}
	c := newTaskTerminalCoordinatorForTest(repo, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
	err := errors.New("cannot save /Users/private-name/image.png")
	if got := c.handleExecutionFailure(task, err, true, false); !errors.Is(got, err) {
		t.Fatal(got)
	}
	if task.FailureDiagnostics == nil || task.FailureDiagnostics.Source != "local_result" || strings.Contains(task.FailureDiagnostics.Summary, "private-name") {
		t.Fatalf("diagnostics = %+v", task.FailureDiagnostics)
	}
}

func TestTaskFailureDiagnosticsExposeWrappedUpstreamRejection(t *testing.T) {
	task := &model.Task{ID: "task-rejected", Stage: "正在连接上游", FailureDiagnostics: &model.TaskFailureDiagnostics{Requests: []model.TaskRequestEvidence{{Operation: "submit", Dispatched: true, Outcome: "http_error", HTTPStatus: 503, ProviderCode: "model_not_found", RequestID: "req-upstream-123", Summary: "无可用渠道，请联系站长"}}}}
	err := generation.SubmissionUnknownError{Cause: providerHTTPError{StatusCode: 503, Body: `{"error":{"code":"model_not_found","message":"无可用渠道，请联系站长"}}`}}
	captureTaskFailureDiagnostics(task, err, "unknown")
	d := task.FailureDiagnostics
	if d.Source != "upstream_http" || d.Summary != "无可用渠道，请联系站长" || d.HTTPStatus != 503 || d.ProviderCode != "model_not_found" || d.RequestID != "req-upstream-123" {
		t.Fatalf("upstream rejection was hidden by generic copy: %+v", d)
	}
}

func TestTaskFailureDiagnosticsExposeAsyncProviderReason(t *testing.T) {
	task := &model.Task{ID: "task-async-failed", Stage: "正在查询视频", FailureDiagnostics: &model.TaskFailureDiagnostics{Requests: []model.TaskRequestEvidence{{Operation: "query_or_download", Dispatched: true, Outcome: "business_error", HTTPStatus: 200, ProviderCode: "reference_too_large", Summary: "第 6 个素材超过大小限制"}}}}
	captureTaskFailureDiagnostics(task, errors.New("声明式协议任务失败"), "unknown")
	d := task.FailureDiagnostics
	if d.Source != "upstream_response" || d.Summary != "第 6 个素材超过大小限制" || d.ProviderCode != "reference_too_large" || d.HTTPStatus != 200 {
		t.Fatalf("async provider evidence was lost: %+v", d)
	}
}

func TestTaskFailureDiagnosticsKeepLocalFailureAfterUpstreamResponse(t *testing.T) {
	task := &model.Task{ID: "task-local-save", FailureDiagnostics: &model.TaskFailureDiagnostics{Requests: []model.TaskRequestEvidence{{Dispatched: true, Outcome: "http_error", HTTPStatus: 503, Summary: "previous upstream error"}}}}
	captureTaskFailureDiagnostics(task, errors.New("无法保存视频文件"), "local_result")
	if task.FailureDiagnostics.Source != "local_result" || task.FailureDiagnostics.Summary != "无法保存视频文件" {
		t.Fatalf("local failure was misattributed: %+v", task.FailureDiagnostics)
	}
}
