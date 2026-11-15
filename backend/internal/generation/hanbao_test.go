package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/hanbao"
)

func TestHanbaoResumeDownloadsCompletedVideoWithoutSubmitting(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	video := []byte("fixture-video-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write(video)
	}))
	defer server.Close()
	events := []string{}
	ref := hanbao.TaskRef{SubmitID: "cv:a:b:original", Account: "actual-account"}
	m := &mockHanbao{events: &events, ref: ref, state: map[string]any{"gen_status": "success", "video_url": server.URL + "/video.mp4"}}
	r := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{Hanbao: m, LocalVideoReceipts: r})
	ctx = WithCallMeta(ctx, CallMeta{ProviderRequestID: EncodeHanbaoTask(ref)})
	result, err := RunHanbaoVideoTask(ctx, Input{Mode: "video", Config: Config{InterfaceType: hanbao.Protocol}}, VideoPollPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	output, ok := result["video"].(map[string]any)
	if !ok || output["dataUrl"] != DataURL("video/mp4", video) || m.submits != 0 || m.queries != 1 {
		t.Fatalf("result=%v submits=%d queries=%d", result, m.submits, m.queries)
	}
	result, status, err := QueryHanbaoVideoResult(ctx, EncodeHanbaoTask(ref), VideoPollPolicy{})
	if err != nil || status != "success" || result["video"].(map[string]any)["dataUrl"] != DataURL("video/mp4", video) || m.submits != 0 || m.queries != 2 {
		t.Fatalf("manual retrieval did not recover original video: %v %s %v", result, status, err)
	}
}

func TestHanbaoFailedResultKeepsUpstreamReason(t *testing.T) {
	events := []string{}
	port := &mockHanbao{events: &events, ref: hanbao.TaskRef{SubmitID: "cv:fixture", Account: "actual"}, state: map[string]any{"gen_status": "failed", "code": "3", "error": "上游审核未通过"}}
	receipt := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{Hanbao: port, LocalVideoReceipts: receipt})
	_, err := RunHanbaoVideoTask(ctx, Input{Mode: "video", Prompt: "fixture", Config: Config{Model: "seedance_v2.5", VideoSeconds: "30"}}, VideoPollPolicy{})
	var failure *hanbao.CallError
	if !errors.As(err, &failure) || failure.Source != "upstream_response" || failure.Code != "3" || !strings.Contains(err.Error(), "上游审核未通过") {
		t.Fatalf("upstream failure lost: %v", err)
	}
	if port.submits != 1 || port.queries != 1 {
		t.Fatalf("unexpected resend: %+v", port)
	}
}

type mockHanbao struct {
	events  *[]string
	submits int
	queries int
	ref     hanbao.TaskRef
	state   map[string]any
	err     error
	states  []map[string]any
	request hanbao.VideoRequest
	cancel  context.CancelFunc
}

func (m *mockHanbao) Acquire() (func(), error) {
	*m.events = append(*m.events, "acquire")
	return func() { *m.events = append(*m.events, "release") }, nil
}
func (m *mockHanbao) Submit(_ context.Context, request hanbao.VideoRequest) (hanbao.TaskRef, error) {
	m.request = request
	if m.cancel != nil {
		m.cancel()
	}
	m.submits++
	*m.events = append(*m.events, "submit")
	return m.ref, m.err
}
func (m *mockHanbao) Query(_ context.Context, ref hanbao.TaskRef) (map[string]any, error) {
	m.queries++
	*m.events = append(*m.events, "query")
	if ref != m.ref {
		return nil, errors.New("lost rotated account or opaque token")
	}
	if len(m.states) > 0 {
		return m.states[min(m.queries-1, len(m.states)-1)], nil
	}
	return m.state, nil
}

type mockHanbaoReceipt struct {
	events    *[]string
	id        string
	failReady bool
	failSave  bool
}

