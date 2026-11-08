package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

var ErrCharacterReferenceLocked = errors.New("角色造型已锁定，请先解锁")
var ErrCharacterReferenceBusy = errors.New("镜头正在生成，无法修改角色造型")
var ErrCharacterLookLastVersion = errors.New("这是角色最后一个可用版本，请使用“移除角色资产”移除整个角色")
var ErrCharacterLookReferenced = errors.New("造型仍被镜头或画布引用，请先解除镜头用途或移除对应画布节点后再删除")
var ErrCharacterLookTaskBusy = errors.New("造型仍有排队或生成中的任务，请等待完成或取消任务后再删除")
var ErrCharacterLookCanvasInvalid = errors.New("画布或任务引用数据无效，无法安全删除造型，请修复或移除异常引用后重试")

func (r *Repository) ArchiveCharacterLookVersion(userID, projectID, assetID, versionID string, expectedUpdatedAt time.Time, expectedPrimary string, expectedAssetUpdatedAt time.Time, nextAsset *model.Asset, alternate *model.AssetVersion) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		project, err := requireActiveProjectTx(tx, userID, projectID)
		if err != nil {
			return err
		}
		if project.Status != model.ProjectStatusActive {
			return ErrProjectArchived
		}
		var asset model.Asset
		if err := tx.Table("assets").Select("assets.*").Joins("JOIN project_asset_links p ON p.asset_id = assets.id").
			Where("assets.id = ? AND assets.user_id = ? AND assets.category = ? AND p.project_id = ?", assetID, userID, model.AssetCategoryCharacter, projectID).First(&asset).Error; err != nil {
			return err
		}
		var version model.AssetVersion
		if err := tx.First(&version, "id = ? AND asset_id = ? AND status <> ?", versionID, assetID, model.AssetVersionStatusArchived).Error; err != nil {
			return err
		}
		if expectedUpdatedAt.IsZero() || !version.UpdatedAt.Equal(expectedUpdatedAt) || asset.PrimaryVersionID != expectedPrimary || !asset.UpdatedAt.Equal(expectedAssetUpdatedAt) {
			return ErrProjectRevisionConflict
		}
		var remaining int64
		if err := tx.Model(&model.AssetVersion{}).Where("asset_id = ? AND id <> ? AND status <> ?", assetID, versionID, model.AssetVersionStatusArchived).Count(&remaining).Error; err != nil {
			return err
		}
		if remaining == 0 {
			return ErrCharacterLookLastVersion
		}
		if alternate == nil || nextAsset == nil {
			return ErrProjectRevisionConflict
		}
		var available model.AssetVersion
		if err := tx.First(&available, "id = ? AND asset_id = ? AND id <> ? AND status <> ?", alternate.ID, assetID, versionID, model.AssetVersionStatusArchived).Error; err != nil {
			return err
		}
		if !available.UpdatedAt.Equal(alternate.UpdatedAt) || nextAsset.ID != assetID || nextAsset.PrimaryVersionID == versionID || asset.PrimaryVersionID != versionID && nextAsset.PrimaryVersionID != asset.PrimaryVersionID || asset.PrimaryVersionID == versionID && nextAsset.PrimaryVersionID != available.ID {
			return ErrProjectRevisionConflict
		}
		now := time.Now()
		if !now.After(expectedUpdatedAt) {
			now = expectedUpdatedAt.Add(time.Nanosecond)
		}
		if !now.After(asset.UpdatedAt) {
			now = asset.UpdatedAt.Add(time.Nanosecond)
		}
		if err := bumpProjectRevisionCASTx(tx, projectID, project.Revision, now); err != nil {
			return err
		}
		if err := requireCharacterLookUnreferencedTx(tx, userID, asset, versionID); err != nil {
			return err
		}
		updated := tx.Model(&model.AssetVersion{}).Where("id = ? AND asset_id = ? AND updated_at = ? AND status <> ?", versionID, assetID, expectedUpdatedAt, model.AssetVersionStatusArchived).Updates(map[string]any{"status": model.AssetVersionStatusArchived, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrProjectRevisionConflict
		}
		values := map[string]any{"updated_at": now}
		if asset.PrimaryVersionID == versionID {
			values["primary_version_id"] = nextAsset.PrimaryVersionID
			values["payload_json"] = nextAsset.PayloadJSON
			values["status"] = nextAsset.Status
		}
		updated = tx.Model(&model.Asset{}).Where("id = ? AND user_id = ? AND primary_version_id = ? AND updated_at = ?", assetID, userID, expectedPrimary, expectedAssetUpdatedAt).Updates(values)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrProjectRevisionConflict
		}
		return nil
	})
}

