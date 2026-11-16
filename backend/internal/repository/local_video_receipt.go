package repository

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/doubaobrowser"
)

func (r *Repository) HasActiveHanbaoVideoTask() (bool, error) {
	var count int64
	err := r.db.Model(&model.Task{}).Where("provider_request_id LIKE ? AND status IN ?", "hanbao:%", []string{"queued", string(model.TaskStatusRunning)}).Count(&count).Error
	return count > 0, err
}

// RecordLocalVideoAccepted fences the task lease and records its attempt and
// provider receipt in one transaction before the executor starts polling.
func (r *Repository) RecordLocalVideoAccepted(taskID, userID, owner, attemptID, receipt string) error {
	if taskID == "" || userID == "" || owner == "" || attemptID == "" || (!strings.HasPrefix(receipt, "hanbao:") && !strings.HasPrefix(receipt, "doubao-browser:")) {
		return errors.New("本地视频回执身份不完整")
	}
	stage := "已提交，等待查询上游状态"
	if strings.HasPrefix(receipt, "doubao-browser:") {
		var ref doubaobrowser.Receipt
		body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(receipt, "doubao-browser:"))
		if err != nil || json.Unmarshal(body, &ref) != nil || ref.TaskID != taskID || !doubaobrowser.ValidReceipt(ref) {
			return errors.New("豆包浏览器回执与本地任务不匹配")
		}
		stage = "已保留浏览器回执，正在核对实际提交进度"
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Model(&model.Task{}).Where("id = ? AND user_id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", taskID, userID, model.TaskStatusRunning, owner, now).
			Updates(map[string]any{"provider_request_id": receipt, "poll_stage": "submitted", "stage": stage, "progress": 0, "updated_at": now})
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