func (r *mockHanbaoReceipt) Ready(context.Context) error {
	*r.events = append(*r.events, "ready")
	if r.failReady {
		return errors.New("missing local task")
	}
	return nil
}
func (r *mockHanbaoReceipt) RecordAccepted(_ context.Context, id string) error {
	*r.events = append(*r.events, "save")
	r.id = id
	if r.failSave {
		return errors.New("disk failure")
	}
	return nil
}
func TestHanbaoPersistsActualAccountBeforePollAndResumesWithoutSubmit(t *testing.T) {
	events := []string{}
	ref := hanbao.TaskRef{SubmitID: "cv:workspace:conversation:item:opaque", Account: "轮换账号2"}
	m := &mockHanbao{events: &events, ref: ref, state: map[string]any{"query_error": map[string]any{"temporary": true}}}
	r := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{Hanbao: m, LocalVideoReceipts: r})
	input := Input{Mode: "video", Prompt: "fixture", Config: Config{InterfaceType: hanbao.Protocol, Model: "seedance_v2.5", VideoSeconds: "30", Size: "9:16"}}
	policy := VideoPollPolicy{Sleep: func(context.Context, time.Duration) error { return nil }}
	_, err := RunHanbaoVideoTask(ctx, input, policy)
	var pending StatePendingError
	if !errors.As(err, &pending) || pending.TaskID != r.id {
		t.Fatalf("pending=%v id=%q", err, r.id)
	}
	decoded, err := DecodeHanbaoTask(r.id)
	if err != nil || decoded != ref {
		t.Fatalf("round trip=%+v %v", decoded, err)
	}
	if !reflect.DeepEqual(events, []string{"ready", "acquire", "submit", "save", "query", "release"}) {
		t.Fatal(events)
	}
	m.state = map[string]any{"gen_status": "fail"}
	ctx = WithCallMeta(ctx, CallMeta{ProviderRequestID: r.id})
	_, err = RunHanbaoVideoTask(ctx, input, policy)
	if err == nil || m.submits != 1 || m.queries != 2 {
		t.Fatalf("resume submitted again: %v %+v", err, m)
	}
}

func TestHanbaoRejectsBeforeDispatchAndFencesUncertainSubmission(t *testing.T) {
	for _, scenario := range []string{"missing-context", "receipt-failure", "unknown-submit"} {
		t.Run(scenario, func(t *testing.T) {
			events := []string{}
			m := &mockHanbao{events: &events, ref: hanbao.TaskRef{SubmitID: "cv:a:b:c", Account: "actual"}}
			r := &mockHanbaoReceipt{events: &events, failReady: scenario == "missing-context", failSave: scenario == "receipt-failure"}
			if scenario == "unknown-submit" {
				m.err = hanbao.UncertainError{Reason: "timeout"}
			}
			ctx := WithRuntime(context.Background(), Runtime{Hanbao: m, LocalVideoReceipts: r})
			_, err := RunHanbaoVideoTask(ctx, Input{Mode: "video", Prompt: "fixture", Config: Config{Model: "seedance_v2.5"}}, VideoPollPolicy{})
			var unknown SubmissionUnknownError
			if scenario == "missing-context" {
				if err == nil || m.submits != 0 {
					t.Fatal(err)
				}
			} else if !errors.As(err, &unknown) || m.submits != 1 || m.queries != 0 {
				t.Fatal(err, m)
			}
		})
	}
	if IsSeedanceVideoConfig(Config{InterfaceType: hanbao.Protocol, Model: "seedance_v2.5"}) {
		t.Fatal("local CLI routed into Ark media uploader")
	}
}

func TestHanbaoManualQueryUsesOriginalReceiptOnly(t *testing.T) {
	for _, status := range []string{"running", "success", "failed", "query-error"} {
		t.Run(status, func(t *testing.T) {
			events := []string{}
			ref := hanbao.TaskRef{SubmitID: "cv:workspace:conversation:item", Account: "actual"}
			port := &mockHanbao{events: &events, ref: ref, state: map[string]any{"gen_status": status}}
			if status == "query-error" {
				port.state["query_error"] = "temporarily unavailable"
			}
			ctx := WithRuntime(context.Background(), Runtime{Hanbao: port})
			result, observed, err := QueryHanbaoVideoResult(ctx, EncodeHanbaoTask(ref), VideoPollPolicy{})
			if port.submits != 0 || port.queries != 1 || !reflect.DeepEqual(events, []string{"acquire", "query", "release"}) {
				t.Fatalf("query dispatched or lost lock: %+v %v", port, events)
			}
			if result != nil || observed != status {
				t.Fatalf("unexpected result: %v %s", result, observed)
			}
			if status == "running" || status == "success" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("failure or temporarily unreachable state lost")
			}
		})
	}
}

