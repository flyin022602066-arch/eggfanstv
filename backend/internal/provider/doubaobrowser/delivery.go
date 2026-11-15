package doubaobrowser

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) RecordDelivery(userID, taskID string) error {
	if strings.TrimSpace(userID) == "" || !taskIDPattern.MatchString(taskID) {
		return errors.New("本地交付确认缺少有效任务身份")
	}
	directory := filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID))), "deliveries")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	body, err := json.Marshal(map[string]any{"taskId": taskID, "delivered": true})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(directory, ".delivery-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_ = file.Chmod(0600)
	if _, err = file.Write(body); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return errors.Join(err, closeErr)
	}
	return os.Rename(file.Name(), filepath.Join(directory, taskID+".json"))
}

func (s *Service) ReconcileDeliveries(userID string, verify func(string) bool) error {
	if strings.TrimSpace(userID) == "" || verify == nil {
		return errors.New("缺少工作区交付校验")
	}
	file, err := os.Open(filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID))), "pool.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	var pool struct {
		Jobs map[string]struct {
			Phase       string
			DeliveredAt string
		}
	}
	if err := json.NewDecoder(io.LimitReader(file, 32<<20)).Decode(&pool); err != nil {
		return err
	}
	for taskID, job := range pool.Jobs {
		if job.Phase == "success" && job.DeliveredAt == "" && taskIDPattern.MatchString(taskID) && verify(taskID) {
			if err := s.RecordDelivery(userID, taskID); err != nil {
				return err
			}
		}
	}
	return nil
}
