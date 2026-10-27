package prompts

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCharacterReferenceSheetRulesSurviveSavedPrompts(t *testing.T) {
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
			for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract, OperationCharacterTurnaround} {
				if mode != "default" {
					if err := repo.SavePromptTemplate(&model.PromptTemplate{ID: operation, Operation: operation, Name: "已保存模板", Version: 1, Enabled: true, Content: "三个全身视角，完整显示头顶到脚底。保留银色腰带。"}); err != nil {
						t.Fatal(err)
					}
				}
				if mode == promptCustomizationAppend || mode == promptCustomizationRewrite {
					if err := repo.SaveUserPromptCustomization(&model.UserPromptCustomization{ID: operation, UserID: "test-user", Operation: operation, Mode: mode, Content: "保留银色腰带。"}); err != nil {
						t.Fatal(err)
					}
				}
				compiled, err := service.CompilePrompt("test-user", operation, map[string]string{
					"角色名称": "角色甲", "角色设定": "青色长袍，旧要求为全身三视图。", "项目画风": "水墨画风", "章节正文": "角色甲走进院子。",
				})
				if err != nil {
					t.Fatal(err)
				}
				for _, required := range []string{"独立头部特写", "正面、右侧面、背面", "颈部以下至脚底", "三视图区不得出现头部", "以本规则为准", "水墨画风"} {
					if !strings.Contains(compiled.Content, required) {
						t.Errorf("%s prompt missing %q", operation, required)
					}
				}
				if mode != "default" && !strings.Contains(compiled.Content, "保留银色腰带") {
					t.Errorf("%s lost supplementary character details", operation)
				}
				if operation != OperationCharacterTurnaround && (!strings.Contains(compiled.Content, "multiViewPrompt") || !strings.Contains(compiled.Content, "角色甲走进院子")) {
					t.Errorf("%s lost extraction contract or chapter", operation)
				}
				if operation == OperationCharacterTurnaround && !strings.Contains(compiled.Content, "青色长袍") {
					t.Error("turnaround lost confirmed character definition")
				}
			}
		})
	}
}
