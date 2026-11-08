package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCinematicMasterPackagesPreserveOriginalAndEachOther(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	read := func(directory string, specialist string) map[string]string {
		t.Helper()
		paths := []string{"SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"}
		if specialist != "" {
			paths = append(paths, specialist)
		}
		files := make(map[string]string)
		for _, path := range paths {
			body, err := os.ReadFile(filepath.Join("..", "..", "..", "skill-packages", "short-drama-editing", directory, filepath.FromSlash(path)))
			if err != nil {
				t.Fatal(err)
			}
			files[path] = string(body)
		}
		return files
	}
	originalFiles := read("chixie-rusong-plus-v2", "")
	original := installAgentSkill(t, svc, originalFiles)
	blockingFiles := read("chixie-rusong-plus-v2-blocking", "references/spatial-continuity.md")
	blocking := installAgentSkill(t, svc, blockingFiles)
	installed := []Pin{original, blocking}
	for _, spec := range []struct{ directory, reference string }{
		{"chixie-rusong-action-master", "references/action-direction.md"},
		{"chixie-rusong-fantasy-vfx-master", "references/fantasy-vfx-direction.md"},
	} {
		files := read(spec.directory, spec.reference)
		if files["references/director-optics-dialogue.md"] != originalFiles["references/director-optics-dialogue.md"] {
			t.Fatal("protected directing guide was not fully inherited")
		}
		_, originalVideo, _ := strings.Cut(originalFiles["references/video-generation.md"], "\n")
		if !strings.Contains(files["references/video-generation.md"], strings.TrimSpace(originalVideo)) {
			t.Fatal("protected video rules were omitted")
		}
		pin := installAgentSkill(t, svc, files)
		for _, previous := range installed {
			if pin.SkillID == previous.SkillID || pin.VersionID == previous.VersionID {
				t.Fatal("independent skill reused an existing identity")
			}
		}
		detail, err := svc.SkillDetail("owner", pin.SkillID)
		if err != nil || detail.Version != "1.0.0" || detail.FileCount != 4 || !detail.IsAdded {
			t.Fatalf("invalid installed skill: %#v %v", detail, err)
		}
		for path, expected := range files {
			actual, err := svc.AgentFile("owner", pin, path)
			if err != nil || actual.Content != expected {
				t.Fatalf("installed content differs: %s %v", path, err)
			}
		}
		if _, err := svc.SkillDetail("other-user", pin.SkillID); err == nil {
			t.Fatal("private package exposed to another user")
		}
		installed = append(installed, pin)
	}
	for pin, files := range map[Pin]map[string]string{original: originalFiles, blocking: blockingFiles} {
		current, err := svc.SkillDetail("owner", pin.SkillID)
		if err != nil || current.VersionID != pin.VersionID || current.ContentHash != pin.ContentHash {
			t.Fatalf("protected current version changed: %v", err)
		}
		for path, expected := range files {
			actual, err := svc.AgentFile("owner", pin, path)
			if err != nil || actual.Content != expected {
				t.Fatalf("protected historical content changed: %s %v", path, err)
			}
		}
	}
	added, err := svc.AddedSkills("owner")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, item := range added {
		seen[item.SkillID] = true
	}
	for _, pin := range installed {
		if !seen[pin.SkillID] {
			t.Fatal("installed skill missing from library")
		}
	}
}
