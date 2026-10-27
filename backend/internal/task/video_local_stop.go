package task

import (
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) StopVideoLocally(userID, id string) (*model.Task, error) {
	if s.store == nil || s.deps.Runtime == nil || s.deps.Present == nil {
		return nil, unavailable()
	}
	task, err := s.store.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.Type != "canvas_video" && !strings.HasPrefix(task.Type, "canvas_video_") && !strings.HasPrefix(task.Type, "video_") {
		return nil, kernel.BadAuthRequest("仅支持停止正在生成的视频任务的本地跟进")
	}
	if task.Status == model.TaskStatusCancelled && task.Stage == "本地已停止" {
		return presentTask(s.deps.Present, *task)
	}
	if task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning {
		return nil, kernel.NewAppError(kernel.CodeConflict, "任务已经结束，无需停止本地跟进")
	}
	stopped, err := s.store.StopVideoLocallyIfStatus(userID, id, task.Status, s.now())
	if err != nil {
		return nil, err
	}
	latest, err := s.store.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if !stopped && (latest.Status != model.TaskStatusCancelled || latest.Stage != "本地已停止") {
		return nil, kernel.NewAppError(kernel.CodeConflict, CancelChangedMessage)
	}
	s.deps.Runtime.StopLocalWait(id)
	if stopped {
		s.log(userID, id, "warn", "用户手动停止本地视频任务跟进；未请求上游取消", "")
	}
	return presentTask(s.deps.Present, *latest)
}
