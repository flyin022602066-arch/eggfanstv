package project

import (
	"encoding/json"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/characterlooks"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func characterIdentityLookKey(version model.AssetVersion) string {
	var definition map[string]any
	_ = json.Unmarshal([]byte(version.DefinitionJSON), &definition)
	fields := []string{}
	for _, key := range []string{"clothing", "ageStage", "age", "hairstyle", "state"} {
		value, _ := definition[key].(string)
		fields = append(fields, strings.TrimSpace(value))
	}
	encoded, _ := json.Marshal(fields)
	return "definition:" + string(encoded)
}

func sameCharacterIdentityLook(left, right model.AssetVersion) bool {
	leftProfile, rightProfile := referenceProfile(left.ReferenceProfileJSON), referenceProfile(right.ReferenceProfileJSON)
	if leftProfile != nil && rightProfile != nil && leftProfile.LookID != "" && rightProfile.LookID != "" {
		return leftProfile.LookID == rightProfile.LookID
	}
	return characterIdentityLookKey(left) == characterIdentityLookKey(right)
}

func (s *Service) ValidateCharacterIdentityReference(userID, assetID, versionID, referenceVersionID, resourceID string, submittedResourceIDs []string) error {
	if err := s.ValidateCharacterTurnaroundSource(userID, assetID, versionID); err != nil {
		return err
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return err
	}
	sort.Slice(versions, func(left, right int) bool { return versions[left].Version < versions[right].Version })
	var base, target *model.AssetVersion
	for index := range versions {
		version := &versions[index]
		if version.Status == model.AssetVersionStatusArchived {
			continue
		}
		if base == nil {
			var definition map[string]any
			if err := json.Unmarshal([]byte(version.DefinitionJSON), &definition); err != nil {
				return kernel.BadAuthRequest("角色基础设定格式无效，请修复后重试")
			}
			looks, err := characterlooks.Extract(definition)
			if err != nil {
				return kernel.BadAuthRequest(err.Error())
			}
			if len(looks) == 1 {
				base = version
			}
		}
		if version.ID == versionID {
			target = version
		}
	}
	if base == nil || target == nil {
		return kernel.BadAuthRequest("角色版本已变化，请刷新后重试")
	}
	for _, version := range versions {
		if version.Status == model.AssetVersionStatusArchived || version.Version >= base.Version && !sameCharacterIdentityLook(version, *base) {
			continue
		}
		reps, err := s.repo.AssetRepresentations(version.ID)
		if err != nil {
			return err
		}
		var images []model.AssetRepresentation
		for _, rep := range reps {
			if rep.ResourceID == "" || strings.Contains(rep.Role, "expression") || !(rep.MediaType == "image" || strings.HasPrefix(rep.MediaType, "image/")) {
				continue
			}
			images = append(images, rep)
		}
		if len(images) == 0 {
			continue
		}
		chosen := images[0]
		for _, role := range []string{"primary", "front", "turnaround_sheet", "side", "back"} {
			found := false
			for _, image := range images {
				if image.Role == role {
					chosen = image
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		resource, err := s.repo.ResourceForUser(userID, chosen.ResourceID)
		if err != nil || !readyImageResource(resource) {
			return kernel.BadAuthRequest("基础版人脸参考不可用，请先修复或上传基础造型图片")
		}
		if version.ID != referenceVersionID || chosen.ResourceID != resourceID {
			return kernel.BadAuthRequest("基础版身份参考已变化或缺失，请刷新后按基础图编辑造型")
		}
		if len(submittedResourceIDs) != 1 || submittedResourceIDs[0] != resourceID {
			return kernel.BadAuthRequest("角色造型必须携带基础版原图进行图片编辑，不能重新文生图换脸")
		}
		return nil
	}
	if !sameCharacterIdentityLook(*target, *base) {
		return kernel.BadAuthRequest("请先生成或上传基础造型图片，其他形态必须沿用基础版人脸编辑")
	}
	if referenceVersionID != "" || resourceID != "" {
		return kernel.BadAuthRequest("基础版人脸参考不存在，请刷新后重试")
	}
	return nil
}
