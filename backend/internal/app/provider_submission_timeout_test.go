package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
)

func TestTaskExecutionErrorPreservesEarlyRequestDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()
	err := taskExecutionError(ctx, "canvas_video", context.DeadlineExceeded)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("early request deadline was replaced by generation timeout: %v", err)
	}
}

func TestTaskExecutionErrorReportsExpiredExecutionDeadline(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	err := taskExecutionError(ctx, "canvas_video", context.DeadlineExceeded)
	if err.Error() != taskTimeoutMessage("canvas_video") {
		t.Fatalf("execution deadline error = %v", err)
	}
}

func TestProviderConnectionFailureRemainsUnsubmitted(t *testing.T) {
	err := providerTransportError{Cause: context.DeadlineExceeded, Kind: "create", Capability: "video", Phase: "tls"}
	failure := classifyTaskFailure(err)
	if failure.Category != generation.CategoryNetwork || failure.Uncertain || !strings.Contains(failure.UserMessage(), "尚未发送") || !strings.Contains(failure.UserMessage(), "TLS") {
		t.Fatalf("connection failure lost submission phase: %#v", failure)
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if !errors.As(taskExecutionError(ctx, "canvas_video", err), &err) {
		t.Fatal("execution deadline erased the connection failure")
	}
}

func TestProviderCreateResponseTimeoutRemainsUnconfirmed(t *testing.T) {
	err := providerTransportError{Cause: context.DeadlineExceeded, Kind: "create", Capability: "video", Phase: "response", MayHaveSubmitted: true}
	failure := classifyTaskFailure(err)
	if failure.Category != generation.CategorySubmissionUncertain || !failure.Uncertain || !failure.BlocksAutomaticRetry() || strings.Contains(failure.UserMessage(), "后台仍在生成") {
		t.Fatalf("unacknowledged submission was misclassified: %#v", failure)
	}
}

func TestCallLogPreservesConnectionFailureWithoutHTTPResponse(t *testing.T) {
	err := providerTransportError{Cause: context.DeadlineExceeded, Kind: "create", Capability: "video", Phase: "connect"}
	code, message := providerRequestErrorDetails(err)
	callLog := &model.ApiCallLog{Status: model.ApiCallStatusFailed, StatusCode: 0, ErrorCode: code, Error: message}
	(&Service{}).EnrichAPICallLog(callLog, nil)
	if callLog.ErrorCode != string(generation.CategoryNetwork) || !strings.Contains(callLog.Error, "尚未发送") {
		t.Fatalf("connection diagnostics were erased: %#v", callLog)
	}
}

func TestVideoSubmissionTLSDeadlineNeverSendsRequest(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	accepted := make(chan struct{})
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		close(accepted)
		<-ctx.Done()
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+listener.Addr().String()+"/v1/videos", strings.NewReader(`{"model":"test-video"}`))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{RequestKind: "create", Capability: "video"}))
	_, _, err = doBinary(req)
	select {
	case <-accepted:
	default:
		t.Fatal("local TLS connection was never attempted")
	}
	var transport providerTransportError
	if !errors.As(err, &transport) || transport.Phase != "tls" || transport.MayHaveSubmitted {
		t.Fatalf("TLS failure was mistaken for a submitted task: %v", err)
	}
	if strings.Contains(taskExecutionError(ctx, "canvas_video", err).Error(), "生成等待超时") {
		t.Fatal("TLS connection deadline was mistaken for video generation timeout")
	}
}

func TestVideoSubmissionResponseDeadlineDoesNotRetryPOST(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var submissions atomic.Int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		submissions.Add(1)
		<-release
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/videos", strings.NewReader(`{"model":"test-video"}`))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{RequestKind: "create", Capability: "video"}))
	_, _, err = doBinary(req)
	var transport providerTransportError
	if !errors.As(err, &transport) || transport.Phase != "response" || !transport.MayHaveSubmitted || submissions.Load() != 1 {
		t.Fatalf("unacknowledged POST phase or attempt count is wrong: %v, attempts=%d", err, submissions.Load())
	}
	if failure := classifyTaskFailure(err); failure.Category != generation.CategorySubmissionUncertain || !failure.BlocksAutomaticRetry() {
		t.Fatalf("unacknowledged POST may be resubmitted: %#v", failure)
	}
}

func TestProviderSubmissionFailurePersistsThroughTaskOutput(t *testing.T) {
	for _, phase := range []string{"tls", "response"} {
		t.Run(phase, func(t *testing.T) {
			service, database := newTimelineTaskTestService(t)
			task := &model.Task{ID: "submission-phase-task", UserID: "submission-test-user", Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: `{}`}
			if createErr := database.Create(task).Error; createErr != nil {
				t.Fatal(createErr)
			}
			err := providerTransportError{Cause: context.DeadlineExceeded, Kind: "create", Capability: "video", Phase: phase, MayHaveSubmitted: phase == "response"}
			expected := classifyTaskFailure(err)
			_ = service.terminalCoordinator().handleExecutionFailure(task, err, false, false)
			var stored model.Task
			if queryErr := database.First(&stored, "id = ?", task.ID).Error; queryErr != nil {
				t.Fatal(queryErr)
			}
			output := taskSummaryForOutput(stored)
			if output.Error != expected.UserMessage() || output.ErrorCode != expected.ErrorCode() {
				t.Fatalf("persisted output lost request phase: %#v, expected %#v", output, expected)
			}
		})
	}
}
