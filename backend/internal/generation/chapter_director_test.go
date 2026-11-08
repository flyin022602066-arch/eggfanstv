package generation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func directorTestResult(value any) map[string]interface{} {
	encoded, _ := json.Marshal(value)
	return map[string]interface{}{"text": string(encoded)}
}

func directorTestRow(quote string) map[string]interface{} {
	shots := make([]map[string]interface{}, 10)
	for index := range shots {
		shots[index] = map[string]interface{}{
			"durationSeconds": 3, "camera": strings.Repeat("同侧中近景随目光微推进并在眼神落点停稳。", 3),
			"start": "人物接住前镜手部的动作相位。", "performance": strings.Repeat("说话时望向画外既定对手，手部保持连续。", 3),
			"focusAndLight": "近侧眼清楚，侧窗光保留暗侧肤质。", "end": "在目光确认时切入听者反应。",
			"sound": "连续现场底声。",
		}
	}
	shots[0]["sound"] = "人物：“" + quote + "”"
	return map[string]interface{}{
		"durationSeconds": 30, "dialogue": "人物：“" + quote + "”",
		"directorScript": map[string]interface{}{"setting": "同一现场与主光。", "shots": shots, "ending": "面部稳定，动作接续。"},
		"continuityOut":  "手放下后看向门口。",
	}
}

func directorTestInput() Input {
	return Input{Prompt: "唯一技能正文\n【用户任务】原文\n【受保护输出契约】逐镜JSON", Metadata: map[string]interface{}{"chapterSourceText": "“开始。”\n“结束。”"}}
}

func TestDirectorSourceLinesExposeSentenceBoundariesInsideRichTextParagraphs(t *testing.T) {
	source := `<p>嬴政躺在龙榻上。“朕……真的没办法长生吗？”殿内传来响声。陈尧跪在地上。“陛下！我的时间不多了！”</p><p>嬴政松开短剑。<br>陈尧抬起头。</p>`
	lines := directorSourceLines(source)
	if len(lines) < 5 {
		t.Fatalf("rich text chapter still cannot be planned across narrative boundaries: %q", lines)
	}
	joined := strings.Join(lines, "")
	want := "嬴政躺在龙榻上。“朕……真的没办法长生吗？”殿内传来响声。陈尧跪在地上。“陛下！我的时间不多了！”嬴政松开短剑。陈尧抬起头。"
	if joined != want {
		t.Fatalf("source content changed: %q", joined)
	}
	for _, quote := range []string{"“朕……真的没办法长生吗？”", "“陛下！我的时间不多了！”"} {
		found := false
		for _, line := range lines {
			found = found || strings.Contains(line, quote)
		}
		if !found {
			t.Fatalf("dialogue was cut inside a complete quote: %s", quote)
		}
	}
}

func TestDirectorSourceLinesDecodeEntitiesAndKeepPlainTextAndNestedQuotes(t *testing.T) {
	for _, source := range []string{`<p>陈尧说：&ldquo;陛下，&lsquo;祖龙计划&rsquo;已经启动！&rdquo;嬴政点头。</p>`, "陈尧说：“陛下，‘祖龙计划’已经启动！”嬴政点头。"} {
		lines := directorSourceLines(source)
		if strings.Join(lines, "") != "陈尧说：“陛下，‘祖龙计划’已经启动！”嬴政点头。" {
			t.Fatalf("entities or quotes corrupted: %q", lines)
		}
		if !strings.Contains(lines[0], "“陛下，‘祖龙计划’已经启动！”") {
			t.Fatalf("nested quote split: %q", lines)
		}
	}
}

