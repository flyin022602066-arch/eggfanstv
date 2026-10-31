package skills

import (
	"strings"
	"testing"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestThirtySecondBuiltinSkillsSyncAndLoadWithoutShortClipLimits(t *testing.T) {
	definitions, err := storyboard30SkillDefinitions()
	if err != nil {
		t.Fatal(err)
	}
	if len(definitions) != 5 {
		t.Fatalf("30-second skill count = %d, want 5", len(definitions))
	}
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := New(repo, t.TempDir(), nil)
	for repeat := 0; repeat < 2; repeat++ {
		if err := svc.EnsureBuiltinSkills(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureSkillPackages(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureBuiltinSkillsAdded("local"); err != nil {
			t.Fatal(err)
		}
	}
	for _, definition := range definitions {
		t.Run(definition.SkillName, func(t *testing.T) {
			if skillHas15SecondLimit(definition.SkillName, definition.Description, definition.Instruction) {
				t.Fatal("30-second skill was marked as limited to short clips")
			}
			if utf8.RuneCountInString(definition.Instruction) > 8000 {
				t.Fatal("skill cannot be loaded completely with four skills selected")
			}
			var skill model.Skill
			if err := db.First(&skill, "id = ?", definition.SkillID).Error; err != nil {
				t.Fatal(err)
			}
			state, err := repo.UserSkillState("local", skill.ID)
			if err != nil || state == nil || !state.Added || state.InstalledVersionID != skill.CurrentVersionID {
				t.Fatalf("skill not available to the picker: state=%#v err=%v", state, err)
			}
			var version model.SkillVersion
			if err := db.First(&version, "id = ?", skill.CurrentVersionID).Error; err != nil {
				t.Fatal(err)
			}
			entry, err := svc.readSkillArchiveEntry(&version, "SKILL.md")
			if err != nil || string(entry) != definition.Instruction {
				t.Fatalf("packaged instruction does not match the definition: %v", err)
			}
			for _, rule := range []string{"durationSeconds 为30", "镜头1 / 镜头2 / 镜头3", "起幅：", "→ 落幅：", "关闭限制时不额外增加对白字数门槛", "600字符目标仅约束附录", "系统播报"} {
				if !strings.Contains(string(entry), rule) {
					t.Fatalf("packaged skill lost its shared contract: %s", rule)
				}
			}
			assertSkillVersionCount(t, db, skill.ID, 1)
		})
	}
}
