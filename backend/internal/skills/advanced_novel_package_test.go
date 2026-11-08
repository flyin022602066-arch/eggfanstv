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

func TestAdvancedNovelPackageInstallAndReadBack(t *testing.T) {
	svc, _ := agentSkillFixture(t)
	root := filepath.Join("..", "..", "..", "skill-packages", "novel-adaptation")
	catalogBytes, err := os.ReadFile(filepath.Join(root, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var catalog []struct{ Directory, DisplayName, Tag string }
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 1 {
		t.Fatalf("package count = %d", len(catalog))
	}
	item := catalog[0]
	files := map[string]string{}
	for _, name := range []string{"SKILL.md", "references/novel-screenplay-spec.md"} {
		content, err := os.ReadFile(filepath.Join(root, item.Directory, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		files[item.Directory+"/"+name] = string(content)
	}
	packageBytes := skillZip(t, files)
	archive, err := archiveFromZip(packageBytes, "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Name != item.Directory || archive.Metadata.Version != "1.0.0" {
		t.Fatalf("metadata = %#v", archive.Metadata)
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
	t.Cleanup(func() { _ = request.MultipartForm.RemoveAll() })
	installed, err := svc.InstallSkillUpload("owner", "zip", request.MultipartForm.File["file"][0], SkillInstallRequest{Name: item.DisplayName, Tag: item.Tag, IsPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	if !installed.IsAdded || !installed.IsOwner || !installed.IsPrivate || installed.SkillName != item.DisplayName || installed.Tag != "drama" || installed.Version != "1.0.0" || installed.FileCount != 2 || installed.ContentHash != archive.ContentHash {
		t.Fatalf("installed = %#v", installed)
	}
	for name, expected := range archive.Files {
		actual, err := svc.SkillPackageFile("owner", installed.SkillID, name)
		if err != nil || actual.Binary || actual.Content != string(expected) {
			t.Fatalf("file %s differs after install: %v", name, err)
		}
	}
	added, err := svc.AddedSkills("owner")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, skill := range added {
		if skill.SkillID == installed.SkillID {
			found = true
		}
	}
	if !found {
		t.Fatal("installed skill is absent from added skills")
	}
	if _, err := svc.SkillDetail("other-user", installed.SkillID); err == nil {
		t.Fatal("private skill is visible to another user")
	}
}
