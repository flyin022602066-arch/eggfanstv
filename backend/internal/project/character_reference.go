package project

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type CharacterReferenceProfile struct {
	LookID       string `json:"lookId"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	MatchHints   string `json:"matchHints"`
	ExcludeHints string `json:"excludeHints"`
	Enabled      bool   `json:"enabled"`
	Preferred    bool   `json:"preferred"`
	Default      bool   `json:"default"`
}

type CharacterReferenceVersion struct {
	CharacterCardSummary
	AssetID          string                     `json:"assetId"`
	Title            string                     `json:"title"`
	ReferenceProfile *CharacterReferenceProfile `json:"referenceProfile,omitempty"`
	UpdatedAt        time.Time                  `json:"updatedAt"`
}

type CharacterReferenceCatalog struct {
	Versions []CharacterReferenceVersion `json:"versions"`
	Revision int64                       `json:"revision"`
}

type SaveCharacterReferenceProfileRequest struct {
	Profile           CharacterReferenceProfile `json:"profile"`
	ExpectedUpdatedAt time.Time                 `json:"expectedUpdatedAt"`
}

type CreateCharacterLookRequest struct {
	BaseVersionID string                    `json:"baseVersionId"`
	Profile       CharacterReferenceProfile `json:"profile"`
	Definition    map[string]any            `json:"definition"`
}

type CharacterReferenceChoice struct {
	ShotID                 string `json:"shotId"`
	AssetID                string `json:"assetId"`
	VersionID              string `json:"versionId"`
	Status                 string `json:"status"`
	Source                 string `json:"source"`
	Locked                 bool   `json:"locked"`
	Reason                 string `json:"reason"`
	ExpectedShotRevisionID string `json:"expectedShotRevisionId"`
}

type SaveCharacterReferenceChoicesRequest struct {
	ExpectedRevision int64                      `json:"expectedRevision"`
	Choices          []CharacterReferenceChoice `json:"choices"`
}

func referenceProfile(raw string) *CharacterReferenceProfile {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var result CharacterReferenceProfile
	if json.Unmarshal([]byte(raw), &result) != nil {
		return nil
	}
	return &result
}

func normalizeReferenceProfile(profile CharacterReferenceProfile) (CharacterReferenceProfile, error) {
	profile.LookID = strings.TrimSpace(profile.LookID)
	profile.Name = strings.TrimSpace(profile.Name)
	profile.Description = strings.TrimSpace(profile.Description)
	profile.MatchHints = strings.TrimSpace(profile.MatchHints)
	profile.ExcludeHints = strings.TrimSpace(profile.ExcludeHints)
	if profile.Name == "" || len([]rune(profile.Name)) > 80 || len(profile.LookID) > 80 || len([]rune(profile.Description)) > 4000 || len([]rune(profile.MatchHints)) > 2000 || len([]rune(profile.ExcludeHints)) > 2000 {
		return profile, kernel.BadAuthRequest("造型名称或描述长度无效")
	}
	if profile.LookID == "" {
		profile.LookID = kernel.NewID()
	}
	if !profile.Enabled {
		profile.Preferred = false
		profile.Default = false
	}
	if profile.Default {
		profile.Preferred = true
	}
	return profile, nil
}

func (s *Service) CharacterReferenceCatalog(userID, projectID string) (CharacterReferenceCatalog, error) {
	project, err := s.Owned(userID, projectID)
	if err != nil {
		return CharacterReferenceCatalog{}, err
	}
	assets, err := s.repo.ProjectAssets(userID, projectID)
	if err != nil {
		return CharacterReferenceCatalog{}, err
	}
	result := CharacterReferenceCatalog{Revision: project.Revision, Versions: []CharacterReferenceVersion{}}
	for _, asset := range assets {
		if asset.Category != model.AssetCategoryCharacter {
			continue
		}
		versions, err := s.repo.AssetVersions(asset.ID)
		if err != nil {
			return result, err
		}
		for _, version := range versions {
			if version.Status == model.AssetVersionStatusArchived {
				continue
			}
			card, err := s.characterVersionCard(userID, version)
			if err != nil {
				return result, err
			}
			result.Versions = append(result.Versions, CharacterReferenceVersion{CharacterCardSummary: card, AssetID: asset.ID, Title: asset.Title, ReferenceProfile: referenceProfile(version.ReferenceProfileJSON), UpdatedAt: version.UpdatedAt})
		}
	}
	return result, nil
}

func (s *Service) DeleteCharacterLookVersion(userID, projectID, assetID, versionID string, expectedUpdatedAt time.Time) error {
	project, err := s.Active(userID, projectID)
	if err != nil {
		return err
	}
	if project.Status != model.ProjectStatusActive {
		return kernel.BadAuthRequest("项目不是活动状态，不能删除角色造型")
	}
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
	if err != nil {
		return err
	}
	if expectedUpdatedAt.IsZero() {
		return kernel.BadAuthRequest("缺少造型修订时间，请刷新后再删除")
	}
	version, err := s.repo.AssetVersionForProject(projectID, versionID)
	if err != nil {
		return err
	}
	if version.AssetID != assetID || version.Status == model.AssetVersionStatusArchived {
		return gorm.ErrRecordNotFound
	}
	if !version.UpdatedAt.Equal(expectedUpdatedAt) {
		return mapProjectWriteError(repository.ErrProjectRevisionConflict)
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return err
	}
	var alternate *model.AssetVersion
	for index := range versions {
		candidate := &versions[index]
		if candidate.ID == versionID || candidate.Status == model.AssetVersionStatusArchived {
			continue
		}
		if alternate == nil {
			alternate = candidate
		}
		if s.requireCharacterReferenceImage(userID, candidate.ID) == nil {
			alternate = candidate
			break
		}
	}
	if alternate == nil {
		return kernel.BadAuthRequest(repository.ErrCharacterLookLastVersion.Error())
	}
	nextAsset := *asset
	if asset.PrimaryVersionID == versionID {
		nextAsset.PrimaryVersionID = alternate.ID
		nextAsset.Status = alternate.Status
		nextAsset.PayloadJSON, err = characterAssetPayload(asset.ID, alternate.ID, asset.Title, json.RawMessage(alternate.DefinitionJSON), asset.CreatedAt, time.Now())
		if err != nil {
			return kernel.BadAuthRequest("备选造型设定无效，请修复后再删除")
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(nextAsset.PayloadJSON), &payload); err != nil {
			return err
		}
		payload["status"] = alternate.Status
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		nextAsset.PayloadJSON = string(encoded)
	}
	err = s.repo.ArchiveCharacterLookVersion(userID, projectID, assetID, versionID, expectedUpdatedAt, asset.PrimaryVersionID, asset.UpdatedAt, &nextAsset, alternate)
	if errors.Is(err, repository.ErrCharacterLookReferenced) || errors.Is(err, repository.ErrCharacterLookTaskBusy) || errors.Is(err, repository.ErrCharacterLookCanvasInvalid) {
		return kernel.WrapAppError(kernel.CodeConflict, err.Error(), err)
	}
	if errors.Is(err, repository.ErrCharacterLookLastVersion) {
		return kernel.BadAuthRequest(err.Error())
	}
	return mapProjectWriteError(err)
}

func (s *Service) SaveCharacterReferenceProfile(userID, projectID, assetID, versionID string, req SaveCharacterReferenceProfileRequest) error {
	if _, err := s.Active(userID, projectID); err != nil {
		return err
	}
	if _, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID); err != nil {
		return err
	}
	version, err := s.repo.AssetVersionForProject(projectID, versionID)
	if err != nil {
		return err
	}
	if version.Status == model.AssetVersionStatusArchived {
		return gorm.ErrRecordNotFound
	}
	if version.AssetID != assetID || req.ExpectedUpdatedAt.IsZero() {
		return kernel.BadAuthRequest("角色版本不匹配或缺少修订时间，请刷新")
	}
	profile, err := normalizeReferenceProfile(req.Profile)
	if err != nil {
		return err
	}
	if profile.Preferred || profile.Default {
		if err := s.requireCharacterReferenceImage(userID, version.ID); err != nil {
			return err
		}
	}
	encoded, err := json.Marshal(profile)
	if err != nil {
		return err
	}
	return mapProjectWriteError(s.repo.SaveCharacterReferenceProfile(userID, projectID, assetID, versionID, req.ExpectedUpdatedAt, string(encoded), profile.LookID, profile.Preferred, profile.Default))
}

func (s *Service) CreateCharacterLook(userID, projectID, assetID string, req CreateCharacterLookRequest) (model.AssetVersion, error) {
	if _, err := s.Active(userID, projectID); err != nil {
		return model.AssetVersion{}, err
	}
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	base, err := s.repo.AssetVersionForProject(projectID, req.BaseVersionID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	if base.Status == model.AssetVersionStatusArchived {
		return model.AssetVersion{}, gorm.ErrRecordNotFound
	}
	if base.AssetID != assetID {
		return model.AssetVersion{}, kernel.BadAuthRequest("基础版本不属于该角色")
	}
	profile, err := normalizeReferenceProfile(req.Profile)
	if err != nil {
		return model.AssetVersion{}, err
	}
	// 新造型在补齐图片并指定定稿后才进入自动选择。
	profile.Preferred = false
	profile.Default = false
	definition, err := normalizedCharacterDefinition(req.Definition)
	if err != nil {
		return model.AssetVersion{}, err
	}
	baseAsset := *asset
	baseAsset.PrimaryVersionID = base.ID
	nextAsset, next, reps, voice, err := s.prepareNextCharacterVersion(&baseAsset, asset.Title, string(definition), []model.AssetRepresentation{}, nil, false)
	if err != nil {
		return model.AssetVersion{}, err
	}
	encoded, _ := json.Marshal(profile)
	next.ReferenceProfileJSON = string(encoded)
	if err := s.repo.SaveCharacterVersionActive(userID, projectID, asset.PrimaryVersionID, &nextAsset, &next, reps, voice); err != nil {
		return model.AssetVersion{}, mapProjectWriteError(err)
	}
	return next, nil
}

func (s *Service) SaveCharacterReferenceChoices(userID, projectID, unitID string, req SaveCharacterReferenceChoicesRequest) error {
	if _, err := s.Active(userID, projectID); err != nil {
		return err
	}
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return err
	}
	if req.ExpectedRevision < 1 || len(req.Choices) < 1 || len(req.Choices) > 1000 {
		return kernel.BadAuthRequest("角色引用更新数量或项目修订无效")
	}
	seen := map[string]bool{}
	updates := make([]repository.CharacterReferenceUpdate, 0, len(req.Choices))
	for _, choice := range req.Choices {
		key := choice.ShotID + ":" + choice.AssetID
		if seen[key] || choice.ExpectedShotRevisionID == "" || (choice.Status != "resolved" && choice.Status != "pending") || (choice.Source != "manual" && choice.Source != "auto" && choice.Source != "rule") || strings.TrimSpace(choice.Reason) == "" || len([]rune(choice.Reason)) > 4000 || (choice.Source != "manual" && choice.Locked) {
			return kernel.BadAuthRequest("角色选择重复或缺少有效的状态、来源、理由和脚本修订")
		}
		seen[key] = true
		if _, err := s.repo.ProjectCharacterAsset(userID, projectID, choice.AssetID); err != nil {
			return err
		}
		version, err := s.repo.AssetVersionForProject(projectID, choice.VersionID)
		if err != nil {
			return err
		}
		if version.AssetID != choice.AssetID {
			return kernel.BadAuthRequest("所选版本不属于该角色")
		}
		if version.Status == model.AssetVersionStatusArchived {
			return gorm.ErrRecordNotFound
		}
		if choice.Status == "resolved" {
			if err := s.requireCharacterReferenceImage(userID, version.ID); err != nil {
				return err
			}
			if choice.Source == "auto" {
				profile := referenceProfile(version.ReferenceProfileJSON)
				if profile == nil || !profile.Enabled || !profile.Preferred {
					return kernel.BadAuthRequest("自动选择仅能使用已启用的造型定稿")
				}
			}
		}
		updates = append(updates, repository.CharacterReferenceUpdate{AssetID: choice.AssetID, ExpectedShotRevisionID: choice.ExpectedShotRevisionID, Reference: model.ShotAssetReference{
			ID: kernel.NewID(), ShotID: choice.ShotID, AssetVersionID: version.ID, Role: "reference", Status: "linked", CreatedAt: time.Now(),
			SelectionStatus: choice.Status, SelectionSource: choice.Source, SelectionLocked: choice.Locked, SelectionReason: strings.TrimSpace(choice.Reason), SelectionRevisionID: choice.ExpectedShotRevisionID,
		}})
	}
	return mapProjectWriteError(s.repo.SaveCharacterReferenceChoices(userID, projectID, unitID, req.ExpectedRevision, updates))
}

func (s *Service) requireCharacterReferenceImage(userID, versionID string) error {
	reps, err := s.repo.AssetRepresentations(versionID)
	if err != nil {
		return err
	}
	for _, rep := range reps {
		resource, err := s.repo.ResourceForUser(userID, rep.ResourceID)
		if err == nil && readyImageResource(resource) && !strings.Contains(rep.Role, "expression") && (rep.MediaType == "image" || strings.HasPrefix(rep.MediaType, "image/")) {
			return nil
		}
	}
	return kernel.BadAuthRequest("所选造型缺少可用参考图，请先补齐图片")
}

type CharacterReferenceSnapshot struct {
	AssetID    string `json:"assetId"`
	VersionID  string `json:"versionId"`
	ResourceID string `json:"resourceId"`
}

type CharacterReferenceSubmission struct {
	ProjectID  string                       `json:"domainProjectId"`
	UnitID     string                       `json:"unitId"`
	ShotID     string                       `json:"shotId"`
	RevisionID string                       `json:"shotRevisionId"`
	Snapshot   []CharacterReferenceSnapshot `json:"characterReferenceSnapshot"`
}

// 在任务入队前核对镜头当前绑定与实际发送资源，不依赖浏览器声明的判定状态。
func (s *Service) ValidateCharacterReferenceSubmission(userID string, req CharacterReferenceSubmission, imageResourceIDs []string) error {
	if req.ProjectID == "" || req.UnitID == "" || req.ShotID == "" || req.RevisionID == "" {
		return kernel.BadAuthRequest("缺少镜头造型提交上下文")
	}
	workspace, err := s.ProjectUnitWorkspace(userID, req.ProjectID, req.UnitID)
	if err != nil {
		return err
	}
	current := ""
	for _, shot := range workspace.Shots {
		if shot.ID == req.ShotID {
			current = shot.CurrentRevisionID
		}
	}
	if current == "" || current != req.RevisionID {
		return kernel.BadAuthRequest("镜头脚本已变化，请刷新后确认造型")
	}
	seen := map[string]bool{}
	for _, ref := range workspace.ShotReferences {
		if ref.ShotID != req.ShotID || ref.Role != "reference" || ref.Status != "linked" || ref.Asset.Category != model.AssetCategoryCharacter {
			continue
		}
		assetID := ref.ReferencedVersion.AssetID
		if seen[assetID] {
			return kernel.BadAuthRequest("同一角色绑定多个版本，请确认造型或拆镜头")
		}
		seen[assetID] = true
		if ref.SelectionStatus == "pending" || ref.SelectionSource == "auto" && !ref.SelectionLocked && ref.SelectionRevisionID != current || ref.ReferencedVersion.ReferenceProfile != nil && ref.SelectionStatus == "" {
			return kernel.BadAuthRequest("角色造型待确认，请重新识别或手动选择")
		}
		var selected *CharacterReferenceSnapshot
		for i := range req.Snapshot {
			if req.Snapshot[i].AssetID == assetID {
				if selected != nil {
					return kernel.BadAuthRequest("角色参考快照重复")
				}
				selected = &req.Snapshot[i]
			}
		}
		if selected == nil || selected.VersionID != ref.AssetVersionID {
			return kernel.BadAuthRequest("角色绑定已变化，请刷新参考图后重试")
		}
		validImage := false
		for _, rep := range ref.ReferencedVersion.Representations {
			if rep.ResourceID != selected.ResourceID || strings.Contains(rep.Role, "expression") || !(rep.MediaType == "image" || strings.HasPrefix(rep.MediaType, "image/")) {
				continue
			}
			resource, err := s.repo.ResourceForUser(userID, rep.ResourceID)
			if err == nil && readyImageResource(resource) {
				for _, imageID := range imageResourceIDs {
					if imageID == rep.ResourceID {
						validImage = true
					}
				}
			}
		}
		if !validImage {
			return kernel.BadAuthRequest("造型参考图缺失或与绑定版本不符")
		}
	}
	if len(seen) != len(req.Snapshot) {
		return kernel.BadAuthRequest("角色参考快照与当前镜头不符")
	}
	return nil
}
