package generation

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChixieBlockingRulesAndActualStateReachEachExpansion(t *testing.T) {
	var guides []string
	for _, path := range []string{"SKILL.md", "references/director-optics-dialogue.md", "references/spatial-continuity.md"} {
		body, err := os.ReadFile(filepath.Join("..", "..", "..", "skill-packages", "short-drama-editing", "chixie-rusong-plus-v2-blocking", filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		guides = append(guides, string(body))
	}
	input := directorTestInput()
	input.Prompt = strings.Join(guides, "\n") + "\n【用户任务】原文\n【受保护输出契约】逐镜JSON"
	input.Metadata["chapterSourceText"] = "“旧屋。”\n“院内。”\n“回屋。”"
	// Synthetic provider replies test transport, not the model's creative compliance.
	states := []string{
		"空间交接：旧屋桌前林默在左、柳青在右，轴同侧；柳青在特写外仍原位。",
		"空间交接：院内重新建立站位；待返回旧屋最近状态：林默左、柳青右、轴同侧。",
		"空间交接：返回旧屋，按旧屋最近状态林默左、柳青右；不沿用院内站位。",
	}
	quotes := []string{"旧屋。", "院内。", "回屋。"}
	calls := 0
	result, err := runPlannedDirectorTask(context.Background(), input, func(_ context.Context, request Input) (map[string]interface{}, error) {
		for _, guide := range guides {
			if !strings.Contains(request.Prompt, guide) {
				t.Fatal("inherited or spatial rules lost at a generation stage")
			}
		}
		calls++
		if calls == 1 {
			return directorTestResult(directorChapterPlan{Title: "spatial", Units: []directorUnitPlan{{1, 1, "旧屋"}, {2, 2, "院内"}, {3, 3, "回屋"}}}), nil
		}
		index := calls - 2
		if index > 2 {
			t.Fatal("unexpected extra request")
		}
		if index > 0 && !strings.Contains(request.Prompt, "【前段实际落幅】\n"+states[index-1]) {
			t.Fatal("previous authored state not forwarded verbatim")
		}
		row := directorTestRow(quotes[index])
		row["continuityOut"] = states[index]
		return directorTestResult(map[string]interface{}{"rows": []any{row}}), nil
	})
	if err != nil || calls != 4 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
	for _, state := range states {
		if !strings.Contains(stringField(result, "text"), state) {
			t.Fatal("authored state lost from returned chapter")
		}
	}
}
