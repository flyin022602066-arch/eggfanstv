package repository

import (
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) SaveVideoPromptPreflight(task *model.Task, prompt, inputJSON, stage string) error {
	return withImmediateTransaction(r.db, func(tx *gorm.DB) error {
		if err := RequireTaskScopeActiveTx(tx, task.UserID, task.ProjectID); err != nil {
			return err
		}
		result := taskLeaseWriter(tx.Model(&model.Task{}), task.LeaseOwner).
			Where("id = ? AND user_id = ? AND status = ? AND input_json = ? AND prompt = ? AND (provider_request_id = ? OR provider_request_id IS NULL) AND (poll_stage = ? OR poll_stage IS NULL)", task.ID, task.UserID, model.TaskStatusRunning, task.InputJSON, task.Prompt, "", "").
			Updates(map[string]any{"prompt": prompt, "input_json": inputJSON, "stage": stage, "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return nil
	})
}