func TestHanbaoExplicitFailureCorrectsOnlyProvenUncertainTasks(t *testing.T) {
	reason := "憨包text2video：画布连续 1 次生成失败（生成失败，请重试）：这条先跳过，可稍后重试或换个账号"
	message := ClassifyText(reason).UserMessage()
	if ClassifyText(message).UserMessage() != message {
		t.Fatal("persisted failure duplicated advice")
	}
	for _, scenario := range []string{"confirmed", "generic", "accepted", "other-provider", "running"} {
		task := model.Task{Status: model.TaskStatusFailed, Model: "hanbao::seedance_v2.5", Stage: "submission_unknown", Error: "提交结果尚未确认", FailureDiagnostics: &model.TaskFailureDiagnostics{Source: "local_runtime", Summary: reason, ExecutionResult: "pending"}}
		switch scenario {
		case "generic":
			task.FailureDiagnostics.Summary = "组件异常"
		case "accepted":
			task.ProviderRequestID = "hanbao:original"
		case "other-provider":
			task.Model = "other::seedance"
		case "running":
			task.Status = model.TaskStatusRunning
		}
		updated := NormalizeHanbaoTaskFailure(task)
		if scenario == "confirmed" {
			if updated.Stage == "submission_unknown" || updated.FailureDiagnostics.Source != "upstream_response" || updated.FailureDiagnostics.ExecutionResult != "failed" || ClassifyText(updated.Error).BlocksAutomaticRetry() {
				t.Fatalf("known failure still uncertain: %+v", updated)
			}
			if task.FailureDiagnostics.ExecutionResult != "pending" {
				t.Fatal("normalization mutated original diagnostics")
			}
		} else if !reflect.DeepEqual(updated, task) {
			t.Fatalf("changed unproven task %s", scenario)
		}
	}
}

func TestHanbaoDispatchDoesNotCaptureRemoteModelsWithTheSameName(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	remoteCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		remoteCalls++
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer fixture-remote-key" {
			t.Error("remote provider lost its method or credential")
		}
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusBadRequest)
		_, _ = response.Write([]byte(`{"error":{"message":"fixture rejection"}}`))
	}))
	defer server.Close()
	events := []string{}
	port := &mockHanbao{events: &events, err: errors.New("fixture local stop")}
	receipt := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{Hanbao: port, LocalVideoReceipts: receipt})
	for _, protocol := range []string{"newapi", hanbao.Protocol, "newapi"} {
		beforeRemote, beforeSubmits, beforeEvents := remoteCalls, port.submits, len(events)
		_, err := RunVideoTaskWithPolicy(ctx, Input{Mode: "video", Prompt: "fixture", Config: Config{InterfaceType: protocol, Model: "seedance_v2.5", BaseURL: server.URL, APIKey: "fixture-remote-key", Size: "16:9", VideoSeconds: "5"}}, VideoPollPolicy{})
		if err == nil {
			t.Fatal("fixture rejection was not returned")
		}
		if protocol == hanbao.Protocol {
			if remoteCalls != beforeRemote || port.submits != beforeSubmits+1 {
				t.Fatal("Hanbao called the remote provider")
			}
		} else if remoteCalls != beforeRemote+1 || port.submits != beforeSubmits || len(events) != beforeEvents {
			t.Fatalf("remote provider called Hanbao: remote=%d local=%d events=%v", remoteCalls, port.submits, events)
		}
	}
}

func TestHanbaoStagesFollowOriginalTaskThroughQueueGenerationAndDownload(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "video/mp4")
		_, _ = response.Write([]byte("fixture video"))
	}))
	defer server.Close()
	events, stages := []string{}, []string{}
	ref := hanbao.TaskRef{SubmitID: "cv:original", Account: "actual"}
	port := &mockHanbao{events: &events, ref: ref, states: []map[string]any{
		{"gen_status": "in_queue"},
		{"gen_status": "running"},
		{"gen_status": "success", "video_url": server.URL + "/video.mp4"},
	}}
	receipt := &mockHanbaoReceipt{events: &events}
	ctx := WithRuntime(context.Background(), Runtime{Hanbao: port, LocalVideoReceipts: receipt, Stages: stageRecorder{events: &stages}})
	result, err := RunHanbaoVideoTask(ctx, Input{Mode: "video", Prompt: "fixture", Config: Config{Model: "seedance_v2.0", VideoSeconds: "15"}}, VideoPollPolicy{Sleep: func(context.Context, time.Duration) error { return nil }})
	if err != nil || result == nil || port.submits != 1 || port.queries != 3 || receipt.id != EncodeHanbaoTask(ref) {
		t.Fatalf("original task not retrieved: result=%v error=%v port=%+v", result, err, port)
	}
	joined := strings.Join(stages, "\n")
	for _, expected := range []string{"正在提交憨包生成任务", "已提交，等待查询上游状态", "已提交，正在查询上游状态", "上游排队中", "上游生成中", "正在取回生成结果", "视频已取回，正在保存"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("missing stage %q in %v", expected, stages)
		}
	}
}

