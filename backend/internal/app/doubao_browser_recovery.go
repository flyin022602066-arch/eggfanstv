package app

import (
	"context"
	"errors"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/doubaobrowser"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/taskruntime"
	"strings"
	"time"
)

func (s *Service) startDoubaoBrowserReceiptRecovery() {
	if !s.IsLocalMode() {
		return
	}
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			if !s.IsDraining() {
				_ = s.repo.ResumeUnconfirmedDoubaoBrowserTasks()
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) resumeDoubaoBrowserReceipt(ctx context.Context, task *model.Task) error {
	return s.restoreDoubaoBrowserReceipt(ctx, task, s.DoubaoBrowserDomain().Lookup)
}

func (s *Service) deferDoubaoBrowserReceiptRecovery(task *model.Task, cause error) taskruntime.Outcome {
	captureTaskFailureDiagnostics(task, cause, "local_runtime")
	task.FailureDiagnostics.ExecutionResult = "pending"
	var missing doubaobrowser.ReceiptNotFoundError
	if errors.As(cause, &missing) {
		updated, err := s.repo.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, "原任务回执缺失", missing.Error(), time.Now(), task.FailureDiagnostics)
		if err == nil && !updated {
			err = repository.ErrTaskStateConflict
		}
		return taskruntime.Outcome{Kind: taskruntime.KindUncertain, Err: err, Applied: err == nil}
	}
	err := s.repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "原任务回执查询失败，稍后重查", 15*time.Second, task.FailureDiagnostics)
	return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Err: err, Applied: err == nil}
}

func (s *Service) restoreDoubaoBrowserReceipt(ctx context.Context, task *model.Task, lookup func(context.Context, string, string) (doubaobrowser.Receipt, error)) error {
	if task == nil || task.PollStage != "browser_receipt_lookup" || !strings.HasPrefix(task.Model, "doubao-browser::") {
		return errors.New("不是待核对的豆包浏览器任务")
	}
	receipt, err := lookup(ctx, task.UserID, task.ID)
	if err != nil {
		return err
	}
	if receipt.TaskID != task.ID || !doubaobrowser.ValidReceipt(receipt) {
		return errors.New("原任务回执身份不匹配")
	}
	attempt, err := s.repo.LatestRouteAttempt(task.ID)
	if err != nil {
		return err
	}
	id := generation.EncodeDoubaoBrowserTask(receipt)
	if err := s.repo.WithContext(ctx).RecordLocalVideoAccepted(task.ID, task.UserID, task.LeaseOwner, attempt.ID, id); err != nil {
		return err
	}
	task.ProviderRequestID, task.PollStage = id, "submitted"
	return nil
}
