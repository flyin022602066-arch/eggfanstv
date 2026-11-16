package repository

import (
	"encoding/json"
	"sort"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func sameNameProjectPropTx(tx *gorm.DB, userID, projectID, name string) (*model.Asset, error) {
	var assets []model.Asset
	if err := tx.Joins("JOIN project_asset_links l ON l.asset_id = assets.id AND l.project_id = ?", projectID).Where("assets.user_id = ? AND assets.category = ?", userID, model.AssetCategoryProp).Order("assets.created_at, assets.id").Find(&assets).Error; err != nil {
		return nil, err
	}
	key := sameNamePropKey(name)
	for _, asset := range assets {
		if key != "" && sameNamePropKey(asset.Title) == key {
			return &asset, nil
		}
	}
	return nil, nil
}

func sameNamePropKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func (r *Repository) MergeSameNameProjectProps(userID, projectID string) (int, int, error) {
	merged, deferred := 0, 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var assets []model.Asset
		if err := tx.Joins("JOIN project_asset_links l ON l.asset_id = assets.id AND l.project_id = ?", projectID).Where("assets.user_id = ? AND assets.category = ?", userID, model.AssetCategoryProp).Order("assets.created_at, assets.id").Find(&assets).Error; err != nil {
			return err
		}
		groups := map[string][]model.Asset{}
		keys := []string{}
		for _, asset := range assets {
			key := sameNamePropKey(asset.Title)
			if key == "" {
				continue
			}
			if len(groups[key]) == 0 {
				keys = append(keys, key)
			}
			groups[key] = append(groups[key], asset)
		}
		for _, key := range keys {
			group := groups[key]
			if len(group) < 2 {
				continue
			}
			sort.SliceStable(group, func(left, right int) bool {
				return propHasImage(group[left]) && !propHasImage(group[right])
			})
			groupErr := tx.Transaction(func(groupTx *gorm.DB) error {
				for _, source := range group[1:] {
					project, err := requireActiveProjectTx(groupTx, userID, projectID)
					if err != nil {
						return err
					}
					if _, err := mergeProjectPropTx(groupTx, userID, projectID, source.ID, group[0].ID, project.Revision, true); err != nil {
						return err
					}
				}
				return nil
			})
			if groupErr == ErrPropMergeBusy {
				deferred += len(group) - 1
				continue
			}
			if groupErr != nil {
				return groupErr
			}
			merged += len(group) - 1
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	return merged, deferred, nil
}

func propHasImage(asset model.Asset) bool {
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
		} `json:"data"`
	}
	return asset.Kind == "image" && json.Unmarshal([]byte(asset.PayloadJSON), &payload) == nil && strings.TrimSpace(payload.Data.StorageKey) != ""
}
