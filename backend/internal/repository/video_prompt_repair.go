package repository

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) QueueVideoPromptRepair(task *model.Task, inputJSON string) error {
	return withImmediateTransaction(r.db, func(tx *gorm.DB) error {
		if err := RequireTaskScopeActiveTx(tx, task.UserID, task.ProjectID); err != nil {
			return err
		}
		now := time.Now()
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND user_id = ? AND status = ? AND input_json = ? AND (lease_owner = '' OR lease_expires_at IS NULL OR lease_expires_at <= ?)", task.ID, task.UserID, model.TaskStatusFailed, task.InputJSON, now).
			Updates(map[string]any{"status": model.TaskStatusQueued, "stage": "待进行一次合规润色", "input_json": inputJSON, "completed_at": nil, "lease_owner": "", "lease_expires_at": nil, "next_poll_at": nil, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return nil
	})
}

func (r *Repository) BeginVideoPromptRepair(task *model.Task, inputJSON string) error {
	result := taskLeaseWriter(r.db.Model(&model.Task{}), task.LeaseOwner).
		Where("id = ? AND user_id = ? AND status = ? AND input_json = ?", task.ID, task.UserID, model.TaskStatusRunning, task.InputJSON).
		Updates(map[string]any{"input_json": inputJSON, "stage": "审核未通过，正在合规润色最终提示词", "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

func (r *Repository) CompleteVideoPromptRepair(parent *model.Task, child *model.Task, diagnostics *model.TaskFailureDiagnostics) error {
	return withImmediateTransaction(r.db, func(tx *gorm.DB) error {
		if err := RequireTaskScopeActiveTx(tx, child.UserID, child.ProjectID); err != nil {
			return err
		}
		ids, err := taskInputResourceIDs(child.InputJSON)
		if err != nil {
			return err
		}
		if err := RequireReadyOwnedResourcesTx(tx, child.UserID, ids); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, child); err != nil {
			return err
		}
		body, err := json.Marshal(diagnostics)
		if err != nil {
			return err
		}
		now := time.Now()
		updated := taskLeaseWriter(tx.Model(&model.Task{}), parent.LeaseOwner).
			Where("id = ? AND user_id = ? AND status = ? AND input_json = ?", parent.ID, parent.UserID, model.TaskStatusRunning, parent.InputJSON).
			Updates(map[string]any{"status": model.TaskStatusFailed, "stage": "审核未通过，已合规润色并自动重新提交", "error": parent.Error, "failure_diagnostics": string(body), "completed_at": now, "lease_owner": "", "lease_expires_at": nil, "next_poll_at": nil, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return tx.Create(child).Error
	})
}
