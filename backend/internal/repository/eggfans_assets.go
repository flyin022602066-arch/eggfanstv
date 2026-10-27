package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"
)

func (r *Repository) EggfansAssetBinding(userID, accountScope, sourceKey string) (*model.EggfansAssetBinding, error) {
	var binding model.EggfansAssetBinding
	err := r.db.Where("user_id = ? AND account_scope = ? AND source_key = ?", userID, accountScope, sourceKey).First(&binding).Error
	return &binding, err
}

func (r *Repository) EggfansAssetBindingByAssetID(userID, accountScope, assetID string) (*model.EggfansAssetBinding, error) {
	var binding model.EggfansAssetBinding
	err := r.db.Where("user_id = ? AND account_scope = ? AND asset_id = ?", userID, accountScope, assetID).Order("updated_at DESC").First(&binding).Error
	return &binding, err
}

func (r *Repository) SaveEggfansAssetBinding(binding *model.EggfansAssetBinding) error {
	binding.UpdatedAt = time.Now().UTC()
	return r.db.Save(binding).Error
}

func (r *Repository) SaveResourceTemporaryMediaURL(userID, resourceID, publicURL string, uploadedAt, expiresAt time.Time) error {
	return r.db.Model(&model.Resource{}).Where("id = ? AND user_id = ?", resourceID, userID).Updates(map[string]any{"temporary_media_url": publicURL, "temporary_media_uploaded_at": uploadedAt, "temporary_media_expires_at": expiresAt}).Error
}

func (r *Repository) ResourceEggfansAssets(userID, resourceID string) ([]model.EggfansAssetBinding, error) {
	var bindings []model.EggfansAssetBinding
	err := r.db.Where("user_id = ? AND resource_id = ?", userID, resourceID).Order("updated_at DESC").Find(&bindings).Error
	return bindings, err
}

func (r *Repository) InvalidateEggfansAsset(userID, accountScope, assetID, groupID string) error {
	query := r.db.Model(&model.EggfansAssetBinding{}).Where("user_id = ? AND account_scope = ?", userID, accountScope)
	if assetID != "" {
		query = query.Where("asset_id = ?", assetID)
	} else {
		query = query.Where("asset_group_id = ?", groupID)
	}
	return query.Updates(map[string]any{"status": "deleted", "uri": "", "updated_at": time.Now().UTC()}).Error
}
