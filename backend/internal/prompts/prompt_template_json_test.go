package prompts

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestExtractJSONTextSkipsProseAndMarkdownFence(t *testing.T) {
	raw := "先说明一下，{这不是有效 JSON}。\n```json\n{\"characters\":[{\"name\":\"林夏\",\"aliases\":[]}]}\n```\n"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","aliases":[]}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

func TestExtractJSONTextHandlesBracesInJSONString(t *testing.T) {
	raw := "```json\n{\"characters\":[{\"name\":\"林夏\",\"role\":\"拿着{小夜灯}的租客\"}]}\n```"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","role":"拿着{小夜灯}的租客"}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

const characterCardJSON = `{"name":"林夏","aliases":["夏夏"],"role":"女主角","appearance":"短发","clothing":"白衬衫","physique":"纤细","personality":"冷静","props":"小夜灯","consistencyPrompt":"c","multiViewPrompt":"m","voiceLanguage":"中文","voiceAge":"青年","voiceTimbre":"清亮"}`

func TestChapterAssetsRequiresCompleteRoot(t *testing.T) {
	complete := `{"characters":[` + characterCardJSON + `],"scenes":[{"name":"旧屋","description":"旧屋内景","prompt":"旧屋全景"}],"props":[{"name":"小夜灯","description":"暖色小夜灯","prompt":"小夜灯特写"}]}`
	for _, raw := range []string{complete, "```json\n" + complete + "\n```", characterCardJSON + "\n提取结果：\n" + complete} {
		if err := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": raw}); err != nil {
			t.Fatalf("complete chapter assets rejected: %v", err)
		}
	}
	for _, raw := range []string{
		`{"characters":[` + characterCardJSON + `,{"name":"未写完`,
		`{"characters":[` + characterCardJSON + `],"scenes":[{"name":"旧屋"}],"props":[`,
		characterCardJSON,
		`[` + characterCardJSON + `]`,
	} {
		err := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": raw})
		if err == nil || !strings.Contains(err.Error(), "完整") || strings.Contains(err.Error(), "cannot unmarshal") {
			t.Fatalf("partial root must report incomplete assets instead of decoding a character's props: %v", err)
		}
	}
}

func TestChapterAssetsDistinguishesTruncationFromInvalidJSON(t *testing.T) {
	for _, scenario := range []struct {
		text       string
		incomplete bool
	}{
		{`{`, true},
		{"{ \n\t", true},
		{`{"`, true},
		{`{"charac`, true},
		{`{"scen`, true},
		{`{"pro`, true},
		{`{"characters":[{"name":"林`, true},
		{`{"scenes":[],"characters":[],"props":[`, true},
		{`{"characters":[{"name":"林夏"}]`, true},
		{`{"note":"章节一","characters":[`, true},
		{`{"note":"章节一","scen`, true},
		{`{"characters":[{"name":}]}`, false},
		{`{"characters":[]]`, false},
		{`{"characters":truX`, false},
		{`{"characters":[],"scenes":]`, false},
		{`{"characX`, false},
		{`{"note":"未写完`, false},
		{`[{"characters":[],"scenes":[],"props":[]}`, false},
	} {
		err := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": scenario.text})
		var incomplete IncompleteChapterAssetsError
		if errors.As(err, &incomplete) != scenario.incomplete {
			t.Fatalf("wrong truncation classification for %q: %v", scenario.text, err)
		}
	}
}

func TestChapterAssetsSelectsLastRootObject(t *testing.T) {
	first := `{"characters":[],"scenes":[],"props":[]}`
	last := `{"props":[{"name":"灯","description":"铜灯","prompt":"铜灯特写"}],"scenes":[],"characters":[]}`
	quoted, err := json.Marshal(last)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name string
		text string
		want string
	}{
		{name: "last-root", text: first + "\n实际结果：\n" + last, want: last},
		{name: "skip-partial-example", text: `{"characters":[]}` + "\n" + last, want: last},
		{name: "last-root-missing-fields", text: first + "\n" + `{"characters":[]}`, want: `{"characters":[]}`},
		{name: "last-root-scenes-only", text: first + "\n" + `{"scenes":[]}`, want: `{"scenes":[]}`},
		{name: "last-root-props-only", text: first + "\n" + `{"props":[]}`, want: `{"props":[]}`},
		{name: "skip-object-interior", text: first + "\n" + `{"example":` + last + `}`, want: first},
		{name: "skip-array-interior", text: first + "\n[" + last + "]", want: first},
		{name: "skip-string-interior", text: first + "\n" + string(quoted), want: first},
		{name: "skip-root-property-interior", text: `{"characters":[],"scenes":[],"props":[],"example":` + last + `}`, want: `{"characters":[],"scenes":[],"props":[],"example":` + last + `}`},
		{name: "skip-unrelated-truncated-object", text: first + "\n" + `{"note":"未写完`, want: first},
		{name: "skip-unrelated-truncated-array", text: first + "\n[" + last, want: first},
		{name: "skip-malformed-prose", text: "说明：{这不是 JSON}\n" + last, want: last},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			got, err := extractChapterAssetsJSONText(scenario.text)
			if err != nil || got != scenario.want {
				t.Fatalf("extractChapterAssetsJSONText() = %q, %v; want %q", got, err, scenario.want)
			}
		})
	}
}

