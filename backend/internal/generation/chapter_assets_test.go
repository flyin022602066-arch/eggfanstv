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

	"infinite-canvas/backend/internal/prompts"
)

type chapterAssetsPromptPort struct{}

func (chapterAssetsPromptPort) Compile(string, string, map[string]string) (string, error) {
	return "提取第四章资产，历史写实，系统表现模式 panel，完整保留角色、场景、道具。", nil
}

func (chapterAssetsPromptPort) ValidateResult(operation string, result map[string]any) error {
	return prompts.ValidatePromptTemplateResult(operation, result)
}

const chapterAssetsComplete = `{"characters":[{"name":"林夏","aliases":[],"role":"主角","appearance":"短发","clothing":"白衬衫","physique":"纤细","personality":"冷静","props":"小夜灯","consistencyPrompt":"保持短发和白衬衫","multiViewPrompt":"独立头像与身体三视图","voiceLanguage":"中文","voiceAge":"青年","voiceTimbre":"清亮"}],"scenes":[{"name":"旧屋","description":"旧屋内景","prompt":"旧屋全景"}],"props":[{"name":"小夜灯","description":"暖色灯","prompt":"小夜灯特写"}]}`

func TestChapterAssetsKeepsValidatedContentAfterReadDisconnect(t *testing.T) {
	cut := strings.Index(chapterAssetsComplete, "身体三视图")
	for _, declarative := range []bool{false, true} {
		for _, continueFirst := range []bool{false, true} {
			t.Run(boolString(declarative)+"/"+boolString(continueFirst), func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					requests++
					content := chapterAssetsComplete
					disconnect := true
					if continueFirst && requests == 1 {
						content = chapterAssetsComplete[:cut]
						disconnect = false
					} else if continueFirst {
						content = chapterAssetsContinuationAnchor(chapterAssetsComplete[:cut]) + chapterAssetsComplete[cut:]
					}
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": content}}}})
					body := "data: " + string(chunk) + "\n\n"
					writer.Header().Set("Content-Type", "text/event-stream")
					if disconnect {
						writer.Header().Set("Content-Length", strconv.Itoa(len(body)+128))
					}
					_, _ = io.WriteString(writer, body)
				}))
				defer server.Close()
				ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
					runtime.Prompt = chapterAssetsPromptPort{}
					runtime.Call.TaskType = "canvas_text"
				}))
				if declarative {
					ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
				}
				stream := true
				result, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &stream}, Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}})
				wantRequests := 1
				if continueFirst {
					wantRequests = 2
				}
				if err != nil || stringField(result, "text") != chapterAssetsComplete || requests != wantRequests {
					t.Fatalf("validated assets lost after read disconnect: error=%v requests=%d result=%#v", err, requests, result)
				}
			})
		}
	}
}

func TestChapterAssetsNeverAcceptsExplicitFailureOrCancellation(t *testing.T) {
	for _, declarative := range []bool{false, true} {
		for _, scenario := range []string{"rejection", "cancel"} {
			t.Run(boolString(declarative)+"/"+scenario, func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					requests++
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": chapterAssetsComplete}}}})
					body := "data: " + string(chunk) + "\n\n"
					if scenario == "rejection" {
						body += "event: error\ndata: {\"error\":{\"message\":\"explicit upstream rejection\"}}\n\n"
					}
					writer.Header().Set("Content-Type", "text/event-stream")
					writer.Header().Set("Content-Length", strconv.Itoa(len(body)+128))
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
				stream := true
				_, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &stream}, Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}, OnTextDelta: func(string) {
					if scenario == "cancel" {
						cancel()
					}
				}})
				if err == nil || requests != 1 {
					t.Fatalf("explicit failure must not succeed or create another request: error=%v requests=%d", err, requests)
				}
				var payloadError PayloadError
				if scenario == "rejection" && !errors.As(err, &payloadError) {
					t.Fatalf("explicit rejection was replaced by a transport error: %v", err)
				}
			})
		}
	}
}

