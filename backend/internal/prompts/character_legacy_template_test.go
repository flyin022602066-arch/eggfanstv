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

func TestSavedLegacyCharacterTemplateUsesCurrentLayout(t *testing.T) {
	const saved = "制作专业人物三视图设定表。画面严格分成三个等宽竖向区域，从左到右依次为正面全身、右侧面全身、背面全身。三个视角必须是同一角色、同一服装、同一发型、同一体型和同一比例，采用站立中性姿势，完整显示头顶到脚底。背景使用纯净中性浅色和均匀设定稿光线，只负责分离轮廓，不得改变项目画风的绘画或渲染媒介。禁止文字、边框、道具说明、表情变化和额外人物。"
	for _, characterType := range []string{"group", "individual"} {
		t.Run(characterType, func(t *testing.T) {
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
			if err := repo.SavePromptTemplate(&model.PromptTemplate{ID: "legacy", Operation: OperationCharacterTurnaround, Name: "默认角色三视图模板", Version: 1, Enabled: true, Content: saved}); err != nil {
				t.Fatal(err)
			}
			if err := repo.SaveUserPromptCustomization(&model.UserPromptCustomization{ID: "supplement", UserID: "user", Operation: OperationCharacterTurnaround, Mode: promptCustomizationAppend, Content: "保留深灰工装，手套橙色"}); err != nil {
				t.Fatal(err)
			}
			compiled, err := New(repo, nil).CompilePrompt("user", OperationCharacterTurnaround, map[string]string{"角色名称": "押运员", "角色类型": characterType, "角色设定": "4名不同个体同框，深灰工装", "项目画风": "欧美真人实拍"})
			if err != nil {
				t.Fatal(err)
			}
			for _, obsolete := range []string{"三个等宽竖向区域", "完整显示头顶到脚底"} {
				if strings.Contains(compiled.Content, obsolete) {
					t.Errorf("obsolete instruction remains: %s", obsolete)
				}
			}
			if characterType == "group" {
				if !strings.Contains(compiled.Content, characterkind.GroupDesignRule) {
					t.Error("group rule missing")
				}
				if strings.Contains(compiled.Content, "禁止文字、边框、道具说明、表情变化和额外人物") {
					t.Error("single-person exclusion remains in group prompt")
				}
			} else if !strings.Contains(compiled.Content, characterReferenceSheetLayout) {
				t.Error("individual reference layout missing")
			}
			if !strings.Contains(compiled.Content, "保留深灰工装，手套橙色") {
				t.Error("user customization lost")
			}
			template, err := repo.ActivePromptTemplate(OperationCharacterTurnaround)
			if err != nil {
				t.Fatal(err)
			}
			if template.Content != saved {
				t.Error("runtime compilation must not overwrite saved preferences")
			}
		})
	}
}

func TestCharacterTemplateRepairPreservesManualTemplates(t *testing.T) {
	for _, fixture := range []struct {
		name      string
		content   string
		createdBy string
	}{
		{name: "manually-created", content: legacyCharacterTurnaroundTemplate, createdBy: "author"},
		{name: "edited-builtin", content: legacyCharacterTurnaroundTemplate + "保留铜扣腰带。"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
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
			if err := repo.SavePromptTemplate(&model.PromptTemplate{ID: "manual", Operation: OperationCharacterTurnaround, Name: "人工模板", Version: 1, Enabled: true, Content: fixture.content, CreatedBy: fixture.createdBy}); err != nil {
				t.Fatal(err)
			}
			compiled, err := New(repo, nil).CompilePrompt("user", OperationCharacterTurnaround, map[string]string{"角色名称": "群体", "角色类型": "group", "角色设定": "3位不同面孔的押运员", "项目画风": "真人实拍"})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(compiled.Content, fixture.content) {
				t.Error("manual template was replaced")
			}
			if !strings.HasSuffix(compiled.Content, characterkind.GroupDesignRule) {
				t.Error("group protected context missing")
			}
		})
	}
}