func TestChapterAssetsRejectsTrailingTruncatedRootAfterExample(t *testing.T) {
	example := `{"characters":[],"scenes":[],"props":[]}`
	for _, partial := range []string{
		`{`, `{"`, `{"charac`, `{"scen`, `{"pro`,
		`{"characters":[` + characterCardJSON + `,{"name":"未写完`,
		`{"scenes":[],"characters":[],"props":[`,
		`{"note":"章节一","characters":[`,
	} {
		t.Run(partial, func(t *testing.T) {
			raw := "```json\n" + example + "\n```\n实际结果：\n```json\n" + partial
			got, err := extractChapterAssetsJSONText(raw)
			var incomplete IncompleteChapterAssetsError
			if got != "" || !errors.As(err, &incomplete) {
				t.Fatalf("trailing truncated root must block the earlier example: got %q, error %v", got, err)
			}
			validationErr := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": raw})
			if !errors.As(validationErr, &incomplete) {
				t.Fatalf("validation lost the truncation error: %v", validationErr)
			}
		})
	}
}

func TestChapterAssetsCompleteRootErrorsDoNotRequestContinuation(t *testing.T) {
	for _, invalid := range []string{
		`{}`, `{"characters":[]}`, `{"scenes":[]}`, `{"props":[]}`, `{"props":"灯"}`,
		`{"characters":[],"scenes":[]}`,
		`{"characters":[],"scenes":[],"props":[{"name":"灯"}]}`,
		`{"characters":[],"scenes":[],"props":null}`,
	} {
		t.Run(invalid, func(t *testing.T) {
			raw := invalid
			if invalid != `{}` {
				raw = `{"characters":[],"scenes":[],"props":[]}` + "\n实际结果：\n" + invalid
			}
			err := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": raw})
			var incomplete IncompleteChapterAssetsError
			if err == nil || errors.As(err, &incomplete) {
				t.Fatalf("complete invalid root must fail without requesting continuation: %v", err)
			}
			if strings.Contains(err.Error(), "受保护 JSON 契约") {
				t.Fatalf("complete root must reach field validation: %v", err)
			}
		})
	}
}

func TestChapterAssetsRejectsNestedRootsAndMalformedFinalRoots(t *testing.T) {
	complete := `{"characters":[],"scenes":[],"props":[]}`
	for _, raw := range []string{
		`{"example":` + complete + `}`,
		`[` + complete + `]`,
		`{"characters":[]]` + "\n" + complete,
		`{"note":` + complete,
		complete + "\n实际结果：\n" + `{"characters":[]]`,
		complete + "\n实际结果：\n" + `{"characters":[{"name":}]}`,
	} {
		t.Run(raw, func(t *testing.T) {
			got, err := extractChapterAssetsJSONText(raw)
			var incomplete IncompleteChapterAssetsError
			if got != "" || err == nil || errors.As(err, &incomplete) {
				t.Fatalf("nested or malformed root must not be accepted or continued: got %q, error %v", got, err)
			}
		})
	}
}