func TestHanbaoQueryStagesDoNotInventGenerationOrHideUncertainty(t *testing.T) {
	for _, scenario := range []struct {
		name, expected string
		state          map[string]any
	}{
		{"queued", "上游排队中", map[string]any{"gen_status": "in_queue"}},
		{"running", "上游生成中", map[string]any{"gen_status": "running"}},
		{"unknown", "上游状态未确认，继续查询原任务", map[string]any{"gen_status": "unknown"}},
		{"query-error", "查询暂不可用，稍后继续查询原任务", map[string]any{"gen_status": "running", "query_error": true}},
		{"component-wait-limit", "本地组件查询等待超时，上游结果未确认", map[string]any{"gen_status": "failed", "fail_reason": "超过 45 分钟仍无结果，已判定失败：请重新生成（建议换一个有视频能力的账号）"}},
		{"missing-url", "上游已报成功，等待视频链接", map[string]any{"gen_status": "success"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			events, stages := []string{}, []string{}
			ref := hanbao.TaskRef{SubmitID: "cv:original", Account: "actual"}
			port := &mockHanbao{events: &events, ref: ref, state: scenario.state}
			ctx := WithRuntime(context.Background(), Runtime{Hanbao: port, Stages: stageRecorder{events: &stages}})
			_, _, err := QueryHanbaoVideoResult(ctx, EncodeHanbaoTask(ref), VideoPollPolicy{})
			if scenario.name == "component-wait-limit" {
				var pending StatePendingError
				var failure *hanbao.CallError
				if !errors.As(err, &pending) || !errors.As(err, &failure) || failure.Source != "local_runtime" {
					t.Fatalf("component query age limit was treated as upstream failure: %v", err)
				}
			}
			if port.submits != 0 || port.queries != 1 || len(stages) < 2 || !strings.Contains(stages[len(stages)-1], scenario.expected) {
				t.Fatalf("untruthful stage: %v submits=%d queries=%d", stages, port.submits, port.queries)
			}
		})
	}
}

func TestHanbaoLostStageLeasePreventsSubmissionAndQuery(t *testing.T) {
	for _, resumed := range []bool{false, true} {
		events, stages := []string{}, []string{}
		port := &mockHanbao{events: &events, err: errors.New("fixture submit stop")}
		ctx := WithRuntime(context.Background(), Runtime{Hanbao: port, LocalVideoReceipts: &mockHanbaoReceipt{events: &events}, Stages: stageRecorder{events: &stages, err: errors.New("lost lease")}})
		if resumed {
			ctx = WithCallMeta(ctx, CallMeta{ProviderRequestID: EncodeHanbaoTask(hanbao.TaskRef{SubmitID: "cv:original", Account: "actual"})})
		}
		_, err := RunHanbaoVideoTask(ctx, Input{Mode: "video", Config: Config{Model: "seedance_v2.0"}}, VideoPollPolicy{})
		if err == nil || port.submits != 0 || port.queries != 0 {
			t.Fatalf("stale worker dispatched: resumed=%v error=%v submits=%d queries=%d", resumed, err, port.submits, port.queries)
		}
	}
}

func TestHanbaoComponentQueryAgeLimitDoesNotClaimUpstreamFailure(t *testing.T) {
	original := &model.TaskFailureDiagnostics{Source: "upstream_response", ExecutionResult: "failed", Summary: "憨包视频结果失败：超过 45 分钟仍无结果，已判定失败：请重新生成（建议换一个有视频能力的账号）"}
	task := model.Task{Status: model.TaskStatusFailed, Model: "hanbao::seedance_v2.0", ProviderRequestID: EncodeHanbaoTask(hanbao.TaskRef{SubmitID: "original", Account: "fixture"}), FailureDiagnostics: original}
	projected := NormalizeHanbaoTaskFailure(task)
	if projected.FailureDiagnostics.Source != "local_runtime" || projected.FailureDiagnostics.ExecutionResult != "pending" || !strings.Contains(projected.Error, "继续查询原任务") || projected.ProviderRequestID != task.ProviderRequestID {
		t.Fatalf("local component age limit remained an upstream failure: %+v", projected)
	}
	if original.Source != "upstream_response" || original.ExecutionResult != "failed" {
		t.Fatal("read projection mutated persisted diagnostic")
	}
	task.Model = "other::seedance_v2.0"
	if NormalizeHanbaoTaskFailure(task).FailureDiagnostics != original {
		t.Fatal("other provider failure was changed")
	}
}

type hanbaoOriginalResources struct {
	ResourcePort
	original []byte
	lookups  int
	opens    int
}

