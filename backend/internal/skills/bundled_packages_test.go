package skills

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type bundledPackageFixture struct {
	Directory   string
	DisplayName string
	Tag         string
	Archive     skillPackageArchive
}

func TestBundledSkillsStartup(t *testing.T) {
	if os.Getenv("BEEFTV_BUNDLED_SKILLS_TEST_CHILD") != "1" {
		executable, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		content, err := os.ReadFile(executable)
		if err != nil {
			t.Fatal(err)
		}
		releaseDir := t.TempDir()
		childExecutable := filepath.Join(releaseDir, filepath.Base(executable))
		if err := os.WriteFile(childExecutable, content, 0o700); err != nil {
			t.Fatal(err)
		}
		stageBundledSkillPackages(t, filepath.Join(releaseDir, "skill-packages"))
		command := exec.Command(childExecutable, "-test.run=^TestBundledSkillsStartup$", "-test.v")
		command.Dir = t.TempDir()
		command.Env = append(os.Environ(), "BEEFTV_BUNDLED_SKILLS_TEST_CHILD=1")
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("external-install startup failed: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	packageRoot := filepath.Join(filepath.Dir(executable), "skill-packages")
	packages := readBundledSkillFixtures(t, packageRoot)

	t.Run("fresh_install_and_restart", func(t *testing.T) {
		svc, db := agentSkillFixture(t)
		initializeBundledSkills(t, svc, "owner")
		var originalCount int64
		if err := db.Model(&model.Skill{}).Count(&originalCount).Error; err != nil {
			t.Fatal(err)
		}
		versions := make(map[string]string)
		for _, item := range packages {
			installed := requireBundledSkill(t, svc, "owner", item)
			versions[installed.SkillID] = installed.VersionID
		}
		reopened := New(repository.New(db), svc.dataDir, nil)
		initializeBundledSkills(t, reopened, "owner")
		var restartedCount int64
		if err := db.Model(&model.Skill{}).Count(&restartedCount).Error; err != nil {
			t.Fatal(err)
		}
		if restartedCount != originalCount {
			t.Fatalf("restart duplicated skills: before=%d after=%d", originalCount, restartedCount)
		}
		for _, item := range packages {
			installed := requireBundledSkill(t, reopened, "owner", item)
			if versions[installed.SkillID] != installed.VersionID {
				t.Fatalf("restart replaced the version for %s", item.Directory)
			}
			assertSkillVersionCount(t, db, installed.SkillID, 1)
		}
		first := requireBundledSkill(t, reopened, "owner", packages[0])
		stored, err := reopened.ownedSkill("owner", first.SkillID)
		if err != nil {
			t.Fatal(err)
		}
		stored.Name = "Customized default"
		stored.Instruction = "# My custom entry\n\nKeep my own workflow."
		if err := reopened.repo.SaveSkill(stored); err != nil {
			t.Fatal(err)
		}
		initializeBundledSkills(t, reopened, "owner")
		preserved, err := reopened.ownedSkill("owner", first.SkillID)
		if err != nil || preserved.Name != stored.Name || preserved.Instruction != stored.Instruction || preserved.CurrentVersionID != stored.CurrentVersionID {
			t.Fatalf("bundled identity did not preserve customization: %#v %v", preserved, err)
		}
		var customizedCount int64
		if err := db.Model(&model.Skill{}).Count(&customizedCount).Error; err != nil || customizedCount != originalCount {
			t.Fatalf("customization produced a duplicate: count=%d want=%d err=%v", customizedCount, originalCount, err)
		}
	})

	t.Run("upgrade_preserves_user_packages", func(t *testing.T) {
		svc, db := agentSkillFixture(t)
		manualPackage := packages[0]
		manual, err := svc.createSkillFromArchive("owner", manualPackage.Archive, SkillInstallRequest{Name: manualPackage.DisplayName, Tag: manualPackage.Tag, IsPrivate: true}, "zip", "", "", "", "", false)
		if err != nil {
			t.Fatal(err)
		}
		customPackage := packages[1]
		customFiles := make(map[string][]byte)
		for name, content := range customPackage.Archive.Files {
			customFiles[name] = content
		}
		customFiles["SKILL.md"] = []byte(strings.Replace(string(customFiles["SKILL.md"]), "version: 1.0.0", "version: 0.9.0", 1) + "\nUser customization must survive upgrades.\n")
		customArchive, err := finalizeSkillArchive(customFiles, parseSkillPackageMetadata(customFiles["SKILL.md"]))
		if err != nil {
			t.Fatal(err)
		}
		custom, err := svc.createSkillFromArchive("owner", customArchive, SkillInstallRequest{Name: "My renamed camera skill", Tag: "creative", IsPrivate: true}, "zip", "", "", "", "", false)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SetSkillLiked("owner", custom.SkillID, true); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.createSkillFromArchive("other-user", packages[2].Archive, SkillInstallRequest{Name: packages[2].DisplayName, IsPrivate: true}, "zip", "", "", "", "", false); err != nil {
			t.Fatal(err)
		}
		initializeBundledSkills(t, svc, "owner")
		initializeBundledSkills(t, svc, "owner")
		for _, previous := range []*SkillItem{manual, custom} {
			actual, err := svc.SkillDetail("owner", previous.SkillID)
			if err != nil {
				t.Fatal(err)
			}
			if actual.SkillName != previous.SkillName || actual.ContentHash != previous.ContentHash || actual.VersionID != previous.VersionID || !actual.IsPrivate || actual.Tag != previous.Tag {
				t.Fatalf("upgrade overwrote user skill %s: %#v", previous.SkillID, actual)
			}
			assertSkillVersionCount(t, db, previous.SkillID, 1)
		}
		liked, err := svc.SkillDetail("owner", custom.SkillID)
		if err != nil || !liked.IsLike {
			t.Fatalf("user favorite was reset: %#v %v", liked, err)
		}
		for _, item := range packages {
			if item.Directory == manualPackage.Directory || item.Directory == customPackage.Directory {
				continue
			}
			_ = requireBundledSkill(t, svc, "owner", item)
		}
		created, _, err := svc.repo.Skills(repository.SkillListFilter{UserID: "owner", Scope: "created", Limit: -1})
		if err != nil || len(created) != len(packages) {
			t.Fatalf("upgrade duplicated or missed user packages: count=%d want=%d err=%v", len(created), len(packages), err)
		}
	})
}

func TestReadBundledSkillArchiveRejectsInvalidPackages(t *testing.T) {
	item := bundledSkillPackages[0]
	for _, fixture := range []struct {
		Name string
		Data []byte
	}{
		{Name: "invalid_zip", Data: []byte("not a zip")},
		{Name: "wrong_identity", Data: skillZip(t, map[string]string{"SKILL.md": "---\nname: another-skill\ndescription: Not the bundled package.\n---\n"})},
		{Name: "missing_reference", Data: skillZip(t, map[string]string{"SKILL.md": "---\nname: " + item.Directory + "\ndescription: Missing required reference.\n---\n"})},
		{Name: "path_traversal", Data: skillZip(t, map[string]string{"../SKILL.md": "# Invalid\n\nMust not be installed."})},
	} {
		t.Run(fixture.Name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, item.Category), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, item.Category, item.Directory+".zip"), fixture.Data, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readBundledSkillArchive(root, item); err == nil {
				t.Fatal("invalid bundled archive accepted")
			}
		})
	}
}

