package project

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestUnlinkProjectAssetPreservesSharedMediaAndOtherProjectLinks(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	otherProject := model.Project{ID: "other-project", UserID: project.UserID, Name: "Other", Status: model.ProjectStatusActive, Revision: 1}
	otherLink := model.ProjectAssetLink{ID: "other-link", ProjectID: otherProject.ID, AssetID: asset.ID}
	mediaPath := filepath.Join(t.TempDir(), "original.png")
	if err := os.WriteFile(mediaPath, []byte("original image bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "shared-original", UserID: project.UserID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Provider: "local", ObjectKey: mediaPath}
	representation := model.AssetRepresentation{ID: "shared-representation", AssetVersionID: asset.PrimaryVersionID, ResourceID: resource.ID, MediaType: "image", Role: "primary"}
	for _, row := range []any{&otherProject, &otherLink, &resource, &representation} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := service.UnlinkProjectAsset(project.UserID, project.ID, asset.ID); err != nil {
		t.Fatalf("UnlinkProjectAsset: %v", err)
	}
	var links int64
	if err := db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", project.ID, asset.ID).Count(&links).Error; err != nil || links != 0 {
		t.Fatalf("removed project link count = %d, err = %v", links, err)
	}
	for _, row := range []any{&asset, &model.AssetVersion{ID: asset.PrimaryVersionID}, &otherLink, &resource, &representation} {
		if err := db.First(row).Error; err != nil {
			t.Fatalf("unlink deleted shared %T: %v", row, err)
		}
	}
	if got, err := os.ReadFile(mediaPath); err != nil || string(got) != "original image bytes" {
		t.Fatalf("physical original changed: %q, err = %v", got, err)
	}
	if err := db.First(&project, "id = ?", project.ID).Error; err != nil || project.Revision != 2 {
		t.Fatalf("project revision = %d, err = %v", project.Revision, err)
	}
}

func TestUnlinkProjectAssetRejectsReferencesWithoutChangingLinks(t *testing.T) {
	for _, test := range []struct {
		name    string
		payload string
		shot    bool
		want    string
	}{
		{name: "canvas character", payload: `{"nodes":[{"metadata":{"workflowKind":"character","characterAssetId":"character-asset"}}]}`, want: "请先删除对应角色卡节点"},
		{name: "invalid canvas", payload: `{`, want: "无法确认角色引用"},
		{name: "pinned shot", shot: true, want: "请先解除镜头用途"},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db := newTestService(t, nil)
			project, asset := seedProjectCharacterRepresentation(t, db)
			if test.payload != "" {
				canvas := model.CanvasProject{ID: "referencing-canvas", UserID: project.UserID, ProjectID: project.ID, PayloadJSON: test.payload, Revision: 1}
				if err := db.Create(&canvas).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.shot {
				shot := model.Shot{ID: "referencing-shot", ProjectID: project.ID}
				reference := model.ShotAssetReference{ID: "pinned-reference", ShotID: shot.ID, AssetVersionID: asset.PrimaryVersionID, Role: "reference", Status: "linked"}
				for _, row := range []any{&shot, &reference} {
					if err := db.Create(row).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			err := service.UnlinkProjectAsset(project.UserID, project.ID, asset.ID)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("unlink error = %v, want actionable %q", err, test.want)
			}
			var links int64
			if err := db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", project.ID, asset.ID).Count(&links).Error; err != nil || links != 1 {
				t.Fatalf("guard changed project links: count = %d, err = %v", links, err)
			}
			if err := db.First(&project, "id = ?", project.ID).Error; err != nil || project.Revision != 1 {
				t.Fatalf("guard changed project revision = %d, err = %v", project.Revision, err)
			}
		})
	}
}

func TestUnlinkProjectAssetRejectsForeignAndArchivedProjects(t *testing.T) {
	service, db := newTestService(t, nil)
	project, asset := seedProjectCharacterRepresentation(t, db)
	if err := service.UnlinkProjectAsset("foreign-user", project.ID, asset.ID); !IsNotFound(err) {
		t.Fatalf("foreign project unlink = %v, want not found", err)
	}
	if err := db.Model(&project).Update("status", model.ProjectStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.UnlinkProjectAsset(project.UserID, project.ID, asset.ID); err == nil {
		t.Fatal("archived project allowed unlink")
	}
	var links int64
	if err := db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", project.ID, asset.ID).Count(&links).Error; err != nil || links != 1 {
		t.Fatalf("unauthorized unlink changed link count = %d, err = %v", links, err)
	}
}
