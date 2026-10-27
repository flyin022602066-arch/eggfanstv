package repository

import (
	"errors"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) SaveProjectAssetImage(projectID string, asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.AssetRepresentation
		if err := tx.Where("task_id = ? AND role = ?", representation.TaskID, representation.Role).First(&existing).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", projectID, asset.ID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(&model.AssetVersion{}).Where("asset_id = ?", asset.ID).Select("COALESCE(MAX(version), 0) + 1").Scan(&version.Version).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{
			"kind": asset.Kind, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID,
			"payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ? AND user_id = ?", projectID, asset.UserID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": asset.UpdatedAt}).Error
	})
}

func (r *Repository) UnboundProjectAssetImageTasks(userID string, projectID string) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND project_id = ? AND status = ? AND type = ?", userID, projectID, model.TaskStatusSucceeded, "canvas_image").
		Where("input_json LIKE ?", "%project_asset_image%").
		Where("NOT EXISTS (SELECT 1 FROM asset_representations WHERE asset_representations.task_id = tasks.id AND asset_representations.role = ?)", "primary").
		Order("created_at asc").Limit(100).Find(&tasks).Error
	return tasks, err
}
