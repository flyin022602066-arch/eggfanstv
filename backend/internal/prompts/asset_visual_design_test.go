package prompts

import (
	"strings"
	"testing"
)

func TestAssetVisualDesignSurvivesSavedPrompts(t *testing.T) {
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract, OperationCharacterTurnaround} {
		t.Run(operation, func(t *testing.T) {
			content := protectedPromptContext(operation, map[string]string{
				"角色名称": "陈尧", "角色设定": "青年军医，深色实用服装", "项目画风": "真人实拍",
				"章节正文": "陈尧拿出回元注射剂。", "同项目角色设计参考": "嬴政：消瘦长脸，帝王宽袖衣袍",
			})
			for _, required := range []string{"【角色视觉辨识设计】", "2—3个", "美术补全", "非原文事实", "不得新增伤疤", "基础版"} {
				if !strings.Contains(content, required) {
					t.Errorf("%s missing visual design rule %q", operation, required)
				}
			}
			if operation == OperationChapterAssetsExtract {
				for _, required := range []string{"【场景与道具设定图设计】", "主全景", "补充角度", "关键局部", "同一空间", "简单道具", "不增加独立资产"} {
					if !strings.Contains(content, required) {
						t.Errorf("missing scene/prop design rule %q", required)
					}
				}
			}
			if operation == OperationCharacterTurnaround && !strings.Contains(content, "嬴政：消瘦长脸") {
				t.Error("turnaround lost same-project character design reference")
			}
		})
	}
}
