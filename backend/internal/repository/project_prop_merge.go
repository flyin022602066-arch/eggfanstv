package repository

import (
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

var ErrPropMergeBusy = errors.New("相关镜头或道具图片仍在生成，请完成后再合并道具")
var ErrInvalidPropMerge = errors.New("只能合并当前项目内的两个不同道具，且保留的道具必须有有效主版本")

const propMergeSource = "manual_prop_merge"

func (r *Repository) ProjectPropMergeAliases(projectID, assetID string) ([]model.ProjectAssetCandidate, error) {
	var candidates []model.ProjectAssetCandidate
	err := r.db.Where("project_id = ? AND resolved_asset_id = ? AND source = ? AND status = ?", projectID, assetID, propMergeSource, "confirmed").Order("created_at, id").Find(&candidates).Error
	return candidates, err
}

func (r *Repository) MergeProjectProp(userID, projectID, sourceID, targetID string, expectedRevision int64) (int, error) {
	mergedShots := 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		project, err := requireActiveProjectTx(tx, userID, projectID)
		if err != nil {
			return err
		}
		if expectedRevision < 1 || project.Revision != expectedRevision {
			return ErrProjectRevisionConflict
		}
		if sourceID == targetID {
			return ErrInvalidPropMerge
		}
		assets := map[string]model.Asset{}
		for _, id := range []string{sourceID, targetID} {
			var asset model.Asset
			if err := tx.Joins("JOIN project_asset_links l ON l.asset_id = assets.id AND l.project_id = ?", projectID).Where("assets.id = ? AND assets.user_id = ?", id, userID).First(&asset).Error; err != nil {
				return err
			}
			if asset.Category != model.AssetCategoryProp {
				return ErrInvalidPropMerge
			}
			assets[id] = asset
		}
		target := assets[targetID]
		var primary model.AssetVersion
		if err := tx.Where("id = ? AND asset_id = ?", target.PrimaryVersionID, targetID).First(&primary).Error; err != nil {
			return ErrInvalidPropMerge
		}
		var versions []model.AssetVersion
		if err := tx.Where("asset_id IN ?", []string{sourceID, targetID}).Find(&versions).Error; err != nil {
			return err
		}
		versionIDs := make([]string, 0, len(versions))
		for _, version := range versions {
			versionIDs = append(versionIDs, version.ID)
		}
		var shots []model.Shot
		if err := tx.Where("project_id = ?", projectID).Find(&shots).Error; err != nil {
			return err
		}
		var activeImages []model.Task
		if err := tx.Select("input_json").Where("user_id = ? AND project_id = ? AND status IN ? AND type IN ?", userID, projectID, []string{"queued", "running"}, []string{"canvas_image", "image"}).Find(&activeImages).Error; err != nil {
			return err
		}
		for _, task := range activeImages {
			var input struct {
				Metadata struct {
					Operation string `json:"operation"`
					AssetID   string `json:"assetId"`
				} `json:"metadata"`
			}
			if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
				return ErrPropMergeBusy
			}
			if input.Metadata.Operation == "project_asset_image" && (input.Metadata.AssetID == sourceID || input.Metadata.AssetID == targetID) {
				return ErrPropMergeBusy
			}
		}
		now := time.Now()
		if err := bumpProjectRevisionCASTx(tx, projectID, expectedRevision, now); err != nil {
			return err
		}
		for _, shot := range shots {
			var refs []model.ShotAssetReference
			if err := tx.Where("shot_id = ? AND asset_version_id IN ?", shot.ID, versionIDs).Find(&refs).Error; err != nil {
				return err
			}
			affected := false
			for _, ref := range refs {
				for _, version := range versions {
					if ref.AssetVersionID == version.ID && version.AssetID == sourceID {
						affected = true
					}
				}
			}
			var revision model.ShotRevision
			if shot.CurrentRevisionID != "" {
				if err := tx.Where("id = ? AND shot_id = ?", shot.CurrentRevisionID, shot.ID).First(&revision).Error; err != nil {
					return err
				}
			}
			rewritten, changed := rewriteMergedPropRevision(revision, sourceID, targetID)
			if !affected && !changed {
				continue
			}
			var active int64
			if err := tx.Table("production_task_links p").Joins("JOIN tasks t ON t.id = p.task_id").Where("p.project_id = ? AND p.shot_id = ? AND t.status IN ?", projectID, shot.ID, []string{"queued", "running"}).Count(&active).Error; err != nil {
				return err
			}
			if active > 0 {
				return ErrPropMergeBusy
			}
			excluded := false
			for _, ref := range refs {
				excluded = excluded || ref.Status == "excluded"
			}
			if excluded {
				withoutTarget, removed := rewriteMergedPropRevision(rewritten, targetID, "")
				rewritten, changed = withoutTarget, changed || removed
			}
			if changed {
				var maxVersion int
				if err := tx.Model(&model.ShotRevision{}).Where("shot_id = ?", shot.ID).Select("COALESCE(MAX(version), 0)").Scan(&maxVersion).Error; err != nil {
					return err
				}
				rewritten.ID, rewritten.Version, rewritten.CreatedAt, rewritten.CreatedBy = kernel.NewID(), maxVersion+1, now, userID
				if err := tx.Create(&rewritten).Error; err != nil {
					return err
				}
				if err := tx.Model(&model.ShotAssetReference{}).Where("shot_id = ? AND selection_revision_id = ?", shot.ID, shot.CurrentRevisionID).Update("selection_revision_id", rewritten.ID).Error; err != nil {
					return err
				}
				if err := tx.Model(&model.Shot{}).Where("id = ?", shot.ID).Updates(map[string]any{"current_revision_id": rewritten.ID, "updated_at": now}).Error; err != nil {
					return err
				}
			}
			if affected {
				byRole := map[string]model.ShotAssetReference{}
				for _, ref := range refs {
					existing, found := byRole[ref.Role]
					if !found || ref.AssetVersionID == target.PrimaryVersionID || (!existing.SelectionLocked && ref.SelectionLocked) {
						byRole[ref.Role] = ref
					}
				}
				if err := tx.Where("shot_id = ? AND asset_version_id IN ?", shot.ID, versionIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
					return err
				}
				for _, ref := range byRole {
					ref.ID, ref.AssetVersionID = kernel.NewID(), target.PrimaryVersionID
					if changed {
						ref.SelectionRevisionID = rewritten.ID
					}
					if excluded {
						ref.Status, ref.SelectionSource, ref.SelectionLocked, ref.SelectionReason = "excluded", "manual", true, "合并道具时保留用户移出镜头的选择"
					}
					if err := tx.Create(&ref).Error; err != nil {
						return err
					}
				}
			}
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": now}).Error; err != nil {
				return err
			}
			mergedShots++
		}
		var candidates []model.ProjectAssetCandidate
		if err := tx.Where("project_id = ? AND resolved_asset_id = ?", projectID, sourceID).Find(&candidates).Error; err != nil {
			return err
		}
		aliases := []string{assets[sourceID].Title}
		for _, version := range versions {
			if version.ID == assets[sourceID].PrimaryVersionID {
				aliases = append(aliases, propDefinitionAliases(version.DefinitionJSON)...)
			}
		}
		for _, candidate := range candidates {
			aliases = append(aliases, candidate.Name)
			aliases = append(aliases, propDefinitionAliases(candidate.DetailsJSON)...)
		}
		details, err := json.Marshal(map[string]any{"aliases": aliases})
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, name := range aliases {
			key := model.AssetCandidateNameKey(name)
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			alias := model.ProjectAssetCandidate{ID: kernel.NewID(), ProjectID: projectID, Name: name, NameKey: key, Category: model.AssetCategoryProp, Status: "confirmed", Source: propMergeSource, ResolvedAssetID: targetID, DetailsJSON: string(details), CreatedAt: now, UpdatedAt: now}
			if err := tx.Create(&alias).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.ProjectAssetCandidate{}).Where("project_id = ? AND resolved_asset_id = ?", projectID, sourceID).Updates(map[string]any{"resolved_asset_id": targetID, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Where("project_id = ? AND asset_id = ?", projectID, sourceID).Delete(&model.ProjectAssetLink{}).Error
	})
	if err != nil {
		return 0, err
	}
	return mergedShots, nil
}

func propDefinitionAliases(definition string) []string {
	var details struct {
		Aliases []string `json:"aliases"`
	}
	if json.Unmarshal([]byte(definition), &details) != nil {
		return nil
	}
	return details.Aliases
}

func rewriteMergedPropRevision(revision model.ShotRevision, sourceID, targetID string) (model.ShotRevision, bool) {
	changed := false
	mention := regexp.MustCompile(`@\[asset:\s*` + regexp.QuoteMeta(sourceID) + `\s*\]`)
	replacement := ""
	if targetID != "" {
		replacement = "@[asset:" + targetID + "]"
	}
	for _, field := range []*string{&revision.PlotDescription, &revision.Action, &revision.Dialogue, &revision.ShotSize, &revision.CameraAngle, &revision.CameraMovement, &revision.ImagePrompt, &revision.VideoPrompt, &revision.NegativePrompt, &revision.ContinuityNotes, &revision.ActionBeatsJSON} {
		next := mention.ReplaceAllStringFunc(*field, func(string) string { return replacement })
		changed = changed || next != *field
		*field = next
	}
	return revision, changed
}
