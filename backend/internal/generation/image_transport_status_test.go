package generation

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type imageStatusStages struct{ values []string }

func (stages *imageStatusStages) SetStage(_ context.Context, value string) error {
	stages.values = append(stages.values, value)
	return nil
}

func TestImageTransportReportsWaitingReceivingAndProcessing(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"data":[`)
		writer.(http.Flusher).Flush()
		_, _ = io.WriteString(writer, `{"b64_json":"offline"}]}`)
	}))
	defer server.Close()
	for _, taskType := range []string{"canvas_image", "canvas_video"} {
		stages := &imageStatusStages{}
		ctx := WithRuntime(context.Background(), Runtime{Stages: stages, Call: CallMeta{TaskType: taskType}})
		request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/images/generations", strings.NewReader(`{}`))
		if _, _, err := DoBinary(request); err != nil {
			t.Fatal(err)
		}
		text := strings.Join(stages.values, ";")
		if taskType == "canvas_image" && (!strings.Contains(text, "等待上游") || !strings.Contains(text, "正在接收") || !strings.Contains(text, "接收完成")) {
			t.Fatalf("missing image transfer stages: %q", text)
		}
		if taskType == "canvas_video" && text != "" {
			t.Fatalf("image stages polluted video: %q", text)
		}
	}
}
