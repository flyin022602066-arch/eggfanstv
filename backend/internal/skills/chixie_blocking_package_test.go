package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChixieBlockingUploadPreservesOriginal(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	read := func(directory string, paths []string) map[string]string {
		t.Helper()
		files := make(map[string]string)
		for _, path := range paths {
			data, err := os.ReadFile(filepath.Join("..", "..", "..", "skill-packages", "short-drama-editing", directory, filepath.FromSlash(path)))
			if err != nil {
				t.Fatal(err)
			}
			files[path] = string(data)
		}
		return files
	}
	paths := []string{"SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"}
	originalFiles := read("chixie-rusong-plus-v2", paths)
	original := installAgentSkill(t, svc, originalFiles)
	newFiles := read("chixie-rusong-plus-v2-blocking", append(paths, "references/spatial-continuity.md"))
	installed := installAgentSkill(t, svc, newFiles)
	if installed.SkillID == original.SkillID || installed.VersionID == original.VersionID {
		t.Fatal("new skill reused original identity")
	}
	detail, err := svc.SkillDetail("owner", installed.SkillID)
	if err != nil || detail.Version != "2.4.1" || detail.FileCount != 4 || !detail.IsAdded {
		t.Fatalf("invalid installed package: %#v %v", detail, err)
	}
	for path, expected := range newFiles {
		actual, err := svc.AgentFile("owner", installed, path)
		if err != nil || actual.Content != expected {
			t.Fatalf("new file changed: %s %v", path, err)
		}
	}
	for path, expected := range originalFiles {
		actual, err := svc.AgentFile("owner", original, path)
		if err != nil || actual.Content != expected {
			t.Fatalf("original file changed: %s %v", path, err)
		}
	}
	unchanged, err := svc.SkillDetail("owner", original.SkillID)
	if err != nil || unchanged.VersionID != original.VersionID || unchanged.ContentHash != original.ContentHash {
		t.Fatalf("original version changed: %#v %v", unchanged, err)
	}
	added, err := svc.AddedSkills("owner")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, item := range added {
		seen[item.SkillID] = true
	}
	if !seen[original.SkillID] || !seen[installed.SkillID] {
		t.Fatal("original or new skill missing from library")
	}
	if _, err := svc.SkillDetail("other-user", installed.SkillID); err == nil {
		t.Fatal("private upload accessible by another user")
	}
}
