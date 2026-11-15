package generation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestChapterAssetsSecondRoundCompletesWithoutRestartingExtraction(t *testing.T) {
	firstCut := strings.Index(chapterAssetsComplete, "旧屋全景")
	secondCut := strings.Index(chapterAssetsComplete, "小夜灯特写")
	for _, declarative := range []bool{false, true} {
		for _, wrongBoundary := range []bool{false, true} {
			t.Run(boolString(declarative)+"/"+boolString(wrongBoundary), func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				var requests []map[string]any
				partial := chapterAssetsComplete[:firstCut]
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					requests = append(requests, body)
					content := partial
					switch len(requests) {
					case 2:
						content = chapterAssetsContinuationAnchor(partial) + chapterAssetsComplete[firstCut:secondCut]
						if wrongBoundary {
							content = strings.Replace(chapterAssetsComplete, "林夏", "错误角色", 1)
						}
					case 3:
						cut := secondCut
						if wrongBoundary {
							cut = firstCut
						}
						messages := body["messages"].([]any)
						if len(messages) != 4 || messages[2].(map[string]any)["content"] != chapterAssetsComplete[:cut] {
							t.Errorf("second round must reuse the verified prefix, not restart or accept a rewritten character: %#v", messages)
						}
						content = chapterAssetsContinuationAnchor(chapterAssetsComplete[:cut]) + chapterAssetsComplete[cut:]
					default:
						if len(requests) > 3 {
							t.Error("recovery must not make unbounded paid requests")
						}
					}
					writer.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": content}}}})
				}))
				defer server.Close()
				var stages []string
				var received strings.Builder
				ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
					runtime.Prompt = chapterAssetsPromptPort{}
					runtime.Stages = chapterAssetsStages{onStage: func(stage string) { stages = append(stages, stage) }}
				}))
				if declarative {
					ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
				}
				result, err := Execute(ctx, Input{
					Mode: "text", Prompt: "placeholder",
					Config:      Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion", SystemPrompt: "保留原配置"},
					Metadata:    map[string]any{"promptTemplateOperation": "chapter_assets_extract"},
					OnTextDelta: func(delta string) { received.WriteString(delta) },
				})
				if err != nil || stringField(result, "text") != chapterAssetsComplete || len(requests) != 3 {
					t.Fatalf("second round must complete and validate the same asset extraction: result=%#v err=%v requests=%d", result, err, len(requests))
				}
				if len(stages) != 2 || !strings.Contains(stages[1], "二轮补充") || !strings.Contains(stages[1], "2/2") {
					t.Fatalf("both recovery stages must be visible: %v", stages)
				}
				if !strings.Contains(received.String(), "林夏") || !strings.Contains(received.String(), "小夜灯特写") {
					t.Fatal("received text must remain available throughout recovery")
				}
				for _, body := range requests {
					if body["model"] != "original-model" {
						t.Fatal("recovery must not switch channels or models")
					}
				}
			})
		}
	}
}

func TestChapterAssetsSecondRoundStopsSafelyAndRetainsReceivedText(t *testing.T) {
	for _, declarative := range []bool{false, true} {
		for _, scenario := range []string{"complete-after-disconnect", "still-truncated", "wrong-boundary", "http-rejection", "content-filter", "cancel"} {
			t.Run(boolString(declarative)+"/"+scenario, func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				cut := strings.Index(chapterAssetsComplete, "小夜灯特写")
				partial := chapterAssetsComplete[:cut]
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					requests++
					content := partial
					if requests == 2 {
						content = chapterAssetsContinuationAnchor(partial)
					}
					if requests >= 3 {
						content = chapterAssetsContinuationAnchor(partial) + chapterAssetsComplete[cut:]
						switch scenario {
						case "still-truncated":
							content = chapterAssetsContinuationAnchor(partial) + "小夜"
						case "wrong-boundary":
							content = strings.Replace(chapterAssetsComplete, "林夏", "错误角色", 1)
						case "http-rejection":
							writer.WriteHeader(http.StatusUnauthorized)
							_, _ = io.WriteString(writer, `{"error":{"message":"invalid api key"}}`)
							return
						}
					}
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": content}}}})
					body := "data: " + string(chunk) + "\n\n"
					if requests >= 3 && scenario == "content-filter" {
						body += "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"content_filter\"}]}\n\n"
					}
					writer.Header().Set("Content-Type", "text/event-stream")
					if requests >= 3 && scenario == "complete-after-disconnect" {
						writer.Header().Set("Content-Length", strconv.Itoa(len(body)+128))
					} else {
						body += "data: [DONE]\n\n"
					}
					_, _ = io.WriteString(writer, body)
				}))
				defer server.Close()
				ctx, cancel := context.WithCancel(WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
					runtime.Prompt = chapterAssetsPromptPort{}
					runtime.Call.TaskType = "canvas_text"
				})))
				defer cancel()
				if declarative {
					ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
				}
				var received strings.Builder
				stream := true
				result, err := Execute(ctx, Input{
					Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &stream},
					Config:   Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"},
					Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"},
					OnTextDelta: func(delta string) {
						received.WriteString(delta)
						if scenario == "cancel" && requests == 2 {
							cancel()
						}
					},
				})
				if scenario == "complete-after-disconnect" {
					if err != nil || requests != 3 || stringField(result, "text") != chapterAssetsComplete {
						t.Fatalf("a fully validated result must survive a final read interruption: err=%v requests=%d", err, requests)
					}
					return
				}
				if err == nil || !strings.Contains(received.String(), "林夏") {
					t.Fatalf("failed recovery must retain text without succeeding: err=%v requests=%d", err, requests)
				}
				if scenario == "cancel" {
					if requests != 2 || !errors.Is(err, context.Canceled) {
						t.Fatalf("cancellation must prevent a second paid recovery: err=%v requests=%d", err, requests)
					}
					return
				}
				if requests != 3 || !strings.Contains(ClassifyError(err).UserMessage(), "二轮补充") {
					t.Fatalf("stop after both recovery attempts and report them: err=%v requests=%d", err, requests)
				}
				if scenario == "content-filter" && !ClassifyError(err).IsModeration() {
					t.Fatalf("moderation must not be masked as a truncation: %v", err)
				}
				if scenario == "wrong-boundary" && stringField(result, "text") != partial {
					t.Fatal("an unverified rewritten result must never replace the known prefix")
				}
				data, marshalErr := json.Marshal(result)
				if marshalErr != nil || !strings.Contains(string(data), "receivedTexts") {
					t.Fatalf("all received attempts must remain serializable for diagnostics: %s, %v", data, marshalErr)
				}
			})
		}
	}
}
