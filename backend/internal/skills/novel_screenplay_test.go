package skills

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNovelScreenplayPreservesCompleteProvidedInstructions(t *testing.T) {
	_, original, ok := strings.Cut(novelScreenplayInstruction, "# 原始小说拆解与剧本改编规则\n\n")
	if !ok || fmt.Sprintf("%x", sha256.Sum256([]byte(strings.TrimSpace(original)))) != "770d4cecddeee65a248348c450f00710fa4dacf909fa0fbd56009e035658f131" {
		t.Fatal("provided adaptation instructions were truncated or changed")
	}
}

func TestNovelScreenplayInstalledAndPreservedAcrossStartup(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	for cycle := 0; cycle < 2; cycle++ {
		if err := svc.EnsureBuiltinSkills(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureSkillPackages(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureBuiltinSkillsAdded("local"); err != nil {
			t.Fatal(err)
		}
		var stored model.Skill
		if err := db.First(&stored, "id = ?", NovelScreenplaySkillID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Instruction != strings.TrimSpace(novelScreenplayInstruction) || stored.CurrentVersionID == "" || stored.Tag != "drama" || stored.Name != "小说拆解剧本" {
			t.Fatal("novel skill was not stored as a complete usable package")
		}
		state, err := repository.New(db).UserSkillState("local", NovelScreenplaySkillID)
		if err != nil || state == nil || !state.Added {
			t.Fatalf("novel skill was not installed: %v", err)
		}
		assertSkillVersionCount(t, db, NovelScreenplaySkillID, 1)
	}
}