func (p *hanbaoOriginalResources) Lookup(userID, resourceID string) (ResourceInfo, error) {
	p.lookups++
	if userID != "user-1" || !strings.HasPrefix(resourceID, "owned-") {
		return ResourceInfo{}, errors.New("resource not owned")
	}
	return ResourceInfo{UserID: userID, ID: resourceID, Status: "ready", Kind: "image", MimeType: "image/png", Size: int64(len(p.original)), Width: 3840, Height: 2160}, nil
}

func (p *hanbaoOriginalResources) Open(userID, resourceID string) (ResourceInfo, io.ReadCloser, error) {
	resource, err := p.Lookup(userID, resourceID)
	if err != nil {
		return ResourceInfo{}, nil, err
	}
	p.opens++
	return resource, io.NopCloser(bytes.NewReader(p.original)), nil
}

func (p *hanbaoOriginalResources) LocalMode() bool { return true }

func TestHanbaoProjectResourcesReachSubmissionAndResumeUnchanged(t *testing.T) {
	for _, name := range []string{"seedance_v2.0", "seedance-2.5"} {
		t.Run(name, func(t *testing.T) {
			events := []string{}
			ref := hanbao.TaskRef{SubmitID: "cv:original", Account: "actual"}
			port := &mockHanbao{events: &events, ref: ref, state: map[string]any{"gen_status": "running", "query_error": true}}
			receipt := &mockHanbaoReceipt{events: &events}
			resources := &hanbaoOriginalResources{original: append([]byte("original image"), make([]byte, 4<<20)...)}
			runtime := taskRuntime(func(runtime *Runtime) {
				runtime.Hanbao, runtime.LocalVideoReceipts, runtime.Resources = port, receipt, resources
			})
			input := Input{Mode: "video", Prompt: "final user prompt", Config: Config{InterfaceType: hanbao.Protocol, Model: name, VideoSeconds: "30", Size: "16:9"}}
			for _, id := range []string{"owned-1", "owned-2", "owned-3", "owned-4", "owned-5", "owned-6", "owned-7", "owned-8", "owned-9"} {
				input.ReferenceImages = append(input.ReferenceImages, Media{StorageKey: "resource:" + id, URL: "https://expired.example/image.png"})
			}
			ctx, cancel := context.WithCancel(WithRuntime(context.Background(), runtime))
			defer cancel()
			port.cancel = cancel
			_, err := Execute(ctx, input)
			var pending StatePendingError
			if !errors.Is(err, context.Canceled) || port.submits != 1 || resources.opens != 9 || receipt.id != EncodeHanbaoTask(ref) {
				t.Fatalf("project submission failed: %v submits=%d opens=%d receipt=%q", err, port.submits, resources.opens, receipt.id)
			}
			request := port.request
			if request.Prompt != input.Prompt || request.Model != name || request.Duration != 30 || request.Ratio != "16:9" || len(request.Images) != 9 {
				t.Fatalf("submission parameters changed: model=%q duration=%d ratio=%q images=%d", request.Model, request.Duration, request.Ratio, len(request.Images))
			}
			for index, image := range request.Images {
				if !bytes.Equal(image, resources.original) || request.ImageExtensions[index] != ".png" {
					t.Fatalf("reference %d was compressed or changed", index+1)
				}
			}
			runtime.Call.ProviderRequestID, runtime.Resources = receipt.id, nil
			_, err = RunHanbaoVideoTask(WithRuntime(context.Background(), runtime), input, VideoPollPolicy{})
			if !errors.As(err, &pending) || port.submits != 1 || port.queries != 1 {
				t.Fatalf("resume resubmitted or reread media: %v submits=%d queries=%d", err, port.submits, port.queries)
			}
		})
	}
}

func TestHanbaoZeroQueryErrorDoesNotStopPolling(t *testing.T) {
	for _, value := range []any{float64(0), json.Number("0"), false, ""} {
		events := []string{}
		ref := hanbao.TaskRef{SubmitID: "cv:original", Account: "actual"}
		port := &mockHanbao{events: &events, ref: ref, state: map[string]any{"gen_status": "running", "query_error": value}}
		ctx := WithRuntime(context.Background(), Runtime{Hanbao: port})
		_, status, err := QueryHanbaoVideoResult(ctx, EncodeHanbaoTask(ref), VideoPollPolicy{})
		if err != nil || status != "running" || port.queries != 1 || port.submits != 0 {
			t.Fatalf("empty query error blocked polling: value=%v status=%s error=%v", value, status, err)
		}
	}
}
