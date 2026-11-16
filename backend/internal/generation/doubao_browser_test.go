package generation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"infinite-canvas/backend/internal/provider/doubaobrowser"
)

type mockBrowser struct {
	events   *[]string
	request  doubaobrowser.Request
	submits  int
	receipt  doubaobrowser.Receipt
	state    doubaobrowser.Result
	queryErr error
}

func (m *mockBrowser) Submit(_ context.Context, user string, input doubaobrowser.Request) (doubaobrowser.Receipt, error) {
	if user != "fixture-owner" {
		return doubaobrowser.Receipt{}, errors.New("owner mismatch")
	}
	m.submits++
	m.request = input
	*m.events = append(*m.events, "submit")
	return m.receipt, nil
}
func (m *mockBrowser) Query(_ context.Context, user string, receipt doubaobrowser.Receipt) (doubaobrowser.Result, error) {
	if user != "fixture-owner" || receipt != m.receipt {
		return doubaobrowser.Result{}, errors.New("identity mismatch")
	}
	*m.events = append(*m.events, "query")
	return m.state, m.queryErr
}
func TestDoubaoBrowserSavesReceiptBeforeQueryAndResumesWithoutSubmission(t *testing.T) {
	events := []string{}
	stages := []string{}
	port := &mockBrowser{events: &events, receipt: doubaobrowser.Receipt{TaskID: "fixture-task", ProfileID: "550e8400-e29b-41d4-a716-446655440000"}, queryErr: errors.New("fixture unavailable")}
	recorder := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{DoubaoBrowser: port, LocalVideoReceipts: recorder, Stages: stageRecorder{events: &stages}, Call: CallMeta{UserID: "fixture-owner", TaskID: "fixture-task"}})
	input := Input{Mode: "video", Prompt: "fixture", Config: Config{InterfaceType: doubaobrowser.Protocol, Model: "seedance_v2.0_std", VideoSeconds: "12", Size: "9:16"}}
	if err := validatePreparedInput(ctx, input); err != nil {
		t.Fatal("browser task incorrectly requires API Key:", err)
	}
	_, err := RunVideoTaskWithPolicy(ctx, input, VideoPollPolicy{Sleep: func(context.Context, time.Duration) error { return nil }})
	var pending StatePendingError
	if !errors.As(err, &pending) || pending.TaskID != recorder.id {
		t.Fatalf("pending receipt missing: %v", err)
	}
	if !reflect.DeepEqual(events, []string{"ready", "submit", "save", "query"}) {
		t.Fatal(events)
	}
	if port.request.Model != "seedance_v2.0_std" || port.request.Duration != 12 || port.request.Ratio != "9:16" || port.request.TaskID != "fixture-task" {
		t.Fatalf("parameter loss: %+v", port.request)
	}
	if len(stages) == 0 || stages[0] != "正在准备豆包浏览器独立环境并提交生成" {
		t.Fatalf("submission stage still claims a reserve gate: %v", stages)
	}
	ctx = WithCallMeta(ctx, CallMeta{UserID: "fixture-owner", TaskID: "fixture-task", ProviderRequestID: recorder.id})
	_, _ = RunDoubaoBrowserVideoTask(ctx, input, VideoPollPolicy{})
	if port.submits != 1 {
		t.Fatal("recovery submitted another generation")
	}
}

func TestDoubaoBrowserOriginalTaskDownloadAndIdentity(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("fixture-video"))
	}))
	defer server.Close()
	events := []string{}
	port := &mockBrowser{events: &events, receipt: doubaobrowser.Receipt{TaskID: "fixture-task", ProfileID: "550e8400-e29b-41d4-a716-446655440000"}, state: doubaobrowser.Result{Status: "success", VideoURL: server.URL + "/video.mp4"}}
	ctx := WithRuntime(context.Background(), Runtime{DoubaoBrowser: port, Call: CallMeta{UserID: "fixture-owner", TaskID: "fixture-task"}})
	result, status, err := QueryDoubaoBrowserVideoResult(ctx, EncodeDoubaoBrowserTask(port.receipt), VideoPollPolicy{})
	if err != nil || status != "success" || result["video"].(map[string]any)["dataUrl"] != DataURL("video/mp4", []byte("fixture-video")) {
		t.Fatalf("result=%v status=%s error=%v", result, status, err)
	}
	ctx = WithCallMeta(ctx, CallMeta{UserID: "fixture-owner", TaskID: "foreign-task"})
	if _, _, err := QueryDoubaoBrowserVideoResult(ctx, EncodeDoubaoBrowserTask(port.receipt), VideoPollPolicy{}); err == nil {
		t.Fatal("foreign task receipt accepted")
	}
	if IsSeedanceVideoConfig(Config{InterfaceType: doubaobrowser.Protocol, Model: "seedance_v2.5"}) {
		t.Fatal("browser task entered remote Seedance path")
	}
}

func TestDoubaoBrowserFailureRetainsUpstreamCode(t *testing.T) {
	events := []string{}
	port := &mockBrowser{events: &events, receipt: doubaobrowser.Receipt{TaskID: "fixture-task", ProfileID: "550e8400-e29b-41d4-a716-446655440000"}, state: doubaobrowser.Result{Status: "failed", Reason: "上游画布任务生成失败（业务码 3）"}}
	ctx := WithRuntime(context.Background(), Runtime{DoubaoBrowser: port, Call: CallMeta{UserID: "fixture-owner", TaskID: "fixture-task"}})
	_, status, err := QueryDoubaoBrowserVideoResult(ctx, EncodeDoubaoBrowserTask(port.receipt), VideoPollPolicy{})
	if status != "failed" || err == nil || err.Error() != "豆包浏览器："+port.state.Reason {
		t.Fatalf("status=%s error=%v", status, err)
	}
}

func TestDoubaoBrowserProgressDistinguishesPreparationAndUncertainty(t *testing.T) {
	for _, scenario := range []struct{ status, stage string }{
		{"preparing", "浏览器正在准备画布和参考图，尚未提交生成"},
		{"submission_pending", "提交状态待确认，保留原环境自动核对"},
		{"running", "上游正在生成视频，自动查询原任务"},
	} {
		t.Run(scenario.status, func(t *testing.T) {
			events, stages := []string{}, []string{}
			port := &mockBrowser{events: &events, receipt: doubaobrowser.Receipt{TaskID: "fixture-task", ProfileID: "550e8400-e29b-41d4-a716-446655440000"}, state: doubaobrowser.Result{Status: scenario.status}}
			ctx := WithRuntime(context.Background(), Runtime{DoubaoBrowser: port, Stages: stageRecorder{events: &stages}, Call: CallMeta{UserID: "fixture-owner", TaskID: "fixture-task"}})
			result, status, err := QueryDoubaoBrowserVideoResult(ctx, EncodeDoubaoBrowserTask(port.receipt), VideoPollPolicy{})
			if err != nil || result != nil || status != scenario.status || !reflect.DeepEqual(stages, []string{scenario.stage}) || port.submits != 0 {
				t.Fatalf("incorrect original-task progress: result=%v status=%s stages=%v submits=%d error=%v", result, status, stages, port.submits, err)
			}
		})
	}
}
