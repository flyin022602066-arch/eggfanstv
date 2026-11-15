package prompts

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/characterkind"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"strings"
	"testing"
)

func TestGroupRulesSurvivePromptCustomizations(t *testing.T) {
	for _, mode := range []string{"default", "saved", promptCustomizationAppend, promptCustomizationRewrite} {
		t.Run(mode, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			connection, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			connection.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = connection.Close() })
			if err := db.AutoMigrate(&model.PromptTemplate{}, &model.UserPromptCustomization{}); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(db)
			service := New(repo, nil)
			if mode != "default" {
				if err := repo.SavePromptTemplate(&model.PromptTemplate{ID: "group-template", Operation: OperationCharacterTurnaround, Name: "旧模板", Version: 1, Enabled: true, Content: "旧模板单人三视图，保留蓝灰工装"}); err != nil {
					t.Fatal(err)
				}
			}
			if mode == promptCustomizationAppend || mode == promptCustomizationRewrite {
				if err := repo.SaveUserPromptCustomization(&model.UserPromptCustomization{ID: "custom-group", UserID: "fixture", Operation: OperationCharacterTurnaround, Mode: mode, Content: "保留蓝灰工装"}); err != nil {
					t.Fatal(err)
				}
			}
			compiled, err := service.CompilePrompt("fixture", OperationCharacterTurnaround, map[string]string{"角色名称": "工人与食客群像", "角色类型": "group", "角色设定": "工人穿蓝灰工装，食客穿普通衣服", "项目画风": "3D动画"})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(compiled.Content, characterkind.GroupDesignRule) || !strings.HasSuffix(compiled.Content, characterkind.GroupDesignRule) {
				t.Fatal("group override must be the final protected rule")
			}
			if strings.Contains(compiled.Content, characterReferenceSheetLayout) || strings.Contains(compiled.Content, characterVisualDesignRule) {
				t.Fatal("single identity layout or face lock leaked into group prompt")
			}
			for _, value := range []string{"蓝灰工装", "3D动画", "不同面孔", "以本规则为准"} {
				if !strings.Contains(compiled.Content, value) {
					t.Errorf("missing %s", value)
				}
			}
		})
	}
}

func TestGroupExtractionRulesAndIndividualOverride(t *testing.T) {
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract} {
		content := protectedPromptContext(operation, nil)
		for _, rule := range []string{characterkind.GroupExtractionRule, characterkind.GroupDesignRule, "characterType", "三师傅", "不同成员的服装不是同一角色的多形态"} {
			if !strings.Contains(content, rule) {
				t.Errorf("%s missing %s", operation, rule)
			}
		}
	}
	content := protectedPromptContext(OperationCharacterTurnaround, map[string]string{"角色名称": "工人群像", "角色类型": "individual", "角色设定": "用户明确这是单人演员"})
	if !strings.Contains(content, characterReferenceSheetLayout) || strings.Contains(content, characterkind.GroupDesignRule) {
		t.Fatal("manual individual type must override collective title")
	}
}

func TestGroupExtractionJSONPreservesCharacterType(t *testing.T) {
	payload := `{"characters":[{"name":"工人群像","characterType":"group","aliases":[],"role":"【群体演员】现场多个工人","appearance":"多人脸型不同","clothing":"蓝灰工装","physique":"体态各异","personality":"正文未明确","props":"","consistencyPrompt":"服饰一致、脸孔各异","multiViewPrompt":"多人选角同框，不做单人三视图","voiceLanguage":"正文未明确","voiceAge":"正文未明确","voiceTimbre":"正文未明确"}]}`
	if err := validateCharacterExtractResult(payload); err != nil {
		t.Fatal(err)
	}
}
