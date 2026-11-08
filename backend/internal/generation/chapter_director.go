package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/prompts"
)

type directorUnitPlan struct {
	FirstLine int    `json:"firstLine"`
	LastLine  int    `json:"lastLine"`
	Summary   string `json:"summary"`
}

type directorChapterPlan struct {
	Title string             `json:"title"`
	Units []directorUnitPlan `json:"units"`
}

type directorProvider func(context.Context, Input) (map[string]interface{}, error)

var directorQuotePattern = regexp.MustCompile("(?:^|\\n|[：:])\\s*“([^”\\n]+)”")
var directorBlockTagPattern = regexp.MustCompile(`(?i)<(?:br\b[^>]*|/(?:p|div|li|h[1-6]|blockquote|pre)\s*)>`)
var directorHTMLTagPattern = regexp.MustCompile(`(?i)</?(?:p|div|br|li|ul|ol|h[1-6]|span|strong|em|b|i|u|blockquote|pre|code|section|article)\b[^>]*>`)

func directorJSON(text string, target any) error {
	body, err := prompts.ExtractJSONText(text)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(body), target)
}

func directorSourceLines(source string) []string {
	source = html.UnescapeString(directorHTMLTagPattern.ReplaceAllString(directorBlockTagPattern.ReplaceAllString(source, "\n"), ""))
	var lines []string
	var current strings.Builder
	var quotes []rune
	flush := func() {
		if line := strings.TrimSpace(current.String()); line != "" {
			lines = append(lines, line)
		}
		current.Reset()
	}
	for _, character := range strings.ReplaceAll(source, "\r\n", "\n") {
		if character == '\n' || character == '\r' {
			if len(quotes) == 0 {
				flush()
			} else {
				current.WriteRune(character)
			}
			continue
		}
		current.WriteRune(character)
		if len(quotes) > 0 && character == quotes[len(quotes)-1] {
			quotes = quotes[:len(quotes)-1]
			if len(quotes) == 0 {
				flush()
			}
			continue
		}
		switch character {
		case '“':
			quotes = append(quotes, '”')
		case '‘':
			quotes = append(quotes, '’')
		case '「':
			quotes = append(quotes, '」')
		case '『':
			quotes = append(quotes, '』')
		case '"':
			quotes = append(quotes, '"')
		case '。', '！', '？', '；', '!', '?':
			if len(quotes) == 0 {
				flush()
			}
		}
	}
	flush()
	return lines
}

func validateDirectorPlan(plan directorChapterPlan, count int) error {
	next := 1
	if len(plan.Units) == 0 {
		return fmt.Errorf("整章规划未返回生成单元")
	}
	for index, unit := range plan.Units {
		if unit.FirstLine != next || unit.LastLine < next || unit.LastLine > count || strings.TrimSpace(unit.Summary) == "" {
			return fmt.Errorf("整章规划第%d段原文范围不连续或无效，不能遗漏、重排或重复正文", index+1)
		}
		next = unit.LastLine + 1
	}
	if next != count+1 {
		return fmt.Errorf("整章规划遗漏结尾原文，已覆盖%d/%d行", next-1, count)
	}
	return nil
}

func directorCompact(text string) string {
	return strings.Map(func(character rune) rune {
		if unicode.IsSpace(character) {
			return -1
		}
		return character
	}, text)
}