func requireCharacterLookUnreferencedTx(tx *gorm.DB, userID string, asset model.Asset, versionID string) error {
	var linked int64
	if err := tx.Model(&model.ShotAssetReference{}).Where("asset_version_id = ? AND status = ?", versionID, "linked").Count(&linked).Error; err != nil {
		return err
	}
	if linked > 0 {
		return ErrCharacterLookReferenced
	}
	var generating int64
	if err := tx.Table("asset_representations a").Joins("JOIN tasks t ON t.id = a.task_id").Where("a.asset_version_id = ? AND t.user_id = ? AND t.status IN ?", versionID, userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&generating).Error; err != nil {
		return err
	}
	if generating > 0 {
		return ErrCharacterLookTaskBusy
	}
	var representations []model.AssetRepresentation
	if err := tx.Select("resource_id").Where("asset_version_id = ? AND resource_id <> ''", versionID).Find(&representations).Error; err != nil {
		return err
	}
	resources := make(map[string]bool, len(representations))
	for _, representation := range representations {
		resources[representation.ResourceID] = true
	}
	var canvases []model.CanvasProject
	if err := tx.Select("id", "payload_json").Where("user_id = ?", userID).Find(&canvases).Error; err != nil {
		return err
	}
	for _, canvas := range canvases {
		if strings.TrimSpace(canvas.PayloadJSON) == "" {
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(canvas.PayloadJSON), &payload); err != nil {
			return ErrCharacterLookCanvasInvalid
		}
		if characterLookReferencedJSON(payload, asset.ID, versionID, asset.PrimaryVersionID == versionID) || characterLookResourceReferencedJSON(payload, resources) {
			return ErrCharacterLookReferenced
		}
	}
	var tasks []model.Task
	if err := tx.Select("id", "input_json").Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Find(&tasks).Error; err != nil {
		return err
	}
	for _, task := range tasks {
		if strings.TrimSpace(task.InputJSON) == "" {
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(task.InputJSON), &payload); err != nil {
			return ErrCharacterLookCanvasInvalid
		}
		if characterLookReferencedJSON(payload, asset.ID, versionID, asset.PrimaryVersionID == versionID) || characterLookResourceReferencedJSON(payload, resources) {
			return ErrCharacterLookTaskBusy
		}
	}
	return nil
}

func characterLookResourceReferencedJSON(value any, resources map[string]bool) bool {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			if value, ok := child.(string); ok {
				switch key {
				case "resourceId", "sourceResourceId", "imageResourceId", "audioResourceId":
					if resources[value] {
						return true
					}
				case "storageKey", "url", "src":
					if strings.HasPrefix(value, "resource:") && resources[strings.TrimPrefix(value, "resource:")] {
						return true
					}
				}
			}
			if characterLookResourceReferencedJSON(child, resources) {
				return true
			}
		}
	case []any:
		for _, child := range item {
			if characterLookResourceReferencedJSON(child, resources) {
				return true
			}
		}
	}
	return false
}

func characterLookReferencedJSON(value any, assetID, versionID string, isPrimary bool) bool {
	switch item := value.(type) {
	case map[string]any:
		matchedAsset, explicitVersion := false, false
		for key, child := range item {
			if text, ok := child.(string); ok {
				switch key {
				case "versionId", "assetVersionId", "characterVersionId", "characterAssetVersionId", "baseVersionId":
					explicitVersion = explicitVersion || text != ""
					if text == versionID {
						return true
					}
				case "assetId", "characterAssetId":
					matchedAsset = matchedAsset || text == assetID
				}
			}
			if characterLookReferencedJSON(child, assetID, versionID, isPrimary) {
				return true
			}
		}
		return isPrimary && matchedAsset && (!explicitVersion || item["characterVersionPolicy"] == "current")
	case []any:
		for _, child := range item {
			if characterLookReferencedJSON(child, assetID, versionID, isPrimary) {
				return true
			}
		}
	}
	return false
}

func (r *Repository) SaveExtractedCharacterLooks(userID, projectID, expectedPrimary, baseID string, expectedUpdatedAt time.Time, asset *model.Asset, versions []model.AssetVersion, voices []model.CharacterVoiceBinding) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		if err := requireProjectAssetVersionTx(tx, projectID, baseID); err != nil {
			return err
		}
		var base model.AssetVersion
		if err := tx.First(&base, "id = ? AND asset_id = ? AND status <> ?", baseID, asset.ID, model.AssetVersionStatusArchived).Error; err != nil {
			return err
		}
		if !base.UpdatedAt.Equal(expectedUpdatedAt) {
			return ErrProjectRevisionConflict
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ? AND primary_version_id = ?", asset.ID, userID, expectedPrimary).Updates(map[string]any{"primary_version_id": asset.PrimaryVersionID, "payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProjectRevisionConflict
		}
		var current []model.AssetVersion
		if err := tx.Where("asset_id = ? AND status <> ?", asset.ID, model.AssetVersionStatusArchived).Find(&current).Error; err != nil {
			return err
		}
		for _, v := range versions {
			var p map[string]any
			_ = json.Unmarshal([]byte(v.ReferenceProfileJSON), &p)
			for _, old := range current {
				var profile map[string]any
				_ = json.Unmarshal([]byte(old.ReferenceProfileJSON), &profile)
				if profile["lookId"] != nil && profile["lookId"] == p["lookId"] {
					return ErrProjectRevisionConflict
				}
			}
			if err := tx.Create(&v).Error; err != nil {
				return err
			}
		}
		for _, voice := range voices {
			if err := tx.Create(&voice).Error; err != nil {
				return err
			}
		}
		return bumpProjectRevisionTx(tx, projectID, asset.UpdatedAt)
	})
}

