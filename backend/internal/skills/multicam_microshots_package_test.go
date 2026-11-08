package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMulticamMicroshotsPackageIsIndependentAndReadable(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	install := func(category, directory, display string, names []string) *SkillItem {
		t.Helper()
		files := make(map[string]string)
		for _, name := range names {
			content, err := os.ReadFile(filepath.Join("..", "..", "..", "skill-packages", category, directory, filepath.FromSlash(name)))
			if err != nil {
				t.Fatal(err)
			}
			files[directory+"/"+name] = string(content)
		}
		archive, err := archiveFromZip(skillZip(t, files), "")
		if err != nil {
			t.Fatal(err)
		}
		version := "1.0.0"
		if directory == "chixie-rusong-v1" {
			version = "1.1.0"
		} else if directory == "chixie-rusong-plus-v2" {
			version = "2.3.2"
		}
		if archive.Metadata.Name != directory || archive.Metadata.Version != version {
			t.Fatalf("unexpected package metadata: %#v", archive.Metadata)
		}
		installed, err := svc.createSkillFromArchive("owner", archive, SkillInstallRequest{Name: display, Tag: "drama", IsPrivate: true}, "zip", "", "", "", "", false)
		if err != nil {
			t.Fatal(err)
		}
		if !installed.IsAdded || !installed.IsOwner || !installed.IsPrivate || installed.FileCount != len(names) || installed.ContentHash != archive.ContentHash {
			t.Fatalf("incorrect installed package: %#v", installed)
		}
		for name, expected := range archive.Files {
			actual, err := svc.SkillPackageFile("owner", installed.SkillID, name)
			if err != nil || actual.Binary || actual.Content != string(expected) {
				t.Fatalf("file %s differs after installation: %v", name, err)
			}
		}
		return installed
	}
	original := install("novel-adaptation", "advanced-novel-screenplay", "高级小说拆解与短剧编剧", []string{"SKILL.md", "references/novel-screenplay-spec.md"})
	created := install("short-drama-editing", "short-drama-multicam-microshots", "高级短剧分镜·30秒段内多机位快切", []string{"SKILL.md", "references/microshot-direction.md", "references/video-generation.md"})
	firstEdition := install("short-drama-editing", "chixie-rusong-v1", "持械入宋第一版", []string{"SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"})
	plusEdition := install("short-drama-editing", "chixie-rusong-plus-v2", "持械入宋plus第二版", []string{"SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"})
	entry, err := svc.SkillPackageFile("owner", plusEdition.SkillID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range []string{"不依赖第一版或其他技能", "同句的不同话轮", "普通动作、环境与心理叙述不自动变成OS/VO", "同地点的后续单元也重复绑定", "characterVersionId", "六项分工、不互相复述"} {
		if !strings.Contains(entry.Content, rule) {
			t.Fatalf("standalone skill rule missing: %s", rule)
		}
	}
	if plusEdition.SkillID == firstEdition.SkillID || plusEdition.SkillID == created.SkillID || plusEdition.SkillID == original.SkillID {
		t.Fatal("plus edition reused a preexisting skill identity")
	}
	previousFirstEdition, err := svc.SkillDetail("owner", firstEdition.SkillID)
	if err != nil || previousFirstEdition.VersionID != firstEdition.VersionID || previousFirstEdition.ContentHash != firstEdition.ContentHash {
		t.Fatalf("first edition changed: %#v %v", previousFirstEdition, err)
	}
	if firstEdition.SkillID == created.SkillID || firstEdition.SkillID == original.SkillID {
		t.Fatal("first edition reused a preexisting skill identity")
	}
	previous, err := svc.SkillDetail("owner", created.SkillID)
	if err != nil || previous.VersionID != created.VersionID || previous.ContentHash != created.ContentHash {
		t.Fatalf("microshot skill changed: %#v %v", previous, err)
	}
	if created.SkillID == original.SkillID || created.VersionID == original.VersionID {
		t.Fatal("new skill reused the original skill identity")
	}
	unchanged, err := svc.SkillDetail("owner", original.SkillID)
	if err != nil || unchanged.SkillName != original.SkillName || unchanged.VersionID != original.VersionID || unchanged.ContentHash != original.ContentHash {
		t.Fatalf("original skill changed: %#v %v", unchanged, err)
	}
	added, err := svc.AddedSkills("owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []*SkillItem{original, created, firstEdition, plusEdition} {
		found := false
		for _, item := range added {
			found = found || item.SkillID == expected.SkillID
		}
		if !found {
			t.Fatalf("skill missing from added list: %s", expected.SkillName)
		}
	}
	if _, err := svc.SkillDetail("other-user", created.SkillID); err == nil {
		t.Fatal("private new skill leaked to another user")
	}
}