// TestValidatePromptTemplateResultCharacterRootShapes 覆盖模型返回角色卡时的各种顶层形态。
// 这些形态都违反 character-breakdown/v1 的顶层 object 契约，但内容本身可用，应当被接受；
// 真正无内容或缺字段的输入则必须报出可读的业务错误，而不是 Go 的类型错误。
func TestValidatePromptTemplateResultCharacterRootShapes(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		wantErr string
	}{
		{name: "标准对象形态", text: `{"characters":[` + characterCardJSON + `]}`},
		{name: "顶层角色卡数组", text: `[` + characterCardJSON + `]`},
		{name: "单元素包 characters", text: `[{"characters":[` + characterCardJSON + `]}]`},
		{name: "多元素各包 characters", text: `[{"characters":[` + characterCardJSON + `]},{"characters":[` + characterCardJSON + `]}]`},
		{name: "数组外再包一层", text: `[[` + characterCardJSON + `]]`},
		{name: "数组混入非角色对象", text: `[{"index":1},` + characterCardJSON + `]`},
		{name: "markdown 代码块包裹数组", text: "```json\n[" + characterCardJSON + "]\n```"},
		{name: "正文先列角色名数组", text: "本章角色：[\"林夏\",\"陈默\"]\n\n{\"characters\":[" + characterCardJSON + "]}"},
		{name: "characters 写成以角色名为键的对象", text: `{"characters":{"林夏":` + characterCardJSON + `}}`},
		{name: "空数组", text: `[]`, wantErr: "没有识别到任何角色"},
		{name: "不相关数组", text: `["林夏","陈默"]`, wantErr: "没有识别到任何角色"},
		{name: "角色缺少必填字段", text: `[{"name":"林夏"}]`, wantErr: "第 1 个角色缺少字段 aliases"},
		// characters 位于契约位置时不做元素过滤，缺 name 也要报出具体字段而不是被当成空结果。
		{name: "契约位置内角色缺少 name", text: `{"characters":[{"role":"女主角"}]}`, wantErr: "第 1 个角色缺少字段 name"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePromptTemplateResult(OperationCharacterExtract, map[string]interface{}{"text": tc.text})
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidatePromptTemplateResult() error = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidatePromptTemplateResult() error = nil, want %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("ValidatePromptTemplateResult() error = %q, want containing %q", err.Error(), tc.wantErr)
			}
			// 形态问题必须收敛成业务语言，不能把 Go 的类型错误抛给用户。
			if strings.Contains(err.Error(), "cannot unmarshal") {
				t.Fatalf("ValidatePromptTemplateResult() leaked Go type error: %v", err)
			}
		})
	}
}

// TestValidatePromptTemplateResultScopesCharacterRelaxation 确认形态放宽只作用于角色卡提取。
// 其余 JSON 操作只要求能取出一个合法 JSON 值，不套用 characters 契约，因此顶层数组对它们依旧无意义。
func TestValidatePromptTemplateResultScopesCharacterRelaxation(t *testing.T) {
	if err := ValidatePromptTemplateResult(OperationStoryboardPlan, map[string]interface{}{"text": `[{"name":"林夏"}]`}); err != nil {
		t.Fatalf("ValidatePromptTemplateResult() error = %v, want nil for non-character JSON operation", err)
	}
	if err := ValidatePromptTemplateResult(OperationStoryboardPlan, map[string]interface{}{"text": "完全没有 JSON 内容"}); err == nil {
		t.Fatal("ValidatePromptTemplateResult() error = nil, want contract error for non-character operation")
	}
	err := ValidatePromptTemplateResult(OperationCharacterExtract, map[string]interface{}{"text": "完全没有 JSON 内容"})
	if err == nil || !strings.Contains(err.Error(), "受保护 JSON 契约") {
		t.Fatalf("ValidatePromptTemplateResult() error = %v, want contract error for character extract", err)
	}
}
