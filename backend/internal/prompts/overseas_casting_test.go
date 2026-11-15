package prompts

import (
	"strings"
	"testing"
)

func TestRegionalCastingSurvivesProtectedCharacterContext(t *testing.T) {
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract, OperationCharacterTurnaround} {
		t.Run(operation, func(t *testing.T) {
			context := protectedPromptContext(operation, map[string]string{
				"项目名称": "海外剧", "章节名称": "第一集", "章节正文": "Emma推门进入办公室。",
				"项目画风": "【地域选角与文化语境】欧美剧多族裔选角，真人实拍。",
				"角色名称": "Emma", "角色设定": "成年女性，棕色短发",
			})
			for _, required := range []string{"欧美剧多族裔选角", "中文译名", "人脸参考", "美术补全·非原文事实", "appearance", "multiViewPrompt", "不改姓名", "后续造型沿用已确认基础人脸"} {
				if !strings.Contains(context, required) {
					t.Errorf("missing regional casting protection %q", required)
				}
			}
		})
	}
}
