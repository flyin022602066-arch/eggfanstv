package prompts

import (
	"strings"
	"testing"
)

func TestCharacterExtractionRequiresVisualPresence(t *testing.T) {
	for _, operation := range []string{OperationCharacterExtract, OperationChapterAssetsExtract} {
		t.Run(operation, func(t *testing.T) {
			context := protectedPromptContext(operation, map[string]string{
				"章节正文": "林夏站在门口说：‘陈默明天才回来。’",
			})
			for _, required := range []string{
				"【角色出镜判定】", "说话人不等于对白中被提及的人", "仅被提及",
				"画外音", "回忆画面", "照片", "已确认资产",
				"林夏", "陈默", "role", "拟人化系统",
				"其他章节", "出镜证据", "自动绑定", "潇潇",
			} {
				if !strings.Contains(context, required) {
					t.Errorf("%s missing visibility rule %q", operation, required)
				}
			}
		})
	}
}

func TestChapterExtractionPreservesProjectCharacterIdentity(t *testing.T) {
	context := protectedPromptContext(OperationChapterAssetsExtract, map[string]string{"已有角色与造型": "纪昼：灰色训练服；许南枝：银灰色助听器"})
	for _, required := range []string{"纪昼", "银灰色助听器", "changeReason", "sourceEvidence", "肩头碎冰", "不是本章出镜证据", "同一人沿用标准姓名"} {
		if !strings.Contains(context, required) {
			t.Errorf("missing character reuse rule %q", required)
		}
	}
}

func TestCharacterExtractionCompletenessIsProtectedFromPropSelectionRules(t *testing.T) {
	for _, operation := range []string{OperationCharacterExtract, OperationChapterAssetsExtract} {
		definition, _ := PromptDefinition(operation)
		for _, text := range []string{definition.DefaultContent, protectedPromptContext(operation, map[string]string{})} {
			for _, required := range []string{"【角色完整提取】", "只出现一次", "静止", "昏迷", "尸身", "被动", "群众", "仅适用于道具", "不按动作词白名单"} {
				if !strings.Contains(text, required) {
					t.Errorf("%s missing completeness rule %q", operation, required)
				}
			}
			for _, forbidden := range []string{"没有持续角色价值的一次性路人", "另行忽略纯物件、无身份群众"} {
				if strings.Contains(text, forbidden) {
					t.Errorf("%s still excludes one-off characters: %q", operation, forbidden)
				}
			}
		}
	}
	if !strings.Contains(chapterPropSelectionRule, "仅适用于道具") {
		t.Fatal("prop selection must be explicitly restricted to props")
	}
}

func TestCharacterDefaultsDoNotTreatPlotRelevanceAsPresence(t *testing.T) {
	for _, operation := range []string{OperationCharacterExtract, OperationChapterAssetsExtract} {
		definition, ok := PromptDefinition(operation)
		if !ok || !strings.Contains(definition.DefaultContent, "【角色出镜判定】") {
			t.Errorf("%s default lacks visibility rules", operation)
		}
		if strings.Contains(definition.DefaultContent, "实际出场、发言或对剧情产生明确作用") {
			t.Errorf("%s still treats plot relevance or speech as visual presence", operation)
		}
	}
}

func TestStoryboardCastRequiresVisibleCharacters(t *testing.T) {
	contract := StoryboardExecutionContract("按实际时长", "按剧情拆镜")
	for _, required := range []string{"说话人不等于对白中被提及的人", "characterIds", "assetRefs", "画外音"} {
		if !strings.Contains(contract, required) {
			t.Errorf("storyboard contract missing %q", required)
		}
	}
}
