package generation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTextContentFilterPreservesUpstreamEvidence(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		t.Run(boolString(streaming), func(t *testing.T) {
			payload := map[string]any{
				"request_id": "req_asset_filter_123",
				"choices": []any{map[string]any{
					"message":       map[string]any{"content": "private chapter text"},
					"finish_reason": "content_filter",
				}},
			}
			var err error
			if streaming {
				parser := NewStreamingAgentParser("chat-completion", nil)
				parser.Consume("text/event-stream", []byte("data: {\"request_id\":\"req_asset_filter_123\",\"choices\":[{\"delta\":{\"content\":\"private chapter text\"}}]}\n\n"))
				delete(payload, "request_id")
				encoded, _ := json.Marshal(payload)
				parser.Consume("text/event-stream", []byte("data: "+string(encoded)+"\n\n"))
				_, err = parser.Result()
			} else {
				err = ValidateTextPayload(payload)
			}
			if err == nil {
				t.Fatal("an upstream content filter must remain a failure")
			}
			failure := ClassifyError(err)
			if failure.Category != CategoryModerationOutput || failure.RequestID != "req_asset_filter_123" || failure.ProviderCode != "content_filter" {
				t.Fatalf("upstream evidence lost or misclassified: %+v", failure)
			}
			if !strings.Contains(failure.UserMessage(), "上游") || !strings.Contains(failure.UserMessage(), "content_filter") || failure.Retryable {
				t.Fatalf("failure must explain the upstream finish reason without automatic retries: %+v", failure)
			}
			persisted := ClassifyText(failure.UserMessage())
			if persisted.UserMessage() != failure.UserMessage() || persisted.Category != failure.Category {
				t.Fatalf("persisted failure lost its explanation: %+v", persisted)
			}
			var payloadErr PayloadError
			if !errors.As(err, &payloadErr) || strings.Contains(payloadErr.Raw(), "private chapter text") {
				t.Fatal("diagnostics must contain only error metadata, not chapter text")
			}
		})
	}
}

func TestChapterAssetsDoesNotLocallyFilterSuccessfulContent(t *testing.T) {
	complete := strings.Replace(chapterAssetsComplete, "旧屋内景", strings.Repeat("小说中的敏感信息、审核、content_filter 只是剧情文字。", 1000), 1)
	for _, declarative := range []bool{false, true} {
		for _, streaming := range []bool{false, true} {
			t.Run(boolString(declarative)+"/"+boolString(streaming), func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					requests++
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if _, limited := body["max_tokens"]; limited {
						t.Error("asset extraction must not add an unsolicited output token limit")
					}
					choice := map[string]any{"message": map[string]any{"content": complete}, "finish_reason": "stop"}
					if streaming {
						choice = map[string]any{"delta": map[string]any{"content": complete}, "finish_reason": "stop"}
					}
					encoded, _ := json.Marshal(map[string]any{"choices": []any{choice}})
					if streaming {
						writer.Header().Set("Content-Type", "text/event-stream")
						_, _ = io.WriteString(writer, "data: "+string(encoded)+"\n\ndata: [DONE]\n\n")
					} else {
						writer.Header().Set("Content-Type", "application/json")
						_, _ = writer.Write(encoded)
					}
				}))
				defer server.Close()
				ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
					runtime.Prompt = chapterAssetsPromptPort{}
					runtime.Call.TaskType = "canvas_text"
				}))
				if declarative {
					ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
				}
				result, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &streaming}, Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "text-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}})
				if err != nil || stringField(result, "text") != complete || requests != 1 {
					t.Fatalf("successful long assets must be accepted unchanged: error=%v requests=%d", err, requests)
				}
			})
		}
	}
}
