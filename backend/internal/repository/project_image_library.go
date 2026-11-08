package repository

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func saveProjectImageLibraryTx(tx *gorm.DB, projectID string, asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation) error {
	if asset.Kind != "entity" {
		return nil
	}
	for _, representation := range representations {
		if representation.MediaType != "image" {
			continue
		}
		imageID := "project-image-" + representation.ResourceID
		source := "项目资产"
		var taskCount int64
		if err := tx.Model(&model.Task{}).Where("id = ? AND user_id = ?", representation.TaskID, asset.UserID).Count(&taskCount).Error; err != nil {
			return err
		}
		if taskCount > 0 {
			source = "生成任务"
			imageID = fmt.Sprintf("generation_%x", sha256.Sum256([]byte("materialize:"+strings.TrimSpace(representation.TaskID)+":0")))
		}
		var existing model.Asset
		if err := tx.First(&existing, "id = ?", imageID).Error; err == nil {
			if existing.UserID != asset.UserID {
				return gorm.ErrRecordNotFound
			}
			continue
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var resource model.Resource
		if err := tx.First(&resource, "id = ? AND user_id = ? AND status = ?", representation.ResourceID, asset.UserID, model.ResourceStatusReady).Error; err != nil {
			return err
		}
		mimeType := strings.ToLower(strings.TrimSpace(strings.SplitN(resource.MimeType, ";", 2)[0]))
		if (resource.Kind != "image" && resource.Kind != "media" && resource.Kind != "file") || !strings.HasPrefix(mimeType, "image/") || mimeType == "image/" {
			return gorm.ErrInvalidData
		}
		var imageCount int64
		if err := tx.Model(&model.Asset{}).Where("user_id = ? AND kind = ? AND json_extract(payload_json, '$.data.storageKey') = ?", asset.UserID, "image", "resource:"+resource.ID).Count(&imageCount).Error; err != nil {
			return err
		}
		if imageCount > 0 {
			continue
		}
		title := fmt.Sprintf("%s · v%d", asset.Title, version.Version)
		payload, err := json.Marshal(map[string]any{
			"id": imageID, "kind": "image", "title": title, "category": asset.Category,
			"status": model.AssetVersionStatusConfirmed, "source": source, "tags": []string{"项目资产图"},
			"coverUrl": "/api/resources/" + resource.ID + "/file",
			"createdAt": representation.CreatedAt, "updatedAt": representation.CreatedAt,
			"metadata": map[string]any{"projectIds": []string{projectID}, "sourceAssetId": asset.ID, "sourceVersionId": version.ID, "taskId": representation.TaskID},
			"data": map[string]any{"storageKey": "resource:" + resource.ID, "dataUrl": "/api/resources/" + resource.ID + "/file", "width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType},
		})
		if err != nil {
			return err
		}
		image := model.Asset{ID: imageID, UserID: asset.UserID, Kind: "image", Category: asset.Category, Status: model.AssetVersionStatusConfirmed, Title: title, PayloadJSON: string(payload), CreatedAt: representation.CreatedAt, UpdatedAt: representation.CreatedAt}
		if err := tx.Create(&image).Error; err != nil {
			return err
		}
	}
	return nil
}
