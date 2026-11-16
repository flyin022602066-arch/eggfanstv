package repository

import (
	"encoding/base64"
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/doubaobrowser"
	"strings"
	"time"
)

func (r *Repository) ResumeUnconfirmedDoubaoBrowserTasks() error {
	now := time.Now()
	const currentAttempt = `NOT EXISTS (SELECT 1 FROM tasks newer WHERE newer.user_id = tasks.user_id AND newer.project_id = tasks.project_id
            AND newer.created_at > tasks.created_at
            AND json_extract(CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json ELSE '{}' END, '$.metadata.shotId') <> ''
            AND json_extract(CASE WHEN json_valid(newer.input_json) THEN newer.input_json ELSE '{}' END, '$.metadata.shotId') = json_extract(CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json ELSE '{}' END, '$.metadata.shotId')
            AND json_extract(CASE WHEN json_valid(newer.input_json) THEN newer.input_json ELSE '{}' END, '$.metadata.artifactType') = json_extract(CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json ELSE '{}' END, '$.metadata.artifactType'))`
	var candidates []model.Task
	if err := r.db.Select("id", "provider_request_id").Model(&model.Task{}).
		Where("status = ? AND stage = ? AND model LIKE ? AND (type LIKE ? OR type LIKE ?)", model.TaskStatusFailed, "submission_unknown", "doubao-browser::%", "canvas_video%", "video_%").
		Where("lease_owner = ? OR lease_expires_at IS NULL OR lease_expires_at <= ?", "", now).
		Where("provider_request_id LIKE ?", "doubao-browser:%").
		Where(currentAttempt).Find(&candidates).Error; err != nil {
		return err
	}
	for _, candidate := range candidates {
		var receipt doubaobrowser.Receipt
		body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(candidate.ProviderRequestID, "doubao-browser:"))
		if err != nil || json.Unmarshal(body, &receipt) != nil || receipt.TaskID != candidate.ID || !doubaobrowser.ValidReceipt(receipt) {
			continue
		}
		if err := r.db.Model(&model.Task{}).
			Where("id = ? AND status = ? AND stage = ? AND provider_request_id = ?", candidate.ID, model.TaskStatusFailed, "submission_unknown", candidate.ProviderRequestID).
			Where("lease_owner = ? OR lease_expires_at IS NULL OR lease_expires_at <= ?", "", now).
			Where(currentAttempt).
			Updates(map[string]any{"status": model.TaskStatusRunning, "stage": "已保留浏览器回执，正在查询原任务", "poll_stage": "submitted", "error": "", "completed_at": nil, "next_poll_at": now, "lease_owner": "", "lease_expires_at": nil, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}
