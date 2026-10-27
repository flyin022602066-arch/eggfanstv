package skills

import (
	"archive/zip"
	"bytes"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestArchiveFromMarkdownInfersMetadata(t *testing.T) {
	archive, err := archiveFromMarkdown([]byte("# 小说转分镜\n\n把小说段落拆成可拍摄的镜头。\n"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Name != "小说转分镜" || archive.Metadata.Description != "把小说段落拆成可拍摄的镜头。" {
		t.Fatalf("metadata = %#v", archive.Metadata)
	}
	if string(archive.Files["SKILL.md"]) == "" || archive.ContentHash == "" {
		t.Fatal("archive did not preserve the entry file or compute a hash")
	}
}

func TestBuiltinVideoGenerationGuidancePreservesOriginalEntry(t *testing.T) {
	definitions, err := builtinSkillDefinitions()
	if err != nil {
		t.Fatal(err)
	}
	for _, definition := range definitions {
		if definition.SkillID != "14811816982540" && definition.SkillID != "14889899551756" && definition.SkillID != "14889899552012" {
			continue
		}
		t.Run(definition.SkillName, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
				t.Fatal(err)
			}
			skill := model.Skill{ID: definition.SkillID, Name: definition.SkillName, Description: definition.Description, Instruction: definition.Instruction, Status: skillStatusEnabled, Source: 3}
			if err := db.Create(&skill).Error; err != nil {
				t.Fatal(err)
			}
			svc := New(repository.New(db), t.TempDir(), nil)
			if err := svc.EnsureSkillPackages(); err != nil {
				t.Fatal(err)
			}
			var refreshed model.Skill
			if err := db.First(&refreshed, "id = ?", skill.ID).Error; err != nil {
				t.Fatal(err)
			}
			var version model.SkillVersion
			if err := db.First(&version, "id = ?", refreshed.CurrentVersionID).Error; err != nil {
				t.Fatal(err)
			}
			guide, err := svc.readSkillArchiveEntry(&version, "references/video-generation.md")
			if err != nil || len(guide) == 0 || len(guide) > 2500 {
				t.Fatalf("missing or oversized video guidance: bytes=%d err=%v", len(guide), err)
			}
			entry, err := svc.readSkillArchiveEntry(&version, "SKILL.md")
			if err != nil || string(entry) != definition.Instruction {
				t.Fatal("original Agent skill was changed")
			}
			if err := svc.EnsureSkillPackages(); err != nil {
				t.Fatal(err)
			}
			assertSkillVersionCount(t, db, skill.ID, 1)
		})
	}
}

func TestArchiveFromZipNormalizesWrapperAndNestedFiles(t *testing.T) {
	data := skillZip(t, map[string]string{
		"director-main/SKILL.md":             "---\nname: AI 导演\ndescription: 导演工作流\nmetadata:\n  version: 2.1\n---\n",
		"director-main/references/camera.md": "# Camera",
		"director-main/scripts/check.js":     "export default true",
	})
	archive, err := archiveFromZip(data, "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Version != "2.1" || len(archive.Files) != 3 {
		t.Fatalf("archive = %#v", archive)
	}
	if string(archive.Files["references/camera.md"]) != "# Camera" {
		t.Fatalf("nested file missing: %#v", archive.Files)
	}
}

func TestArchiveFromZipRejectsTraversalAndMultipleSkills(t *testing.T) {
	for name, files := range map[string]map[string]string{
		"traversal": {"../SKILL.md": "# Bad"},
		"multiple": {
			"one/SKILL.md": "# One\n\nFirst",
			"two/SKILL.md": "# Two\n\nSecond",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := archiveFromZip(skillZip(t, files), ""); err == nil {
				t.Fatal("expected package validation error")
			}
		})
	}
}

