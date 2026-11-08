package app

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	localproject "infinite-canvas/backend/internal/project"
)

const (
	AssetSourceUploaded = localproject.AssetSourceUploaded
	AssetSourceCanvas   = localproject.AssetSourceCanvas
)

type LinkProjectAssetRequest = localproject.LinkProjectAssetRequest
type UpdateProjectAssetRequest = localproject.UpdateProjectAssetRequest
type CreateAssetVersionRequest = localproject.CreateAssetVersionRequest
type ProjectAssetFilter = localproject.ProjectAssetFilter
type ConfirmProjectAssetCandidateRequest = localproject.ConfirmProjectAssetCandidateRequest

type ReplaceProjectAssetImageRequest struct {
	ResourceID string `json:"resourceId"`
}

func (s *Service) FilterProjectAssets(userID string, projectID string, filter ProjectAssetFilter) ([]ProjectAssetSummary, error) {
	return s.projectDomain().FilterProjectAssets(userID, projectID, filter)
}

func (s *Service) ProjectAssets(userID string, projectID string) ([]ProjectAssetSummary, error) {
	return s.projectDomain().ProjectAssets(userID, projectID)
}

func (s *Service) LinkProjectAsset(userID string, projectID string, req LinkProjectAssetRequest) (ProjectAssetSummary, error) {
	return s.projectDomain().LinkProjectAsset(userID, projectID, req)
}

func (s *Service) UnlinkProjectAsset(userID string, projectID string, assetID string) error {
	return s.projectDomain().UnlinkProjectAsset(userID, projectID, assetID)
}

func (s *Service) UpdateProjectAsset(userID string, projectID string, assetID string, req UpdateProjectAssetRequest) (ProjectAssetSummary, error) {
	return s.projectDomain().UpdateProjectAsset(userID, projectID, assetID, req)
}

func (s *Service) CreateProjectAssetVersion(userID string, projectID string, assetID string, req CreateAssetVersionRequest) (model.AssetVersion, error) {
	return s.projectDomain().CreateProjectAssetVersion(userID, projectID, assetID, req)
}

func (s *Service) ReplaceProjectAssetImage(userID string, projectID string, assetID string, req ReplaceProjectAssetImageRequest) (ProjectAssetSummary, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	asset, err := s.repo.AssetForUser(userID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if !linked || (asset.Category != model.AssetCategoryEnvironment && asset.Category != model.AssetCategoryProp) || (asset.Kind != "text" && asset.Kind != "image") {
		return ProjectAssetSummary{}, BadAuthRequest("请选择当前项目的场景或道具设定")
	}
	if strings.TrimSpace(asset.PrimaryVersionID) == "" {
		return ProjectAssetSummary{}, BadAuthRequest("当前资产缺少有效版本，无法替换图片")
	}
	sourceVersion, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if sourceVersion.AssetID != asset.ID {
		return ProjectAssetSummary{}, BadAuthRequest("资产主版本不属于当前资产")
	}
	resource, err := s.repo.ResourceForUser(userID, strings.TrimSpace(req.ResourceID))
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return ProjectAssetSummary{}, BadAuthRequest("所选素材必须是已就绪的图片")
	}

	payload := map[string]any{}
	if strings.TrimSpace(asset.PayloadJSON) != "" {
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
			return ProjectAssetSummary{}, err
		}
	}
	now := time.Now()
	version := model.AssetVersion{
		ID: kernel.NewID(), AssetID: asset.ID, Status: model.AssetVersionStatusConfirmed,
		DefinitionJSON: sourceVersion.DefinitionJSON, Note: "素材库图片替换", CreatedAt: now, UpdatedAt: now,
	}
	payload["kind"], payload["primaryVersionId"], payload["status"] = "image", version.ID, version.Status
	payload["updatedAt"] = now.Format(time.RFC3339Nano)
	payload["data"] = map[string]any{
		"storageKey": "resource:" + resource.ID, "dataUrl": "/api/resources/" + resource.ID + "/file",
		"width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType,
		"content": sourceVersion.DefinitionJSON,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	asset.Kind, asset.Status, asset.PrimaryVersionID, asset.PayloadJSON, asset.UpdatedAt = "image", version.Status, version.ID, string(encoded), now
	representation := model.AssetRepresentation{
		ID: kernel.NewID(), TaskID: kernel.NewID(), AssetVersionID: version.ID, ResourceID: resource.ID,
		MediaType: "image", Role: "primary", MetadataJSON: "{}", CreatedAt: now,
	}
	if err := s.repo.SaveProjectAssetImage(projectID, asset, &version, &representation); err != nil {
		return ProjectAssetSummary{}, err
	}
	assets, err := s.ProjectAssets(userID, projectID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	for _, summary := range assets {
		if summary.ID == asset.ID {
			return summary, nil
		}
	}
	return ProjectAssetSummary{}, BadAuthRequest("资产替换后无法读取项目资产")
}

func (s *Service) ConfirmProjectAssetCandidate(userID string, projectID string, candidateID string, req ConfirmProjectAssetCandidateRequest) (ProjectAssetSummary, error) {
	return s.projectDomain().ConfirmProjectAssetCandidate(userID, projectID, candidateID, req)
}