func resolveDirectorReferences(row map[string]interface{}, metadata map[string]interface{}) error {
	encoded, err := json.Marshal(metadata["storyboardAssets"])
	if err != nil {
		return err
	}
	var assets []struct {
		ID       string
		Title    string
		Category string
		Aliases  []string
	}
	if err := json.Unmarshal(encoded, &assets); err != nil {
		return fmt.Errorf("逐镜资产白名单无效：%w", err)
	}
	sceneID := strings.TrimSpace(stringField(row, "sceneAssetId"))
	sceneName := strings.TrimSpace(stringField(row, "sceneName"))
	matched := -1
	for index, asset := range assets {
		if asset.Category != "environment" {
			continue
		}
		if sceneID != "" {
			if sceneID == asset.ID {
				matched = index
				break
			}
			continue
		}
		names := append([]string{asset.Title}, asset.Aliases...)
		for _, name := range names {
			if sceneName != "" && strings.EqualFold(strings.TrimSpace(name), sceneName) {
				if matched >= 0 && matched != index {
					return fmt.Errorf("场景“%s”存在重名，须明确白名单场景ID", sceneName)
				}
				matched = index
				break
			}
		}
	}
	if sceneID != "" && matched < 0 {
		return fmt.Errorf("场景ID“%s”不属于当前场景白名单", sceneID)
	}
	if matched >= 0 {
		asset := assets[matched]
		row["sceneAssetId"], row["sceneName"] = asset.ID, asset.Title
		bindings := InterfaceSlice(row["assetBindings"])
		found := false
		for _, value := range bindings {
			binding, _ := value.(map[string]interface{})
			if stringField(binding, "nodeId") == asset.ID {
				binding["role"] = "environment"
				found = true
			}
		}
		if !found {
			bindings = append(bindings, map[string]interface{}{"nodeId": asset.ID, "role": "environment", "priority": 1})
		}
		row["assetBindings"] = bindings
	}
	for _, value := range InterfaceSlice(row["characters"]) {
		character, ok := value.(map[string]interface{})
		if !ok {
			continue
		}
		for field, alias := range map[string]string{"characterName": "name", "characterAssetId": "assetId", "characterVersionId": "versionId"} {
			if _, exists := character[field]; !exists {
				if text, ok := character[alias].(string); ok {
					character[field] = text
				}
			}
		}
		if strings.TrimSpace(stringField(character, "characterName")) == "" {
			return fmt.Errorf("角色引用缺少有效characterName")
		}
		if id := stringField(character, "characterAssetId"); id != "" {
			found := false
			for _, asset := range assets {
				if asset.ID == id && asset.Category == "character" {
					found = true
				}
			}
			if !found {
				return fmt.Errorf("角色ID“%s”不属于当前角色白名单", id)
			}
		}
	}
	return nil
}

func validateDirectorRow(row map[string]interface{}, source string) error {
	var issues []string
	if number, _ := row["durationSeconds"].(float64); number != 30 {
		issues = append(issues, "顶层时长不是30秒")
	}
	script, _ := row["directorScript"].(map[string]interface{})
	shots := InterfaceSlice(script["shots"])
	total := float64(0)
	short := 0
	content := stringField(script, "setting") + stringField(script, "ending")
	var voices strings.Builder
	for index, item := range shots {
		shot, _ := item.(map[string]interface{})
		duration, _ := shot["durationSeconds"].(float64)
		if duration < 1 || duration > 4 {
			issues = append(issues, fmt.Sprintf("内部镜头%d时长须为1–4秒", index+1))
		}
		if duration <= 3 {
			short++
		}
		total += duration
		for _, field := range []string{"camera", "start", "performance", "focusAndLight", "end", "sound"} {
			value := strings.TrimSpace(stringField(shot, field))
			if value == "" {
				issues = append(issues, fmt.Sprintf("内部镜头%d缺少%s", index+1, field))
			}
			content += value
		}
		voices.WriteString(stringField(shot, "sound"))
	}
	if math.Abs(total-30) > 0.001 || short*2 <= len(shots) {
		issues = append(issues, fmt.Sprintf("内部镜长合计须为30秒且以1–3秒为主，当前合计%g秒，%d镜，其中%d镜不超过3秒", total, len(shots), short))
	}
	if utf8.RuneCountInString(directorCompact(content)) < 1000 {
		issues = append(issues, "逐镜导演正文不足1000字符，须展开实际摄影与表演过程")
	}
	spoken, ok := row["dialogue"].(string)
	if !ok {
		issues = append(issues, "dialogue须为带说话人的原话字符串")
	}
	spokenOffset, voiceOffset := 0, 0
	spokenText, voiceText := directorCompact(spoken), directorCompact(voices.String())
	for _, quote := range directorQuotePattern.FindAllStringSubmatch(source, -1) {
		original := directorCompact(quote[1])
		spokenIndex := strings.Index(spokenText[spokenOffset:], original)
		voiceIndex := strings.Index(voiceText[voiceOffset:], original)
		if spokenIndex < 0 || voiceIndex < 0 {
			issues = append(issues, fmt.Sprintf("原话未同时落实到dialogue和逐镜声轨：%s", quote[1]))
		} else {
			spokenOffset += spokenIndex + len(original)
			voiceOffset += voiceIndex + len(original)
		}
	}
	if len(issues) > 0 {
		return fmt.Errorf("%s", strings.Join(issues, "；"))
	}
	return nil
}

