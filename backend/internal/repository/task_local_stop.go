package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"
)

func (r *Repository) StopVideoTaskLocallyIfStatus(userID, id string, expected model.TaskStatus, now time.Time) (bool, error) {
	if expected != model.TaskStatusQueued && expected != model.TaskStatusRunning {
		return false, nil
	}
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, expected).
		Where("(type = ? OR substr(type, 1, 13) = ? OR substr(type, 1, 6) = ?)", "canvas_video", "canvas_video_", "video_").
		Updates(map[string]any{
			"status": model.TaskStatusCancelled, "stage": "本地已停止",
			"error":        "用户已手动停止本地跟进；上游任务未取消，重新生成将提交新任务。",
			"completed_at": &now, "updated_at": now,
			"lease_owner": "", "lease_expires_at": nil, "poll_stage": "", "next_poll_at": nil,
		})
	return result.RowsAffected == 1, result.Error
}
