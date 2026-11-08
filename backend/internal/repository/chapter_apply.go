package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) AgentOpRecordsForUser(userID string, opIDs []string) ([]model.AgentOpRecord, error) {
	if len(opIDs) == 0 {
		return nil, nil
	}
	var records []model.AgentOpRecord
	err := r.db.Where("user_id = ? AND op_id IN ? AND status = ?", userID, opIDs, "succeeded").Find(&records).Error
	return records, err
}

func (r *Repository) ReplaceProjectUnitShotsTx(tx *gorm.DB, userID, projectID, unitID string, shots []model.Shot, revisions []model.ShotRevision, references []model.ShotAssetReference, expectedShotIDs []string, expectedShotPointers map[string]string, expectedRevision int64) error {
	return replaceProjectUnitShotsTx(tx, userID, projectID, unitID, shots, revisions, references, expectedShotIDs, expectedShotPointers, expectedRevision)
}

func (r *Repository) CreateProjectAssetCandidatesAndBumpTx(tx *gorm.DB, userID, projectID string, candidates []model.ProjectAssetCandidate) ([]model.ProjectAssetCandidate, error) {
	return createProjectAssetCandidatesAndBumpTx(tx, userID, projectID, candidates)
}

func (r *Repository) ReplaceProjectUnitAssetDraftsTx(tx *gorm.DB, userID, projectID, unitID string, candidates []model.ProjectAssetCandidate) ([]model.ProjectAssetCandidate, error) {
	if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
		return nil, err
	}
	if err := tx.Where("id = ? AND project_id = ?", unitID, projectID).First(&model.ProjectUnit{}).Error; err != nil {
		return nil, err
	}
	deleted := tx.Where("project_id = ? AND status = ? AND (unit_id = ? OR (unit_id = '' AND shot_id IN (SELECT id FROM shots WHERE project_id = ? AND unit_id = ?)))", projectID, "pending_confirmation", unitID, projectID, unitID).Delete(&model.ProjectAssetCandidate{})
	if deleted.Error != nil {
		return nil, deleted.Error
	}
	inserted, err := createProjectAssetCandidatesAndBumpTx(tx, userID, projectID, candidates)
	if err != nil {
		return nil, err
	}
	if deleted.RowsAffected > 0 && len(inserted) == 0 {
		return inserted, bumpProjectRevisionTx(tx, projectID, time.Now())
	}
	return inserted, nil
}