type CharacterReferenceUpdate struct {
	AssetID                string
	ExpectedShotRevisionID string
	Reference              model.ShotAssetReference
}

func (r *Repository) SaveCharacterReferenceProfile(userID, projectID, assetID, versionID string, expected time.Time, raw, lookID string, preferred, defaultLook bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		if err := requireProjectAssetVersionTx(tx, projectID, versionID); err != nil {
			return err
		}
		var asset model.Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND category = ?", assetID, userID, model.AssetCategoryCharacter).Error; err != nil {
			return err
		}
		now := time.Now()
		if !now.After(expected) {
			now = expected.Add(time.Nanosecond)
		}
		updated := tx.Model(&model.AssetVersion{}).Where("id = ? AND asset_id = ? AND updated_at = ? AND status <> ?", versionID, assetID, expected, model.AssetVersionStatusArchived).Updates(map[string]any{"reference_profile_json": raw, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrProjectRevisionConflict
		}
		if preferred || defaultLook {
			var others []model.AssetVersion
			if err := tx.Where("asset_id = ? AND id <> ? AND status <> ? AND reference_profile_json <> ''", assetID, versionID, model.AssetVersionStatusArchived).Find(&others).Error; err != nil {
				return err
			}
			for _, other := range others {
				var profile map[string]any
				if err := json.Unmarshal([]byte(other.ReferenceProfileJSON), &profile); err != nil {
					return err
				}
				changed := false
				if preferred && profile["lookId"] == lookID {
					profile["preferred"] = false
					profile["default"] = false
					changed = true
				}
				if defaultLook && profile["default"] == true {
					profile["default"] = false
					changed = true
				}
				if !changed {
					continue
				}
				encoded, err := json.Marshal(profile)
				if err != nil {
					return err
				}
				if err := tx.Model(&other).Updates(map[string]any{"reference_profile_json": string(encoded), "updated_at": now}).Error; err != nil {
					return err
				}
			}
		}
		return bumpProjectRevisionTx(tx, projectID, now)
	})
}

func (r *Repository) SaveCharacterReferenceChoices(userID, projectID, unitID string, expected int64, updates []CharacterReferenceUpdate) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		now := time.Now()
		if err := bumpProjectRevisionCASTx(tx, projectID, expected, now); err != nil {
			return err
		}
		for _, update := range updates {
			ref := update.Reference
			var shot model.Shot
			if err := tx.First(&shot, "id = ? AND project_id = ? AND unit_id = ?", ref.ShotID, projectID, unitID).Error; err != nil {
				return err
			}
			if shot.CurrentRevisionID != update.ExpectedShotRevisionID {
				return ErrProjectRevisionConflict
			}
			var active int64
			if err := tx.Table("production_task_links p").Joins("JOIN tasks t ON t.id = p.task_id").Where("p.project_id = ? AND p.shot_id = ? AND t.status IN ?", projectID, shot.ID, []string{"queued", "running"}).Count(&active).Error; err != nil {
				return err
			}
			if active > 0 {
				return ErrCharacterReferenceBusy
			}
			var version model.AssetVersion
			if err := requireProjectAssetVersionTx(tx, projectID, ref.AssetVersionID); err != nil {
				return err
			}
			if err := tx.First(&version, "id = ? AND asset_id = ? AND status <> ?", ref.AssetVersionID, update.AssetID, model.AssetVersionStatusArchived).Error; err != nil {
				return err
			}
			var existing []model.ShotAssetReference
			if err := tx.Table("shot_asset_references r").Select("r.*").Joins("JOIN asset_versions v ON v.id = r.asset_version_id").Where("r.shot_id = ? AND r.role = ? AND v.asset_id = ?", shot.ID, "reference", update.AssetID).Find(&existing).Error; err != nil {
				return err
			}
			for _, old := range existing {
				if old.SelectionLocked && ref.SelectionSource != "manual" {
					return ErrCharacterReferenceLocked
				}
			}
			changed := len(existing) != 1 || existing[0].AssetVersionID != ref.AssetVersionID || existing[0].SelectionStatus != ref.SelectionStatus
			for _, old := range existing {
				if err := tx.Delete(&model.ShotAssetReference{}, "id = ?", old.ID).Error; err != nil {
					return err
				}
			}
			if err := tx.Create(&ref).Error; err != nil {
				return err
			}
			if changed {
				if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale", "queued", "running", "processing"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": now}).Error; err != nil {
					return err
				}
				if err := invalidateUnitWorkflowTx(tx, projectID, unitID, "storyboard", now); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