func TestChapterAssetsContentFilterStopsWithoutContinuation(t *testing.T) {
	for _, declarative := range []bool{false, true} {
		for _, complete := range []bool{false, true} {
			t.Run(boolString(declarative)+"/"+boolString(complete), func(t *testing.T) {
				t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests++
					content := chapterAssetsComplete
					if !complete {
						content = content[:strings.Index(content, "身体三视图")]
					}
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": content}}}})
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = io.WriteString(w, "data: "+string(chunk)+"\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"content_filter\"}]}\n\ndata: [DONE]\n\n")
				}))
				defer server.Close()
				ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
					runtime.Prompt = chapterAssetsPromptPort{}
					runtime.Call.TaskType = "canvas_text"
				}))
				if declarative {
					ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
				}
				stream := true
				_, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &stream}, Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}})
				if err == nil || !ClassifyError(err).IsModeration() || requests != 1 {
					t.Fatalf("content filter must report moderation without continuation: err=%v requests=%d", err, requests)
				}
			})
		}
	}
}

func TestChapterAssetsRepairsRawLineWrapsWithoutAnotherRequest(t *testing.T) {
	complete := strings.Replace(chapterAssetsComplete, "旧屋全景", `旧屋全景\n保留\"轮廓\"与\\路径`, 1)
	wrapped := strings.Replace(complete, "林夏", "林\n夏", 1)
	wrapped = strings.Replace(wrapped, `"props":[`, "\"\nprops\":[", 1)
	wrapped = strings.Replace(wrapped, "旧屋内景", "旧屋\r\n内景", 1)
	wrapped = strings.Replace(wrapped, "小夜灯特写", "小夜灯\t特写", 1)
	for _, declarative := range []bool{false, true} {
		t.Run(boolString(declarative), func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requests++
				writer.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "```json\n" + wrapped + "\n```"}}}})
			}))
			defer server.Close()
			ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
				runtime.Prompt = chapterAssetsPromptPort{}
			}))
			if declarative {
				ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
			}
			var original strings.Builder
			result, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}, OnTextDelta: func(delta string) { original.WriteString(delta) }})
			if err != nil || strings.TrimSpace(chapterAssetsUnfenced(stringField(result, "text"))) != complete || requests != 1 {
				t.Fatalf("line wraps must be repaired locally without regeneration: error=%v requests=%d result=%#v", err, requests, result)
			}
			if !strings.Contains(original.String(), "林\n夏") {
				t.Fatal("the original received text must remain available in the task draft")
			}
		})
	}
}

