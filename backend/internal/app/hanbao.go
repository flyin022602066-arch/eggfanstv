package app

import (
	"context"
	"errors"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/provider/hanbao"
)

func (s *Service) HanbaoDomain() *hanbao.Service {
	if s == nil || !s.IsLocalMode() { return nil }
	s.hanbaoOnce.Do(func() { s.hanbao = hanbao.New(s.dataDir) })
	return s.hanbao
}

type hanbaoReceipt struct{ service *Service }

func (r hanbaoReceipt) Ready(ctx context.Context) error {
	if err := ctx.Err(); err != nil { return err }
	meta, _ := generation.CallMetaFromContext(ctx)
	if r.service == nil || r.service.repo == nil || meta.UserID == "" || meta.TaskID == "" { return errors.New("憨包缺少本地任务回执上下文") }
	if _, err := r.service.repo.TaskForUser(meta.UserID, meta.TaskID); err != nil { return err }
	return nil
}

func (r hanbaoReceipt) RecordAccepted(ctx context.Context, id string) error {
	if err := r.Ready(ctx); err != nil { return err }
	meta, _ := generation.CallMetaFromContext(ctx)
	return r.service.repo.UpdateTaskProviderState(meta.TaskID, id, "submitted", nil)
}
