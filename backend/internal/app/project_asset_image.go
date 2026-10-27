package app

import (
	"encoding/json"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) projectImageAsset(userID, projectID, assetID, versionID string) (*model.Asset, *model.AssetVersion, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, nil, err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return nil, nil, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, assetID)
	if err != nil {
		return nil, nil, err
	}
	if !linked || (asset.Category != model.AssetCategoryEnvironment && asset.Category != model.AssetCategoryProp) || (asset.Kind != "text" && asset.Kind != "image") {
		return nil, nil, BadAuthRequest("请选择当前项目的场景或道具设定")
	}
	version, err := s.repo.AssetVersion(versionID)
	if err != nil {
		return nil, nil, err
	}
	if version.AssetID != asset.ID {
		return nil, nil, BadAuthRequest("资产版本不属于当前资产")
	}
	return asset, version, nil
}

func (s *Service) validateProjectAssetImageTask(userID, projectID, taskType string, input map[string]any) error {
	metadata, _ := input["metadata"].(map[string]any)
	if metadata["operation"] != "project_asset_image" {
		return nil
	}
	if taskType != "canvas_image" || input["mode"] != "image" {
		return BadAuthRequest("资产生图必须使用图片任务")
	}
	assetID, _ := metadata["assetId"].(string)
	versionID, _ := metadata["assetVersionId"].(string)
	_, _, err := s.projectImageAsset(userID, projectID, strings.TrimSpace(assetID), strings.TrimSpace(versionID))
	return err
}

func (s *Service) finalizeProjectAssetImage(task model.Task, inputJSON string) (bool, error) {
	var input struct {
		Metadata struct {
			Operation      string `json:"operation"`
			AssetID        string `json:"assetId"`
			AssetVersionID string `json:"assetVersionId"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return false, err
	}
	if input.Metadata.Operation != "project_asset_image" {
		return false, nil
	}
	if task.Status != model.TaskStatusSucceeded || task.Type != "canvas_image" {
		return false, BadAuthRequest("只有成功的图片任务才能绑定资产")
	}
	s.characterTaskMu.Lock()
	defer s.characterTaskMu.Unlock()
	bound, err := s.repo.AssetRepresentationsForTask(task.ID)
	if err != nil {
		return false, err
	}
	for _, representation := range bound {
		if representation.Role != "primary" {
			continue
		}
		version, err := s.repo.AssetVersion(representation.AssetVersionID)
		if err != nil {
			return false, err
		}
		if version.AssetID == input.Metadata.AssetID {
			return true, nil
		}
	}
	asset, sourceVersion, err := s.projectImageAsset(task.UserID, task.ProjectID, input.Metadata.AssetID, input.Metadata.AssetVersionID)
	if err != nil {
		return false, err
	}
	var output characterTurnaroundTaskResult
	if err := json.Unmarshal([]byte(task.ResultJSON), &output); err != nil {
		return false, err
	}
	if len(output.Images) == 0 || strings.TrimSpace(output.Images[0].ResourceID) == "" {
		return false, BadAuthRequest("资产生图没有返回已保存的图片资源")
	}
	resource, err := s.repo.ResourceForUser(task.UserID, output.Images[0].ResourceID)
	if err != nil {
		return false, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return false, BadAuthRequest("生成的资产图片尚不可用")
	}
	now := time.Now()
	version := model.AssetVersion{ID: newID(), AssetID: asset.ID, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: sourceVersion.DefinitionJSON, Prompt: task.Prompt, Note: "资产图生成", CreatedAt: now, UpdatedAt: now}
	var payload map[string]any
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		return false, err
	}
	if payload == nil {
		payload = map[string]any{}
	}
	payload["kind"], payload["primaryVersionId"], payload["status"] = "image", version.ID, version.Status
	payload["updatedAt"] = now.Format(time.RFC3339Nano)
	payload["data"] = map[string]any{"storageKey": "resource:" + resource.ID, "dataUrl": "/api/resources/" + resource.ID + "/file", "width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType, "content": sourceVersion.DefinitionJSON}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}
	asset.Kind, asset.Status, asset.PrimaryVersionID, asset.PayloadJSON, asset.UpdatedAt = "image", version.Status, version.ID, string(encoded), now
	representation := model.AssetRepresentation{ID: newID(), TaskID: task.ID, AssetVersionID: version.ID, ResourceID: resource.ID, MediaType: "image", Role: "primary", MetadataJSON: "{}", CreatedAt: now}
	if err := s.repo.SaveProjectAssetImage(task.ProjectID, asset, &version, &representation); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) reconcileProjectAssetImageTasks(userID, projectID string) bool {
	tasks, err := s.repo.UnboundProjectAssetImageTasks(userID, projectID)
	if err != nil {
		log.Printf("restore project asset images failed: %v", err)
		return false
	}
	recovered := false
	for _, task := range tasks {
		inputJSON, err := s.decryptTaskInputJSON(task.InputJSON)
		if err == nil {
			var applied bool
			applied, err = s.finalizeProjectAssetImage(task, inputJSON)
			recovered = recovered || applied
		}
		if err != nil {
			log.Printf("restore project asset image failed: task=%s error=%v", task.ID, err)
		}
	}
	return recovered
}