func TestParseGitHubSkillURL(t *testing.T) {
	spec, err := parseGitHubSkillURL("https://github.com/example/beeftv-skills/tree/main/skills/canvas-context", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Owner != "example" || spec.Repo != "beeftv-skills" || spec.Ref != "main" || spec.Subdir != "skills/canvas-context" {
		t.Fatalf("spec = %#v", spec)
	}
	if _, err := parseGitHubSkillURL("https://github.com/example/beeftv-skills/blob/main/SKILL.md", "", ""); err == nil {
		t.Fatal("expected blob URL to be rejected")
	}
}

func TestEnsureSkillPackagesMigratesAndRefreshesBuiltinSkills(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	builtin := model.Skill{ID: kernel.NewID(), Name: "内置导演", Description: "内置工作流", Instruction: "# 内置导演\n\n第一版", Status: skillStatusEnabled, Source: 3}
	userSkill := model.Skill{ID: kernel.NewID(), Name: "用户技能", Description: "用户工作流", Instruction: "# 用户技能\n\n第一版", Status: skillStatusEnabled, Source: skillSourceUser}
	if err := db.Create(&builtin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&userSkill).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := db.Model(&model.Skill{}).Where("id = ?", builtin.ID).Update("instruction", "# 内置导演\n\n第二版").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", userSkill.ID).Update("instruction", "# 用户技能\n\n不应在启动时重建").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 2)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	var refreshed model.Skill
	if err := db.First(&refreshed, "id = ?", builtin.ID).Error; err != nil {
		t.Fatal(err)
	}
	wantArchive, err := archiveFromMarkdown([]byte(refreshed.Instruction), refreshed.Name, refreshed.Description)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.ContentHash != wantArchive.ContentHash || refreshed.CurrentVersionID == "" {
		t.Fatalf("builtin package was not refreshed: %#v", refreshed)
	}
}

func TestEnsureBuiltinSkillStatesAddsMissingWithoutResetting(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}); err != nil {
		t.Fatal(err)
	}
	builtinAdded := model.Skill{ID: kernel.NewID(), Name: "内置一", Description: "内置技能", Instruction: "# 一", CurrentVersionID: "version-1", Status: skillStatusEnabled, Source: 3}
	builtinRemoved := model.Skill{ID: kernel.NewID(), Name: "内置二", Description: "内置技能", Instruction: "# 二", CurrentVersionID: "version-2", Status: skillStatusEnabled, Source: 3}
	userSkill := model.Skill{ID: kernel.NewID(), Name: "用户技能", Description: "用户技能", Instruction: "# 用户", Status: skillStatusEnabled, Source: skillSourceUser}
	if err := db.Create(&[]model.Skill{builtinAdded, builtinRemoved, userSkill}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserSkillState{ID: kernel.NewID(), UserID: "local", SkillID: builtinRemoved.ID, Added: false}).Error; err != nil {
		t.Fatal(err)
	}

	if err := repository.New(db).EnsureBuiltinSkillStates("local", skillSourceUser); err != nil {
		t.Fatal(err)
	}
	added, err := repository.New(db).UserSkillState("local", builtinAdded.ID)
	if err != nil {
		t.Fatal(err)
	}
	if added == nil || !added.Added || added.InstalledVersionID != builtinAdded.CurrentVersionID {
		t.Fatalf("missing builtin state = %#v", added)
	}
	removed, err := repository.New(db).UserSkillState("local", builtinRemoved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if removed == nil || removed.Added {
		t.Fatalf("existing removal was reset = %#v", removed)
	}
	userState, err := repository.New(db).UserSkillState("local", userSkill.ID)
	if err != nil {
		t.Fatal(err)
	}
	if userState != nil {
		t.Fatalf("user skill unexpectedly added = %#v", userState)
	}
}

func assertSkillVersionCount(t *testing.T, db *gorm.DB, skillID string, want int64) {
	t.Helper()
	var got int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", skillID).Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("skill %s version count = %d, want %d", skillID, got, want)
	}
}

func skillZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for filePath, content := range files {
		entry, err := writer.Create(filePath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
