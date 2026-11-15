package prompts

import (
	"strings"
	"testing"
)

func TestChapterAssetCoverageReviewIsExplicitAndScoped(t *testing.T) {
	values := map[string]string{"章节正文": "林夏走进旧屋。", "资产复核清单": "首轮清单-旧屋"}
	context := protectedPromptContext(OperationChapterAssetsExtract, values)
	for _, required := range []string{"仅补遗漏一次", "首轮清单-旧屋", "角色不套用道具", "sourceEvidence", "三个空数组", "林夏走进旧屋"} {
		if !strings.Contains(context, required) {
			t.Errorf("missing %q", required)
		}
	}
	if strings.Contains(protectedPromptContext(OperationChapterAssetsExtract, map[string]string{}), "本集资产覆盖复核") {
		t.Fatal("ordinary extraction acquired review mode")
	}
	if err := ValidatePromptTemplateResult(OperationChapterAssetsExtract, map[string]interface{}{"text": "{\"characters\":[],\"scenes\":[],\"props\":[]}"}); err != nil {
		t.Fatal(err)
	}
}
