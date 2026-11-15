package app

import (
	"context"
	"errors"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/hanbao"
)

func (s *Service) HanbaoDomain() *hanbao.Service {
	if s == nil || !s.IsLocalMode() {
		return nil
	}
	s.hanbaoOnce.Do(func() {
		s.hanbao = hanbao.New(s.dataDir, func() error {
			if s.repo == nil {
				return errors.New("本地任务仓库尚未初始化")
			}
			active, err := s.repo.HasActiveHanbaoVideoTask()
			if err != nil {
				return errors.New("检查憨包任务状态失败")
			}
			if active {
				return hanbao.ErrBusy
			}
			return nil
		})
	})
	return s.hanbao
}

type hanbaoReceipt struct{ service *Service }

func (r hanbaoReceipt) Ready(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	meta, _ := generation.CallMetaFromContext(ctx)
	if r.service == nil || r.service.repo == nil || meta.UserID == "" || meta.TaskID == "" {
		return errors.New("本地视频缺少任务回执上下文")
	}
	task, err := r.service.repo.TaskForUser(meta.UserID, meta.TaskID)
	if err != nil {
		return err
	}
	current, ok := ctx.Value(imageTaskContext{}).(model.Task)
	if !ok || current.ID != task.ID || current.LeaseOwner == "" || current.LeaseOwner != task.LeaseOwner || task.Status != model.TaskStatusRunning || task.LeaseExpiresAt == nil || !task.LeaseExpiresAt.After(time.Now()) {
		return errors.New("本地视频任务租约无效")
	}
	if attempt, _ := ctx.Value(imageAttemptContext{}).(string); attempt == "" {
		return errors.New("本地视频缺少持久提交记录")
	}
	return nil
}

func (r hanbaoReceipt) RecordAccepted(ctx context.Context, id string) error {
	if err := r.Ready(ctx); err != nil {
		return err
	}
	meta, _ := generation.CallMetaFromContext(ctx)
	current, _ := ctx.Value(imageTaskContext{}).(model.Task)
	attempt, _ := ctx.Value(imageAttemptContext{}).(string)
	return r.service.repo.WithContext(ctx).RecordLocalVideoAccepted(meta.TaskID, meta.UserID, current.LeaseOwner, attempt, id)
}
