package skills

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSkillLibraryDefaultShowsNewSkillsBeforePopularSeeds(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	added, err := svc.CreateSkill("owner", SkillMutationRequest{
		SkillName: "Recent photography skill", Description: "Recently installed photography guidance",
		Instruction: "# Photography\n\nUse the project camera contract.", Tag: "drama",
	})
	if err != nil {
		t.Fatal(err)
	}
	latest, err := svc.Skills("owner", SkillListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(latest.Skills) == 0 || latest.Skills[0].SkillID != added.SkillID {
		t.Fatal("a newly installed skill is hidden by the default popularity sort")
	}
	popular, err := svc.Skills("owner", SkillListRequest{Sort: "popular"})
	if err != nil {
		t.Fatal(err)
	}
	if popular.Skills[0].SkillID == added.SkillID {
		t.Fatal("explicit popularity ordering was changed")
	}
}

func TestCinematographyPackagesInstallAndRemainDiscoverable(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkillsAdded("owner"); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join("..", "..", "..", "skill-packages", "cinematography")
	catalogBytes, err := os.ReadFile(filepath.Join(root, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var catalog []struct {
		Directory   string
		DisplayName string
		Tag         string
	}
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 4 {
		t.Fatalf("package count = %d, want 4", len(catalog))
	}
	installedIDs := map[string]bool{}
	for _, item := range catalog {
		files := map[string]string{}
		directory := filepath.Join(root, item.Directory)
		err := filepath.WalkDir(directory, func(name string, entry os.DirEntry, walkErr error) error {
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
			relative, err := filepath.Rel(directory, name)
			if err != nil {
				return err
			}
			files[item.Directory+"/"+filepath.ToSlash(relative)] = string(content)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		packageBytes := skillZip(t, files)
		archive, err := archiveFromZip(packageBytes, "")
		if err != nil {
			t.Fatal(err)
		}
		if archive.Metadata.Name != item.Directory || archive.Metadata.Version != "1.0.0" {
			t.Fatalf("metadata mismatch for %s: %#v", item.Directory, archive.Metadata)
		}
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		upload, err := form.CreateFormFile("file", item.Directory+".zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := upload.Write(packageBytes); err != nil {
			t.Fatal(err)
		}
		if err := form.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/skills/install", &body)
		request.Header.Set("Content-Type", form.FormDataContentType())
		if err := request.ParseMultipartForm(20 << 20); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { request.MultipartForm.RemoveAll() })
		installed, err := svc.InstallSkillUpload("owner", "zip", request.MultipartForm.File["file"][0], SkillInstallRequest{Name: item.DisplayName, Tag: item.Tag})
		if err != nil {
			t.Fatal(err)
		}
		if !installed.IsAdded || !installed.IsOwner || installed.Tag != "drama" || installed.Version != "1.0.0" || installed.FileCount != 2 || installed.ContentHash != archive.ContentHash {
			t.Fatalf("installed package metadata mismatch: %#v", installed)
		}
		if skillHas15SecondLimit(installed.SkillName, installed.Description, installed.Instruction) {
			t.Fatal("duration-independent skill was classified as short-clip limited")
		}
		for name, expected := range archive.Files {
			file, err := svc.SkillPackageFile("owner", installed.SkillID, name)
			if err != nil || file.Content != string(expected) || file.Binary {
				t.Fatalf("package file %s was not readable after install: %v", name, err)
			}
		}
		if _, err := svc.SkillDetail("other-user", installed.SkillID); err != nil {
			t.Fatalf("public package is not visible to another local user: %v", err)
		}
		installedIDs[installed.SkillID] = true
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	result, err := svc.Skills("owner", SkillListRequest{PageSize: 20, Scope: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalCount != 43 {
		t.Fatalf("skill count = %d, want 43", result.TotalCount)
	}
	if len(result.Skills) != 20 {
		t.Fatalf("default page size = %d, want 20", len(result.Skills))
	}
	popular, err := svc.Skills("owner", SkillListRequest{PageSize: 20, Scope: "public", Sort: "popular"})
	if err != nil {
		t.Fatal(err)
	}
	if installedIDs[popular.Skills[0].SkillID] {
		t.Fatal("explicit popularity ordering was changed")
	}
}