func TestPlannedDirectorCanPlanMultipleUnitsFromOneRichTextParagraph(t *testing.T) {
	input := directorTestInput()
	input.Metadata["chapterSourceText"] = `<p>嬴政抬头。“开始。”陈尧站起。“继续。”两人走出大殿。“结束。”</p>`
	quotes := []string{"开始。", "继续。", "结束。"}
	calls := 0
	result, err := runPlannedDirectorTask(context.Background(), input, func(ctx context.Context, request Input) (map[string]interface{}, error) {
		calls++
		if calls == 1 {
			if !strings.Contains(request.Prompt, "6. “结束。”") || strings.Contains(request.Prompt, "<p>") {
				t.Fatal("the planner still received a single HTML line instead of complete sentence anchors")
			}
			return directorTestResult(directorChapterPlan{Units: []directorUnitPlan{{1, 2, "开头"}, {3, 4, "推进"}, {5, 6, "结尾"}}}), nil
		}
		if calls > 4 {
			t.Fatal("unexpected extra model call")
		}
		return directorTestResult(map[string]interface{}{"rows": []any{directorTestRow(quotes[calls-2])}}), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var output struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(stringField(result, "text")), &output); err != nil || len(output.Rows) != 3 || calls != 4 {
		t.Fatalf("one source paragraph did not return all planned units: rows=%d calls=%d error=%v", len(output.Rows), calls, err)
	}
	for index, row := range output.Rows {
		if !strings.Contains(stringField(row, "dialogue"), quotes[index]) {
			t.Fatal("dialogue was lost or reordered")
		}
	}
}

func TestDirectorPlanRejectsMissingAndOverlappingSource(t *testing.T) {
	for _, units := range [][]directorUnitPlan{
		{{1, 1, "开头"}},
		{{1, 2, "开头"}, {2, 3, "重复"}},
		{{2, 3, "漏头"}},
	} {
		if validateDirectorPlan(directorChapterPlan{Units: units}, 3) == nil {
			t.Fatal("invalid coverage accepted")
		}
	}
}

func TestDirectorReferencesResolveOnlyExactCatalogIdentities(t *testing.T) {
	metadata := map[string]interface{}{"storyboardAssets": []map[string]interface{}{
		{"id": "frost-window", "title": "结霜窗前室内", "category": "environment", "aliases": []string{"结霜窗边"}},
		{"id": "training", "title": "室内训练区", "category": "environment"},
		{"id": "hero", "title": "纪昼", "category": "character"},
	}}
	row := map[string]interface{}{"sceneName": "结霜窗边", "sceneAssetId": "", "characters": []interface{}{
		map[string]interface{}{"name": "纪昼", "assetId": "hero", "versionId": "hero-look"},
	}}
	if err := resolveDirectorReferences(row, metadata); err != nil {
		t.Fatal(err)
	}
	if row["sceneAssetId"] != "frost-window" || row["sceneName"] != "结霜窗前室内" {
		t.Fatal("exact existing scene was not bound")
	}
	bindings := InterfaceSlice(row["assetBindings"])
	if len(bindings) != 1 || bindings[0].(map[string]interface{})["nodeId"] != "frost-window" {
		t.Fatal("scene binding missing")
	}
	if err := resolveDirectorReferences(row, metadata); err != nil || len(InterfaceSlice(row["assetBindings"])) != 1 {
		t.Fatal("reference resolution duplicated the existing scene binding")
	}
	character := InterfaceSlice(row["characters"])[0].(map[string]interface{})
	if character["characterVersionId"] != "hero-look" || character["characterName"] != "纪昼" {
		t.Fatal("character identity was lost")
	}
	if err := resolveDirectorReferences(map[string]interface{}{"sceneName": "更衣室", "sceneAssetId": "hero"}, metadata); err == nil {
		t.Fatal("character ID accepted as scene")
	}
	unknown := map[string]interface{}{"sceneName": "基地外", "sceneAssetId": ""}
	if err := resolveDirectorReferences(unknown, metadata); err != nil || unknown["sceneAssetId"] != "" {
		t.Fatal("absent exterior was replaced by an unrelated interior")
	}
}

func TestDirectorDialogueCoverageRejectsReorderedOrCollapsedRepeatedLines(t *testing.T) {
	for _, spoken := range []string{"人物：“结束。”“开始。”", "人物：“开始。”"} {
		row := directorTestRow("开始。")
		row["dialogue"] = spoken
		row["directorScript"].(map[string]interface{})["shots"].([]map[string]interface{})[0]["sound"] = spoken
		encoded, _ := json.Marshal(row)
		var parsed map[string]interface{}
		_ = json.Unmarshal(encoded, &parsed)
		source := "“开始。”\n“结束。”"
		if spoken == "人物：“开始。”" {
			source = "“开始。”\n“开始。”"
		}
		if err := validateDirectorRow(parsed, source); err == nil {
			t.Fatal("reordered or collapsed source dialogue accepted")
		}
	}
}

func TestDirectorDialogueCoverageAcceptsRepeatedLinesInOriginalOrder(t *testing.T) {
	row := directorTestRow("开始。结束。开始。")
	encoded, _ := json.Marshal(row)
	var parsed map[string]interface{}
	_ = json.Unmarshal(encoded, &parsed)
	if err := validateDirectorRow(parsed, "“开始。”\n“结束。”\n“开始。”"); err != nil {
		t.Fatal(err)
	}
}

func TestDirectorTimingBalancesSmallArithmeticErrorWithoutChangingPerformance(t *testing.T) {
	row := directorTestRow("开始。")
	script := row["directorScript"].(map[string]interface{})
	script["shots"] = script["shots"].([]map[string]interface{})[:9]
	encoded, _ := json.Marshal(row)
	var parsed map[string]interface{}
	_ = json.Unmarshal(encoded, &parsed)
	before := parsed["dialogue"]
	normalizeDirectorTiming(parsed)
	if err := validateDirectorRow(parsed, "“开始。”"); err != nil {
		t.Fatal(err)
	}
	if parsed["dialogue"] != before {
		t.Fatal("timing arithmetic changed authored dialogue")
	}
}

func TestPlannedDirectorReturnsWholeChapterOnlyAfterAllUnitsPass(t *testing.T) {
	calls := 0
	emitted := ""
	input := directorTestInput()
	input.OnTextDelta = func(delta string) { emitted += delta }
	result, err := runPlannedDirectorTask(context.Background(), input, func(ctx context.Context, request Input) (map[string]interface{}, error) {
		calls++
		if request.OnTextDelta != nil || request.StreamText {
			t.Fatal("partial source output must not masquerade as the complete script")
		}
		switch calls {
		case 1:
			return directorTestResult(directorChapterPlan{Title: "chapter", Units: []directorUnitPlan{{1, 1, "开头"}, {2, 2, "结尾"}}}), nil
		case 2:
			return directorTestResult(map[string]interface{}{"rows": []any{directorTestRow("开始。")}}), nil
		case 3:
			if !strings.Contains(request.Prompt, "手放下后看向门口。") {
				t.Fatal("actual previous continuity missing")
			}
			return directorTestResult(map[string]interface{}{"rows": []any{directorTestRow("结束。")}}), nil
		default:
			t.Fatal("unexpected extra generation")
			return nil, errors.New("unexpected")
		}
	})
	if err != nil || calls != 3 || emitted != stringField(result, "text") || !strings.Contains(emitted, "开始。") || !strings.Contains(emitted, "结束。") {
		t.Fatalf("incomplete result: calls=%d err=%v", calls, err)
	}
}

func TestPlannedDirectorBoundsCorrectionAndNeverEmitsHalfResult(t *testing.T) {
	calls := 0
	emitted := ""
	input := directorTestInput()
	input.OnTextDelta = func(delta string) { emitted += delta }
	result, err := runPlannedDirectorTask(context.Background(), input, func(ctx context.Context, request Input) (map[string]interface{}, error) {
		calls++
		if calls == 1 {
			return directorTestResult(directorChapterPlan{Units: []directorUnitPlan{{1, 2, "全章"}}}), nil
		}
		if calls == 3 && len(request.TextHistory) != 2 {
			t.Fatal("correction lacks actual failed output")
		}
		return directorTestResult(map[string]interface{}{"rows": []any{directorTestRow("开始。")}}), nil
	})
	if err == nil || result != nil || calls != 3 || emitted != "" {
		t.Fatalf("unbounded correction or partial write: calls=%d err=%v", calls, err)
	}
}