func normalizeDirectorTiming(row map[string]interface{}) {
	script, _ := row["directorScript"].(map[string]interface{})
	shots := InterfaceSlice(script["shots"])
	if len(shots) < 8 || len(shots) > 30 {
		return
	}
	ticks := make([]int, len(shots))
	total := 0
	for index, item := range shots {
		shot, _ := item.(map[string]interface{})
		duration, _ := shot["durationSeconds"].(float64)
		if duration < 1 || duration > 4 {
			return
		}
		ticks[index] = int(math.Round(duration * 1000))
		total += ticks[index]
	}
	if total == 30000 || total < 27000 || total > 33000 {
		return
	}
	original := total
	for total != 30000 {
		choice := -1
		for index, value := range ticks {
			if total < 30000 && value < 4000 && (choice < 0 || value > ticks[choice]) {
				choice = index
			}
			if total > 30000 && value > 1000 && (choice < 0 || value > ticks[choice]) {
				choice = index
			}
		}
		if choice < 0 {
			return
		}
		if total < 30000 {
			ticks[choice]++
			total++
		} else {
			ticks[choice]--
			total--
		}
	}
	short := 0
	for _, value := range ticks {
		if value <= 3000 {
			short++
		}
	}
	if short*2 <= len(shots) {
		return
	}
	for index, item := range shots {
		item.(map[string]interface{})["durationSeconds"] = float64(ticks[index]) / 1000
	}
	script["timingNormalization"] = map[string]interface{}{"originalTotalSeconds": float64(original) / 1000, "totalSeconds": 30}
}

