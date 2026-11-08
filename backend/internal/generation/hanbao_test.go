package generation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

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
}

type mockHanbao struct {
	events  *[]string
	submits int
	queries int
	ref     hanbao.TaskRef
	state   map[string]any
	err     error
}

func (m *mockHanbao) Acquire() (func(), error) {
	*m.events = append(*m.events, "acquire")
	return func() { *m.events = append(*m.events, "release") }, nil
}
func (m *mockHanbao) Submit(_ context.Context, request hanbao.VideoRequest) (hanbao.TaskRef, error) {
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
