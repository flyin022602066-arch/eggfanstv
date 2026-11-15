package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type ImageResultRecovery struct {
	Task      *model.Task `json:"task"`
	Status    string      `json:"status"`
	Message   string      `json:"message"`
	Recovered bool        `json:"recovered"`
}

func (s *Service) RecoverImageTaskResult(ctx context.Context, userID, taskID string) (*ImageResultRecovery, error) {
	task, err := s.repo.TaskForUser(strings.TrimSpace(userID), strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if task.Type != "canvas_image" {
		return nil, BadAuthRequest("该任务不是图片生成任务")
	}
	respond := func(status, message string, recovered bool) (*ImageResultRecovery, error) {
		return &ImageResultRecovery{Task: taskForOutput(*task), Status: status, Message: message, Recovered: recovered}, nil
	}
	if task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusQueued {
		return respond("pending", "原任务仍在后台处理中，已刷新状态；不会重复提交生成。", false)
	}
	if task.Status == model.TaskStatusCancelled {
		return respond("unavailable", "本地任务已停止，本次仅检查记录，不会重新提交生成。", false)
	}
	var result map[string]interface{}
	if json.Unmarshal([]byte(task.ResultJSON), &result) != nil || !storedImageResultPresent(result) {
		return respond("unavailable", "本地未保留完整图片结果。当前同步图片接口没有可用的原结果查询记录，无法凭本地任务 ID 补取；请保留任务记录向渠道核对。本次不会重新提交生成或重复扣费。", false)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if task.Status == model.TaskStatusFailed {
		owner := "manual-recovery:" + newID()
		if err := s.repo.ClaimFailedTaskProviderRecovery(task.ID, task.UserID, owner, providerTaskRecoveryLeaseDuration); err != nil {
			if errors.Is(err, repository.ErrTaskProviderRecoveryConflict) {
				return nil, &AuthError{Status: 409, Message: "原图片结果正在取回，请勿重复点击"}
			}
			return nil, err
		}
		defer s.repo.ReleaseTaskProviderRecovery(task.ID, owner)
		task.LeaseOwner = owner
	}
	result, err = s.persistTaskGeneratedMediaResult(*task, result)
	if err != nil {
		return nil, fmt.Errorf("原图片结果保存失败：%w", err)
	}
	if err := s.persistRecoveredImageURLs(ctx, *task, result); err != nil {
		return nil, fmt.Errorf("原图片文件取回失败：%w", err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if task.Status == model.TaskStatusFailed || string(encoded) != task.ResultJSON {
		if _, err := s.finalizeCharacterTurnaroundTask(*task, result); err != nil {
			return nil, err
		}
		task.Error, task.FailureDiagnostics = "", nil
		if err := s.saveTaskCompletionWithinStorageQuota(task, encoded, nil, false); err != nil {
			return nil, err
		}
	}
	if err := s.DeliverSucceededTask(*task); err != nil {
		return nil, fmt.Errorf("原图片结果入库失败：%w", err)
	}
	if _, err := s.finalizeCharacterTurnaroundTask(*task, result); err != nil {
		return nil, err
	}
	if err := s.RegisterTaskOutputFromTask(*task); err != nil {
		return nil, fmt.Errorf("原图片结果绑定资产失败：%w", err)
	}
	s.attachTaskDelivery(task)
	if task.ResultState != "READY" {
		return respond("pending", "原图片结果尚未完成入库，请检查资源状态或稍后再次取回；不会重新生成。", false)
	}
	return respond("ready", "已检查并取回原图片结果，同步素材库及对应资产；没有重新提交生成。", true)
}

func (s *Service) persistRecoveredImageURLs(ctx context.Context, task model.Task, result map[string]interface{}) error {
	images, _ := result["images"].([]interface{})
	if len(images) == 0 {
		if image, ok := result["image"].(map[string]interface{}); ok {
			images = []interface{}{image}
			result["images"] = images
		}
	}
	for index, value := range images {
		if err := ctx.Err(); err != nil {
			return err
		}
		image := value.(map[string]interface{})
		if stringField(image, "resourceId") != "" {
			continue
		}
		if key := stringField(image, "storageKey"); strings.HasPrefix(key, "resource:") {
			image["resourceId"] = strings.TrimPrefix(key, "resource:")
			continue
		}
		url := stringField(image, "url")
		if url == "" {
			url = stringField(image, "dataUrl")
		}
		media := s.deliveryMedia()
		if media == nil {
			return errors.New("本地资源存储尚不可用")
		}
		resource, err := media.PersistRemoteArtifact(task.UserID, "image", url, task.ID+":"+strconv.Itoa(index))
		if err != nil {
			return err
		}
		if resource == nil || resource.ID == "" {
			return errors.New("图片文件未保存为本地资源")
		}
		image["resourceId"], image["storageKey"] = resource.ID, "resource:"+resource.ID
		image["url"], image["dataUrl"] = "/api/resources/"+resource.ID+"/file", "/api/resources/"+resource.ID+"/file"
		image["width"], image["height"], image["bytes"], image["mimeType"] = resource.Width, resource.Height, resource.Size, resource.MimeType
	}
	return nil
}

func storedImageResultPresent(result map[string]interface{}) bool {
	images, _ := result["images"].([]interface{})
	if image, ok := result["image"].(map[string]interface{}); ok {
		images = append(images, image)
	}
	if len(images) == 0 {
		return false
	}
	for _, value := range images {
		image, ok := value.(map[string]interface{})
		if !ok {
			return false
		}
		if stringField(image, "resourceId") == "" && stringField(image, "storageKey") == "" && stringField(image, "dataUrl") == "" && stringField(image, "url") == "" {
			return false
		}
	}
	return true
}
