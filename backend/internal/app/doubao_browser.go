package app

import "infinite-canvas/backend/internal/provider/doubaobrowser"

func (s *Service) DoubaoBrowserDomain() *doubaobrowser.Service {
	if s == nil || !s.IsLocalMode() {
		return nil
	}
	s.doubaoBrowserOnce.Do(func() { s.doubaoBrowser = doubaobrowser.New(s.dataDir) })
	return s.doubaoBrowser
}

func (s *Service) ReconcileDoubaoBrowserDeliveries(userID string) error {
	return s.DoubaoBrowserDomain().ReconcileDeliveries(userID, func(taskID string) bool {
		task, err := s.repo.TaskForUser(userID, taskID)
		if err != nil {
			return false
		}
		_, recovered, err := s.recoverDoubaoBrowserArchive(*task)
		return recovered && err == nil
	})
}
