package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestProviderTaskRecoveryContextSurvivesClientCancellation(t *testing.T) {
	type contextKey string
	parent, cancelParent := context.WithCancel(context.WithValue(context.Background(), contextKey("trace"), "trace-1"))
	cancelParent()

	recovery, cancelRecovery := providerTaskRecoveryContext(parent)
	defer cancelRecovery()
	if recovery.Err() != nil {
		t.Fatalf("recovery context inherited cancellation: %v", recovery.Err())
	}
	if recovery.Value(contextKey("trace")) != "trace-1" {
		t.Fatal("recovery context did not preserve request values")
	}
	if _, ok := recovery.Deadline(); !ok {
		t.Fatal("recovery context has no bounded deadline")
	}
}

func TestRetryableProtocolMediaDownload(t *testing.T) {
	for _, err := range []error{
		errors.New("net/http: TLS handshake timeout"),
		errors.New("read: connection reset by peer"),
		errors.New("unexpected EOF"),
	} {
		if !retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = false", err)
		}
	}
	for _, err := range []error{context.Canceled, context.DeadlineExceeded, errors.New("HTTP 404")} {
		if retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = true", err)
		}
	}
}

func TestQueryFailedVideoResumesOriginalTaskWithoutSubmittingAgain(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	service, db := newProjectWorkflowV2TestService(t)
	service.dataDir = t.TempDir()
	var requests []string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.Method+" "+request.URL.Path)
		writer.Header().Set("Content-Type", "application/json")
		if request.Method != http.MethodGet {
			t.Error("recovery attempted a new generation")
			http.Error(writer, "no creation allowed", http.StatusBadRequest)
			return
		}
		switch request.URL.Path {
		case "/v1/videos/tasks/original-task":
			if len(requests) == 1 {
				_, _ = writer.Write([]byte(`{"id":"original-task","status":"processing"}`))
			} else {
				_, _ = writer.Write([]byte(`{"id":"original-task","status":"completed","result_urls":["` + server.URL + `/original.mp4"]}`))
			}
		case "/original.mp4":
			writer.Header().Set("Content-Type", "video/mp4")
			_, _ = writer.Write([]byte("original-video"))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	input := jiasuTestInput("sd-2.5-j2-V")
	input.Config.BaseURL, input.Config.APIKey = server.URL, "synthetic-recovery-key"
	inputJSON, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var protectedInput map[string]any
	if err := json.Unmarshal(inputJSON, &protectedInput); err != nil {
		t.Fatal(err)
	}
	if err := service.protectTaskSecrets(protectedInput); err != nil {
		t.Fatal(err)
	}
	inputJSON, _ = json.Marshal(protectedInput)
	completedAt := time.Now()
	task := model.Task{ID: newID(), UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusFailed, ProviderRequestID: "original-task", InputJSON: string(inputJSON), Error: "poll interrupted", CompletedAt: &completedAt}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.QueryFailedVideoTask(context.Background(), "other-user", task.ID); err == nil {
		t.Fatal("foreign task query allowed")
	}
	result, err := service.QueryFailedVideoTask(context.Background(), task.UserID, task.ID)
	if err != nil || result.Recovered || result.Task.Status != model.TaskStatusRunning || result.Task.ProviderRequestID != "original-task" {
		t.Fatalf("pending recovery = %#v, error = %v", result, err)
	}
	claimed, err := service.repo.ClaimNextTask("recovery-worker", time.Minute)
	if err != nil || claimed == nil || claimed.InputJSON != task.InputJSON {
		t.Fatalf("original input was not retained: %#v, %v", claimed, err)
	}
	ctx := withProviderAnalytics(context.Background(), nil, *claimed)
	video, err := runVideoTaskForTest(ctx, input)
	if err != nil || video["video"] == nil {
		t.Fatalf("original result retrieval failed: %#v, %v", video, err)
	}
	if got := strings.Join(requests, "|"); got != "GET /v1/videos/tasks/original-task|GET /v1/videos/tasks/original-task|GET /original.mp4" {
		t.Fatalf("recovery requests = %s", got)
	}
}