func initializeBundledSkills(t *testing.T, svc *Service, userID string) {
	t.Helper()
	for _, initialize := range []func() error{svc.EnsureBuiltinSkills, svc.EnsureSkillPackages, func() error { return svc.EnsureBuiltinSkillsAdded(userID) }} {
		if err := initialize(); err != nil {
			t.Fatal(err)
		}
	}
}

func requireBundledSkill(t *testing.T, svc *Service, userID string, item bundledPackageFixture) *SkillItem {
	t.Helper()
	added, err := svc.AddedSkills(userID)
	if err != nil {
		t.Fatal(err)
	}
	var installed *SkillItem
	for _, skill := range added {
		if skill.SkillName != item.DisplayName {
			continue
		}
		if installed != nil {
			t.Fatalf("duplicate default skill: %s", item.Directory)
		}
		copy := skill
		installed = &copy
	}
	if installed == nil {
		t.Fatalf("bundled default skill is absent after startup: %s", item.Directory)
	}
	if !installed.IsAdded || installed.Tag != item.Tag || installed.Version != item.Archive.Metadata.Version || installed.FileCount != len(item.Archive.Files) || installed.ContentHash != item.Archive.ContentHash {
		t.Fatalf("bundled skill metadata mismatch: %#v", installed)
	}
	pin := Pin{SkillID: installed.SkillID, VersionID: installed.VersionID, ContentHash: installed.ContentHash}
	if _, err := svc.ValidateAgentSkills(userID, []Pin{pin}); err != nil {
		t.Fatal(err)
	}
	for name, expected := range item.Archive.Files {
		file, err := svc.AgentFile(userID, pin, name)
		if err != nil || file.Content != string(expected) {
			t.Fatalf("bundled file %s/%s is unusable: %v", item.Directory, name, err)
		}
	}
	return installed
}

func stageBundledSkillPackages(t *testing.T, destination string) {
	t.Helper()
	for _, category := range []string{"novel-adaptation", "short-drama-editing", "cinematography"} {
		root := filepath.Join("..", "..", "..", "skill-packages", category)
		catalogBytes, err := os.ReadFile(filepath.Join(root, "catalog.json"))
		if err != nil {
			t.Fatal(err)
		}
		var catalog []bundledPackageFixture
		if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(destination, category), 0o700); err != nil {
			t.Fatal(err)
		}
		for _, item := range catalog {
			files := make(map[string]string)
			packageDir := filepath.Join(root, item.Directory)
			if err := filepath.WalkDir(packageDir, func(name string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if entry.IsDir() {
					return nil
				}
				content, err := os.ReadFile(name)
				if err != nil {
					return err
				}
				relative, err := filepath.Rel(packageDir, name)
				if err != nil {
					return err
				}
				files[item.Directory+"/"+filepath.ToSlash(relative)] = string(content)
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(destination, category, item.Directory+".zip"), skillZip(t, files), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func readBundledSkillFixtures(t *testing.T, root string) []bundledPackageFixture {
	t.Helper()
	var packages []bundledPackageFixture
	if err := filepath.WalkDir(root, func(name string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(name) != ".zip" {
			return nil
		}
		content, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		archive, err := archiveFromZip(content, "")
		if err != nil {
			return err
		}
		display := parseSkillPackageMetadata([]byte(strings.SplitN(string(archive.Files["SKILL.md"]), "---", 3)[2])).Name
		for _, bundled := range bundledSkillPackages {
			if bundled.Directory == archive.Metadata.Name {
				display = bundled.DisplayName
				break
			}
		}
		packages = append(packages, bundledPackageFixture{Directory: archive.Metadata.Name, DisplayName: display, Tag: "drama", Archive: archive})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(packages) != len(bundledSkillPackages) {
		t.Fatalf("packaged defaults = %d, want %d", len(packages), len(bundledSkillPackages))
	}
	return packages
}