func runPlannedDirectorTask(ctx context.Context, input Input, generate directorProvider) (map[string]interface{}, error) {
	source := metadataString(input.Metadata, "chapterSourceText")
	lines := directorSourceLines(source)
	boundary := strings.Index(input.Prompt, "【受保护输出契约】")
	taskBoundary := strings.Index(input.Prompt, "【用户任务】")
	if len(lines) == 0 || boundary < 0 || taskBoundary < 0 || taskBoundary >= boundary {
		return nil, fmt.Errorf("结构化逐镜任务缺少完整原文或输出合同")
	}
	var numbered strings.Builder
	for index, line := range lines {
		fmt.Fprintf(&numbered, "%d. %s\n", index+1, line)
	}
	contextPrompt := input.Prompt[:taskBoundary]
	contract := input.Prompt[boundary:]
	base := input
	base.OnTextDelta = nil
	base.OnReasoningDelta = nil
	base.StreamText = false
	base.MaxOutputTokens = 32768
	base.TextHistory = nil
	base.Metadata = CloneStringAnyMap(input.Metadata)
	delete(base.Metadata, "storyboardExecution")
	planning := base
	planning.MaxOutputTokens = 8192
	planning.Prompt = contextPrompt + "\n【当前任务：只规划整章范围】\n同一个技能内部先规划，再逐单元展开；本轮不要写逐镜正文。按原文因果、真实话轮及场景转换组织通常3–6个30秒单元，总目标90–180秒，不按原文字数机械分段。每个单元只能有一个主场景，原文转场在单元边界；所有原文行必须按顺序且恰好覆盖一次，首段firstLine=1、下一段firstLine=上一段lastLine+1、末段lastLine为原文最后一行。行号只是完整句与话轮的定位锚点，不是分镜数或时长；按剧情合并相邻行，不要每行一个单元，也不要因原稿只有一个段落就整章只规划一个单元。旁白和动作可并行，不删台词、不虚构剧情、不把每次接话单独分段。只返回JSON {\"title\":string,\"units\":[{\"firstLine\":integer,\"lastLine\":integer,\"summary\":string}]}。\n【带行号的完整原文】\n" + numbered.String()
	planning.Prompt += fmt.Sprintf("\n【原文结束】总行数=%d；最后单元lastLine必须=%d。末行原文：%s\n", len(lines), len(lines), lines[len(lines)-1])
	var result map[string]interface{}
	var err error
	var plan directorChapterPlan
	for attempt := 0; attempt < 2; attempt++ {
		result, err = generate(ctx, planning)
		if err != nil {
			return nil, err
		}
		plan = directorChapterPlan{}
		err = directorJSON(stringField(result, "text"), &plan)
		if err == nil {
			err = validateDirectorPlan(plan, len(lines))
		}
		if err == nil {
			break
		}
		planning.Prompt += "\n【规划修正】" + err.Error() + "。只返回完整修正规划，不要写逐镜稿。\n【上次规划】\n" + stringField(result, "text")
	}
	if err != nil {
		return nil, err
	}
	planJSON, _ := json.Marshal(plan)
	rows := make([]map[string]interface{}, 0, len(plan.Units))
	continuity := ""
	for index, unit := range plan.Units {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		section := strings.Join(lines[unit.FirstLine-1:unit.LastLine], "\n")
		var checklist strings.Builder
		for quoteIndex, quote := range directorQuotePattern.FindAllStringSubmatch(section, -1) {
			fmt.Fprintf(&checklist, "%d. “%s”\n", quoteIndex+1, quote[1])
		}
		if runtime, ok := RuntimeFromContext(ctx); ok {
			if err := setExecutionStage(ctx, runtime, fmt.Sprintf("正在展开逐镜详稿 %d/%d", index+1, len(plan.Units))); err != nil {
				return nil, err
			}
		}
		detail := base
		detail.Prompt = contextPrompt + "\n【整章已规划，仅作前后因果参考】\n" + string(planJSON) +
			fmt.Sprintf("\n【本轮仅展开第%d/%d个30秒单元】\n", index+1, len(plan.Units)) +
			"当前单元原文是本次唯一剧情范围，不重复前段、不提前表演后段。逐句保留此范围所有原话；每镜sound及dialogue写真实说话人，dialogue为字符串不是数组。必须完成通常10–15个1–3秒切角、最长4秒、合计30秒，以及约1000–2000字的具体导演正文。只返回一条row的JSON {\"title\":string,\"rows\":[row]}，不摘要、不省略后半段。\n【前段实际落幅】\n" + continuity +
			"\n【当前单元原文】\n" + section + "\n【本单元原话逐句核对】\n" + checklist.String() + "\n" + contract
		var row map[string]interface{}
		for attempt := 0; attempt < 2; attempt++ {
			result, err = generate(ctx, detail)
			if err != nil {
				return nil, err
			}
			var envelope struct {
				Rows []map[string]interface{} `json:"rows"`
			}
			err = directorJSON(stringField(result, "text"), &envelope)
			if err == nil {
				if len(envelope.Rows) != 1 {
					err = fmt.Errorf("本轮必须且只展开当前一个单元")
				} else {
					row = envelope.Rows[0]
					normalizeDirectorTiming(row)
					err = resolveDirectorReferences(row, input.Metadata)
					if err == nil {
						err = validateDirectorRow(row, section)
					}
				}
			}
			if err == nil {
				break
			}
			detail.TextHistory = []TextMessage{{Role: "assistant", Content: stringField(result, "text")}, {Role: "user", Content: "本单元检查未通过：" + err.Error() + "。仅修正当前完整row，保持原文及前后接戏。返回完整JSON，不解释。"}}
			detail.Prompt += "\n【本单元修正要求】" + err.Error() + "。请重新返回当前完整单元，不能省略原话或逐镜细节。"
		}
		if err != nil {
			return nil, fmt.Errorf("第%d/%d单元未达标，未回填半成品：%w", index+1, len(plan.Units), err)
		}
		row["shotNumber"] = index + 1
		rows = append(rows, row)
		continuity = stringField(row, "continuityOut")
	}
	body, err := json.Marshal(map[string]interface{}{"title": plan.Title, "rows": rows})
	if err != nil {
		return nil, err
	}
	text := string(body)
	if input.OnTextDelta != nil {
		input.OnTextDelta(text)
	}
	return map[string]interface{}{"mode": "text", "text": text, "directorPlan": plan}, nil
}
