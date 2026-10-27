package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestJiasuPollRechecksTransientFailedStateWithoutResubmitting(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "1")
	for _, resume := range []bool{false, true} {
		t.Run(fmt.Sprint(resume), func(t *testing.T) {
			creates, polls := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				switch {
				case request.Method == http.MethodPost:
					creates++
					_, _ = writer.Write([]byte(`{"id":"original-task","status":"queued"}`))
				case request.Method == http.MethodGet && request.URL.Path == "/v1/videos/tasks/original-task":
					polls++
					if polls == 1 {
						_, _ = writer.Write([]byte(`{"id":"original-task","status":"failed","error":{"message":"完犊子啦，迷路了，请重新提交"}}`))
					} else if polls == 2 {
						_, _ = writer.Write([]byte(`{"id":"original-task","status":"in_progress"}`))
					} else {
						_ = json.NewEncoder(writer).Encode(map[string]any{"id": "original-task", "status": "completed", "result_urls": []string{DataURL("video/mp4", []byte("test-video"))}})
					}
				default:
					t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
			}))
			defer server.Close()
			registry := LoadOfficialFallbackRegistry()
			adapter, ok := registry.Resolve("jiasu-video")
			if !ok {
				t.Fatal("missing jiasu-video adapter")
			}
			meta := CallMeta{UserID: "owner", TaskID: "local-task"}
			if resume {
				meta.ProviderRequestID = "original-task"
			}
			ctx := WithRuntime(context.Background(), Runtime{Call: meta})
			policy := DefaultVideoPollPolicy()
			policy.Sleep = func(context.Context, time.Duration) error { return nil }
			result, err := RunProtocolAdapterTaskWithPolicy(ctx, Input{Mode: "video", Prompt: "test", Config: Config{BaseURL: server.URL, InterfaceType: "jiasu-video", Model: "sd-2.5-J3-doubao", VideoSeconds: "30", Size: "16:9", VQuality: "720p"}}, adapter, policy)
			wantCreates := 1
			if resume {
				wantCreates = 0
			}
			if err != nil || result == nil || creates != wantCreates || polls != 3 {
				t.Fatalf("result=%v err=%v creates=%d polls=%d", result, err, creates, polls)
			}
		})
	}
}

func TestJiasuPollConfirmsRealFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "1")
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Error("resubmitted a paid generation")
		}
		polls++
		_, _ = writer.Write([]byte(`{"id":"original-task","status":"failed","error":{"message":"provider rejected generation"}}`))
	}))
	defer server.Close()
	adapter, _ := LoadOfficialFallbackRegistry().Resolve("jiasu-video")
	ctx := WithRuntime(context.Background(), Runtime{Call: CallMeta{ProviderRequestID: "original-task"}})
	policy := DefaultVideoPollPolicy()
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	_, err := RunProtocolAdapterTaskWithPolicy(ctx, Input{Mode: "video", Config: Config{BaseURL: server.URL, InterfaceType: "jiasu-video", Model: "sd-2.5-J3-doubao"}}, adapter, policy)
	if err == nil || !strings.Contains(err.Error(), "provider rejected generation") || polls != 3 {
		t.Fatalf("err=%v polls=%d, want confirmed terminal failure", err, polls)
	}
}

func TestCanResumeJiasuVideoPoll(t *testing.T) {
	now := time.Now()
	recent := now.Add(-2 * time.Hour)
	expired := now.Add(-24 * time.Hour)
	for _, test := range []struct {
		name    string
		taskID  string
		started *time.Time
		err     error
		want    bool
	}{
		{name: "waiting deadline", taskID: "original-task", started: &recent, err: context.DeadlineExceeded, want: true},
		{name: "temporary poll failure", taskID: "original-task", started: &recent, err: HTTPError{StatusCode: 503}, want: true},
		{name: "temporary missing task", taskID: "original-task", started: &recent, err: HTTPError{StatusCode: 404}, want: true},
		{name: "download interrupted", taskID: "original-task", started: &recent, err: VideoDownloadError{TaskID: "original-task", Cause: HTTPError{StatusCode: 503}}, want: true},
		{name: "confirmed provider rejection", taskID: "original-task", started: &recent, err: errors.New("provider rejected")},
		{name: "cancelled", taskID: "original-task", started: &recent, err: context.Canceled},
		{name: "expired recovery", taskID: "original-task", started: &expired, err: context.DeadlineExceeded},
		{name: "not submitted", started: &recent, err: context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := CanResumeJiasuVideoPoll(test.taskID, test.started, test.err, now); got != test.want {
				t.Fatalf("CanResumeJiasuVideoPoll()=%v want %v", got, test.want)
			}
		})
	}
}
