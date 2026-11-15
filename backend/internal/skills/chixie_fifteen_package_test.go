package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChixieFifteenPackageInstallsWithoutReplacingOriginal(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	read := func(directory string) map[string]string {
		t.Helper()
		files := make(map[string]string)
		for _, name := range []string{"SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"} {
			content, err := os.ReadFile(filepath.Join("..", "..", "..", "skill-packages", "short-drama-editing", directory, filepath.FromSlash(name)))
			if err != nil {
				t.Fatal(err)
			}
			files[name] = string(content)
		}
		return files
	}
	original := installAgentSkill(t, svc, read("chixie-rusong-plus-v2"))
	var bundled *bundledSkillPackage
	for index := range bundledSkillPackages {
		if bundledSkillPackages[index].Directory == "chixie-rusong-plus-v2-15s" {
			bundled = &bundledSkillPackages[index]
		}
	}
	if bundled == nil {
		t.Fatal("15s skill is missing from bundled installation registry")
	}
	root := t.TempDir()
	category := filepath.Join(root, bundled.Category)
	if err := os.MkdirAll(category, 0700); err != nil {
		t.Fatal(err)
	}
	files := read(bundled.Directory)
	if err := os.WriteFile(filepath.Join(category, bundled.Directory+".zip"), skillZip(t, files), 0600); err != nil {
		t.Fatal(err)
	}
	archive, err := readBundledSkillArchive(root, *bundled)
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Version != "2.3.0" {
		t.Fatalf("unexpected 15s package version: %s", archive.Metadata.Version)
	}
	installed, err := svc.createSkillFromArchive("owner", archive, SkillInstallRequest{Name: bundled.DisplayName, Tag: "drama"}, "zip", "", "", bundled.Category+"/"+bundled.Directory, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if installed.SkillID == original.SkillID || !installed.IsAdded || installed.SkillName != "持械入宋plus第二版·15秒起落2.3" {
		t.Fatalf("invalid independent skill: %#v", installed)
	}
	for name, expected := range files {
		actual, err := svc.SkillPackageFile("owner", installed.SkillID, name)
		if err != nil || actual.Content != expected {
			t.Fatalf("15s skill file changed during installation: %s %v", name, err)
		}
	}
	unchanged, err := svc.SkillDetail("owner", original.SkillID)
	if err != nil || unchanged.VersionID != original.VersionID || unchanged.ContentHash != original.ContentHash {
		t.Fatalf("original skill was replaced: %v", err)
	}
}