func TestChapterAssetsContinuesExactlyOnceBeforeReturningCompleteAssets(t *testing.T) {
	cut := strings.Index(chapterAssetsComplete, "身体三视图")
	partial, suffix := chapterAssetsComplete[:cut], chapterAssetsComplete[cut:]
	for _, declarative := range []bool{false, true} {
		for _, streamFirst := range []bool{false, true} {
			for _, fencedContinuation := range []bool{false, true} {
				t.Run(strings.Join([]string{boolString(declarative), boolString(streamFirst), boolString(fencedContinuation)}, "/"), func(t *testing.T) {
					t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
					var requests []map[string]any
					server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
						if request.URL.Path != "/v1/chat/completions" || request.Header.Get("Authorization") != "Bearer offline-key" {
							t.Errorf("continuation changed the endpoint or credentials: %s", request.URL.Path)
						}
						var body map[string]any
						_ = json.NewDecoder(request.Body).Decode(&body)
						requests = append(requests, body)
						text := partial
						if len(requests) == 2 {
							text = chapterAssetsContinuationAnchor(partial) + suffix
							if fencedContinuation {
								text = "```json\n" + text + "\n```"
							}
						}
						if streamFirst {
							writer.Header().Set("Content-Type", "text/event-stream")
							if len(requests) == 1 {
								text = "```json\n" + text
							}
							chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": text}}}})
							_, _ = writer.Write(append(append([]byte("data: "), chunk...), []byte("\n\n")...))
							return
						}
						writer.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": text}}}})
					}))
					defer server.Close()
					var received strings.Builder
					var stages []string
					ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
						runtime.Prompt = chapterAssetsPromptPort{}
						runtime.Call.TaskType = "canvas_text"
						runtime.Stages = chapterAssetsStages{onStage: func(stage string) { stages = append(stages, stage) }}
					}))
					if declarative {
						ctx = WithProtocolRegistry(ctx, LoadOfficialFallbackRegistry())
						if _, ok := DeclarativeProtocolAdapterForContext(ctx, "chat-completion"); !ok {
							t.Fatal("the installed chat-completion plugin must be exercised")
						}
					}
					result, err := Execute(ctx, Input{
						Mode: "text", Prompt: "placeholder", TextOptions: TextOptions{Stream: &streamFirst},
						Config:      Config{BaseURL: server.URL, APIKey: "offline-key", Model: "original-text-model", InterfaceType: "chat-completion", SystemPrompt: "保留原配置"},
						Metadata:    map[string]any{"promptTemplateOperation": "chapter_assets_extract"},
						OnTextDelta: func(delta string) { received.WriteString(delta) },
					})
					if err != nil || strings.TrimSpace(stringField(result, "text")) != chapterAssetsComplete || len(requests) != 2 {
						t.Fatalf("result=%#v error=%v requests=%d", result, err, len(requests))
					}
					if requests[0]["model"] != "original-text-model" || requests[1]["model"] != requests[0]["model"] || requests[1]["stream"] != requests[0]["stream"] {
						t.Fatal("continuation must keep the original model and streaming setting")
					}
					messages := requests[1]["messages"].([]any)
					if len(messages) != 4 || messages[2].(map[string]any)["role"] != "assistant" || messages[2].(map[string]any)["content"] != partial || !strings.Contains(messages[1].(map[string]any)["content"].(string), "系统表现模式 panel") {
						t.Fatalf("continuation lost the original task or exact partial output: %#v", messages)
					}
					if len(stages) != 1 || !strings.Contains(stages[0], "1/1") || !strings.Contains(received.String(), "林夏") || !strings.Contains(received.String(), "小夜灯特写") {
						t.Fatalf("continuation must be observable and preserve the received output: stages=%v", stages)
					}
				})
			}
		}
	}
}

type chapterAssetsStages struct{ onStage func(string) }

func (stage chapterAssetsStages) SetStage(_ context.Context, value string) error {
	stage.onStage(value)
	return nil
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func TestChapterAssetsNeverReturnsPartialAssetsOrRetriesWholeGeneration(t *testing.T) {
	for _, scenario := range []string{"complete", "still-truncated", "invalid-fields", "continuation-error", "wrong-boundary"} {
		t.Run(scenario, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requests++
				text := `{"characters":[{"name":"林`
				switch scenario {
				case "complete":
					text = chapterAssetsComplete
				case "invalid-fields":
					text = `{"characters":[],"scenes":[],"props":[{"name":"灯"}]}`
				case "still-truncated":
					if requests == 2 {
						text = chapterAssetsContinuationAnchor(text) + `夏","aliases":[]`
					}
				case "wrong-boundary":
					if requests == 2 {
						text = strings.Replace(chapterAssetsComplete, "林夏", "新角色", 1)
					}
				case "continuation-error":
					if requests == 2 {
						writer.WriteHeader(http.StatusServiceUnavailable)
						_, _ = io.WriteString(writer, `{"error":{"message":"offline upstream unavailable"}}`)
						return
					}
				}
				writer.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": text}}}})
			}))
			defer server.Close()
			ctx := WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
				runtime.Prompt = chapterAssetsPromptPort{}
			}))
			result, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}})
			if scenario == "complete" {
				if err != nil || requests != 1 || result["text"] != chapterAssetsComplete {
					t.Fatalf("complete result must use one request: err=%v requests=%d", err, requests)
				}
				return
			}
			if err == nil {
				t.Fatal("incomplete assets must never be returned as a successful result")
			}
			if scenario == "invalid-fields" {
				if requests != 1 {
					t.Fatalf("schema errors must not trigger a continuation: %d", requests)
				}
			} else if requests != 2 || !strings.Contains(err.Error(), "续接一次") {
				t.Fatalf("truncation must stop after exactly one continuation: err=%v requests=%d", err, requests)
			}
			if scenario != "invalid-fields" && !strings.Contains(ClassifyError(err).UserMessage(), "续接一次") {
				t.Fatalf("the displayed failure must explain the continuation attempt: %v", ClassifyError(err))
			}
		})
	}
}

