package asset

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCharacterFacePresetProtectsReferenceResource(t *testing.T) {
	_, db, _ := newDeletionDomain(t)
	resourceID, assetID := kernel.NewID(), kernel.NewID()
	resource := model.Resource{ID: resourceID, UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}
	asset := model.Asset{ID: assetID, UserID: "user-1", Title: "参考图"}
	project := model.Project{ID: kernel.NewID(), UserID: "user-1", Name: "有主角人脸预设的项目", Revision: 1, CharacterFacePresetsJSON: `{"male":{"resourceId":"` + resourceID + `","assetIds":[]}}`}
	for _, value := range []any{&resource, &asset, &project} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.New(db)
	snapshot, err := repo.ResourceReferenceSnapshot("user-1", assetID, []string{resourceID})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, document := range snapshot.Documents {
		if document.ID == project.ID && assets.DocumentReferences(document.SecondaryJSON, map[string]struct{}{resourceID: {}}) {
			found = true
		}
	}
	if !found {
		t.Fatal("face reference missing from resource usage snapshot")
	}
	if err := repo.DeleteAssetAndResources("user-1", assetID, []string{resourceID}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("delete guard = %v", err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resourceID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("reference resource was removed: %v", err)
	}
}
