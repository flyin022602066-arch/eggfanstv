package prompts

import (
	"strings"
	"testing"
)

func TestChapterPropSelectionKeepsReusableAndPlotCriticalAssets(t *testing.T) {
	context := protectedPromptContext(OperationChapterAssetsExtract, map[string]string{
		"章节正文": "她喝了一口水，随后打开藏有证据的盒子。",
		"章节分镜": "镜头01使用证据盒，镜头02再次展示证据盒。",
	})
	for _, required := range []string{"普通物品仅出现一次", "两个及以上不同镜头", "剧情关键", "系统界面", "不能仅因拿取、佩戴、传递或操作", "尚无分镜", "不删除已确认资产", "镜头01使用证据盒"} {
		if !strings.Contains(context, required) {
			t.Errorf("chapter prop selection missing %q", required)
		}
	}
	if strings.Contains(context, "角色拿取、佩戴、传递、操作及被特写的剧情道具必须独立列入 props") {
		t.Fatal("blanket prop extraction still overrides selective extraction")
	}
}