func TestChapterAssetsContinuationPreservesWhitespaceInsideStrings(t *testing.T) {
	partial := `{"characters":[],"scenes":[],"props":[{"name":"灯","description":"old `
	suffix := ` room","prompt":"暖色灯"}]}`
	if got, err := joinChapterAssetsContinuation(chapterAssetsUnfenced("```json\n"+partial), chapterAssetsContinuationAnchor(partial)+suffix); err != nil || got != partial+suffix {
		t.Fatalf("continuation changed existing string whitespace: %q", got)
	}
}

func TestChapterAssetsRejectsAmbiguousContinuationBoundaries(t *testing.T) {
	partial := `{"characters":[{"name":"苏`
	for _, suffix := range []string{`苏夜","aliases":[]}]}`, chapterAssetsComplete} {
		if _, err := joinChapterAssetsContinuation(partial, suffix); err == nil {
			t.Fatal("an unverified repeated fragment or a rewritten result must not be merged")
		}
	}
}

func TestChapterAssetsContinuationPreservesTextThroughInstalledPlugin(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	complete := strings.Replace(chapterAssetsComplete, "旧屋内景", "old   room", 1)
	cut := strings.Index(complete, "   room") + 2
	partial, suffix := complete[:cut], complete[cut:]
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		text := partial
		if requests == 2 {
			messages := body["messages"].([]any)
			if got := messages[len(messages)-2].(map[string]any)["content"]; got != partial {
				t.Errorf("continuation history changed the last received characters: %#v", got)
			}
			text = chapterAssetsContinuationAnchor(partial) + suffix
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": text}}}})
	}))
	defer server.Close()
	ctx := WithProtocolRegistry(WithRuntime(context.Background(), taskRuntime(func(runtime *Runtime) {
		runtime.Prompt = chapterAssetsPromptPort{}
	})), LoadOfficialFallbackRegistry())
	result, err := Execute(ctx, Input{Mode: "text", Prompt: "placeholder", Config: Config{BaseURL: server.URL, APIKey: "offline", Model: "original-model", InterfaceType: "chat-completion"}, Metadata: map[string]any{"promptTemplateOperation": "chapter_assets_extract"}})
	if err != nil || stringField(result, "text") != complete || requests != 2 {
		t.Fatalf("continuation must preserve text exactly: result=%#v error=%v requests=%d", result, err, requests)
	}
}

func TestChapterAssetsDoesNotContinueAnExplicitRejection(t *testing.T) {
	for _, err := range []error{
		HTTPError{StatusCode: http.StatusInternalServerError, Body: "upstream rejected"},
		NewRawPayloadError(`{"error":{"message":"upstream rejected"}}`),
		context.Canceled,
	} {
		if chapterAssetsMayContinue(err) {
			t.Fatalf("an explicit rejection or cancellation must not create a continuation: %v", err)
		}
	}
	if !chapterAssetsMayContinue(errors.New("unexpected EOF")) {
		t.Fatal("a connection interruption may be continued after an incomplete result")
	}
}
