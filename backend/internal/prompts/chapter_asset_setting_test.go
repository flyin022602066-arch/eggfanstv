package prompts

import (
	"strings"
	"testing"
)

func TestChapterAssetExtractionIncludesExplicitPrologueDefinitions(t *testing.T) {
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract} {
		context := protectedPromptContext(operation, map[string]string{"章节正文": "序章：人物介绍。林夏，短发青年女子。"})
		for _, required := range []string{"人物设定与序章", "不要求先发生动作或对白", "不代表每章或每镜出场", "仅被提及"} {
			if !strings.Contains(context, required) {
				t.Errorf("%s missing prologue distinction %q", operation, required)
			}
		}
	}
}
