package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) HasActiveHanbaoVideoTask() (bool, error) {
	var count int64
	err := r.db.Model(&model.Task{}).Where("provider_request_id LIKE ? AND status IN ?", "hanbao:%", []string{"queued", string(model.TaskStatusRunning)}).Count(&count).Error
	return count > 0, err
}

// RecordLocalVideoAccepted fences the task lease and records its attempt and
// provider receipt in one transaction before the executor starts polling.
func (r *Repository) RecordLocalVideoAccepted(taskID, userID, owner, attemptID, receipt string) error {
	if taskID == "" || userID == "" || owner == "" || attemptID == "" || !strings.HasPrefix(receipt, "hanbao:") {
		return errors.New("本地视频回执身份不完整")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Model(&model.Task{}).Where("id = ? AND user_id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", taskID, userID, model.TaskStatusRunning, owner, now).
			Updates(map[string]any{"provider_request_id": receipt, "poll_stage": "submitted", "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("本地视频任务租约已失效")
		}
		result = tx.Model(&model.RouteAttempt{}).Where("id = ? AND task_id = ? AND dispatch_state IN ?", attemptID, taskID, []string{"submission_unknown", "accepted"}).Updates(map[string]any{"provider_request_id": receipt, "dispatch_state": "accepted"})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("本地视频提交记录已失效")
		}
		return nil
	})
}
