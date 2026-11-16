package prompts

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/characterkind"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCharacterReferenceTemplateSelection(t *testing.T) {
	seen := map[string]bool{}
	for _, layout := range characterReferenceTemplates.Layouts {
		if seen[layout.ID] || layout.ID == "" || layout.Name == "" || layout.Prompt == "" {
			t.Fatal("invalid or duplicate built-in character layout")
		}
		seen[layout.ID] = true
		for _, design := range characterReferenceTemplates.Designs {
			values := map[string]string{"角色名称": "角色甲", "角色设定": "红袍，保留左眼泪痣，卸除旧护甲", "项目画风": "水墨动画", "角色参考图格式": layout.ID, "角色形象模板": design.ID}
			content := protectedPromptContext(OperationCharacterTurnaround, values)
			for _, required := range []string{values["角色设定"], "水墨动画", design.Prompt} {
				if !strings.Contains(content, required) {
					t.Errorf("%s/%s missing %q", layout.ID, design.ID, required)
				}
			}
			if !strings.HasSuffix(content, layout.Prompt) {
				t.Errorf("%s is not the final protected layout", layout.ID)
			}
			for _, other := range characterReferenceTemplates.Layouts {
				if other.ID != layout.ID && strings.Contains(content, other.Prompt) {
					t.Errorf("conflicting layout %s leaked into %s", other.ID, layout.ID)
				}
			}
		}
	}
	if characterGenerationLayout(nil) != characterReferenceTemplates.Layouts[0].Prompt || characterGenerationLayout(map[string]string{"角色参考图格式": "missing"}) != characterGenerationLayout(nil) {
		t.Fatal("missing selection must use the supplied portrait/body grid")
	}
}

func TestCharacterTemplateSelectionPreservesGroupAndSystemRules(t *testing.T) {
	for _, layout := range characterReferenceTemplates.Layouts {
		values := map[string]string{"角色名称": "村民们", "角色类型": "group", "角色设定": "多人穿粗布衣", "角色参考图格式": layout.ID, "角色形象模板": "distinct-domestic-realistic"}
		content := protectedPromptContext(OperationCharacterTurnaround, values)
		if !strings.HasSuffix(content, characterkind.GroupDesignRule) || strings.Contains(content, layout.Prompt) || strings.Contains(content, "所选角色形象模板") {
			t.Fatal("individual template leaked into group design")
		}
		values["角色类型"] = "individual"
		values["角色设定"] = "【拟人化系统角色】小狐狸，蓝色尾尖"
		content = protectedPromptContext(OperationCharacterTurnaround, values)
		if !strings.HasSuffix(content, systemCharacterReferenceSheetLayout) || strings.Contains(content, layout.Prompt) {
			t.Fatal("human cropping overrode the system character shape")
		}
	}
}

func TestChapterExtractionUsesSelectedCharacterDesignWithoutChangingContracts(t *testing.T) {
	layout := characterReferenceTemplates.Layouts[1]
	content := protectedPromptContext(OperationChapterAssetsExtract, map[string]string{"角色参考图格式": layout.ID, "角色形象模板": "gpt-image-natural", "章节正文": "甲与三师傅在门口。"})
	for _, required := range []string{layout.Prompt, "自然语言长句", characterExtractionPresenceRule, characterExtractionLookRule, chapterPropSelectionRule, ChapterAssetsJSONSchema, "三师傅"} {
		if !strings.Contains(content, required) {
			t.Errorf("extraction lost %q", required)
		}
	}
}

func TestStandaloneExtractionUsesSelectedCharacterTemplates(t *testing.T) {
	layout := characterReferenceTemplates.Layouts[4]
	content := protectedPromptContext(OperationCharacterExtract, map[string]string{"角色参考图格式": layout.ID, "角色形象模板": "distinct-2d-animation", "章节正文": "陈尧与三师傅在门口。"})
	for _, required := range []string{layout.Prompt, "国产二维动画", characterExtractionPresenceRule, characterExtractionLookRule, "三师傅"} {
		if !strings.Contains(content, required) {
			t.Errorf("standalone extraction lost %q", required)
		}
	}
	if strings.Contains(content, legacyHeadThreeBodyLayout) {
		t.Fatal("legacy layout overrode selected extraction layout")
	}
}

func TestSelectedCharacterTemplatesSurviveSavedCustomization(t *testing.T) {
	for _, mode := range []string{promptCustomizationInherit, promptCustomizationAppend, promptCustomizationRewrite} {
		t.Run(mode, func(t *testing.T) {
			database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			connection, err := database.DB()
			if err != nil {
				t.Fatal(err)
			}
			connection.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = connection.Close() })
			if err := database.AutoMigrate(&model.PromptTemplate{}, &model.UserPromptCustomization{}); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(database)
			service := New(repo, nil)
			selected := characterReferenceTemplates.Layouts[4]
			for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract, OperationCharacterTurnaround} {
				if err := repo.SavePromptTemplate(&model.PromptTemplate{ID: operation, Operation: operation, Name: "已保存模板", Version: 1, Enabled: true, Content: legacyHeadThreeBodyLayout + "保留铜扣腰带。", CreatedBy: "author"}); err != nil {
					t.Fatal(err)
				}
				if mode != promptCustomizationInherit {
					if err := repo.SaveUserPromptCustomization(&model.UserPromptCustomization{ID: operation, UserID: "fixture", Operation: operation, Mode: mode, Content: "保留铜扣腰带。"}); err != nil {
						t.Fatal(err)
					}
				}
				compiled, err := service.CompilePrompt("fixture", operation, map[string]string{"角色名称": "角色甲", "角色设定": "水墨红袍", "项目画风": "水墨动画", "章节正文": "角色甲走进院子。", "角色参考图格式": selected.ID, "角色形象模板": "distinct-2d-animation"})
				if err != nil {
					t.Fatal(err)
				}
				protectedAt := strings.LastIndex(compiled.Content, "【人物设定图固定规则】")
				if protectedAt < 0 || !strings.Contains(compiled.Content[protectedAt:], selected.Prompt) || strings.Contains(compiled.Content[protectedAt:], legacyHeadThreeBodyLayout) {
					t.Fatalf("%s lost the selected final layout under %s", operation, mode)
				}
				for _, required := range []string{"保留铜扣腰带", "国产二维动画", "水墨动画"} {
					if !strings.Contains(compiled.Content, required) {
						t.Fatalf("%s lost %q", operation, required)
					}
				}
			}
		})
	}
}
