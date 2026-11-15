package project

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

type characterFacePreset struct {
	ResourceID    string   `json:"resourceId"`
	FileName      string   `json:"fileName,omitempty"`
	AssetIDs      []string `json:"assetIds"`
	UseAsIdentity bool     `json:"useAsIdentity,omitempty"`
}

func (s *Service) ValidateCharacterFacePresetReference(userID, projectID, assetID, versionID, resourceID string, submittedResourceIDs []string) error {
	project, err := s.Active(userID, projectID)
	if err != nil {
		return err
	}
	if _, err := s.ProjectCharacter(userID, projectID, assetID); err != nil {
		return err
	}
	if err := s.ValidateCharacterTurnaroundSource(userID, assetID, versionID); err != nil {
		return err
	}
	var presets map[string]characterFacePreset
	if err := json.Unmarshal([]byte(project.CharacterFacePresetsJSON), &presets); err != nil {
		return kernel.BadAuthRequest("主角人脸预设已变化，请重新设置")
	}
	for _, role := range []string{"male", "female"} {
		preset := presets[role]
		if !preset.UseAsIdentity || preset.ResourceID != resourceID {
			continue
		}
		bound := false
		for _, candidate := range preset.AssetIDs {
			if candidate == assetID {
				bound = true
				break
			}
		}
		if !bound {
			continue
		}
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil || !readyImageResource(resource) {
			return kernel.BadAuthRequest("主角人脸参考图不可用，请重新上传")
		}
		if len(submittedResourceIDs) != 1 || submittedResourceIDs[0] != resourceID {
			return kernel.BadAuthRequest("主角人脸参考必须单独按已保存的身份预设提交，不得混入其他面孔")
		}
		return nil
	}
	return kernel.BadAuthRequest("主角人脸预设或角色绑定已变化，请刷新后重新核对")
}

func (s *Service) normalizeCharacterFacePresets(userID, projectID, raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	if len(raw) > 64*1024 {
		return "", kernel.BadAuthRequest("主角人脸预设数据过大")
	}
	var entries map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &entries); err != nil || entries == nil {
		return "", kernel.BadAuthRequest("主角人脸预设格式无效")
	}
	normalized := map[string]characterFacePreset{}
	bound := map[string]bool{}
	for role, entry := range entries {
		if role != "male" && role != "female" {
			return "", kernel.BadAuthRequest("主角人脸预设仅支持男主和女主")
		}
		var preset characterFacePreset
		if err := json.Unmarshal(entry, &preset); err != nil {
			return "", kernel.BadAuthRequest("主角人脸预设格式无效")
		}
		preset.ResourceID = strings.TrimSpace(preset.ResourceID)
		if preset.ResourceID == "" {
			return "", kernel.BadAuthRequest("请先上传主角人脸参考图")
		}
		resource, err := s.repo.ResourceForUser(userID, preset.ResourceID)
		if err != nil || !readyImageResource(resource) {
			return "", kernel.BadAuthRequest("主角人脸参考图不存在、尚未就绪或不属于当前用户")
		}
		preset.FileName = strings.TrimSpace(preset.FileName)
		if len([]rune(preset.FileName)) > 255 || len(preset.AssetIDs) > 256 {
			return "", kernel.BadAuthRequest("主角人脸预设的文件名或角色数量过长")
		}
		ids := []string{}
		seen := map[string]bool{}
		for _, value := range preset.AssetIDs {
			assetID := strings.TrimSpace(value)
			if assetID == "" || seen[assetID] {
				continue
			}
			if bound[assetID] {
				return "", kernel.BadAuthRequest("同一角色不能同时绑定男主和女主的人脸")
			}
			asset, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
			if err != nil || asset == nil {
				return "", kernel.BadAuthRequest("人脸预设只能绑定本项目的角色资产")
			}
			seen[assetID], bound[assetID] = true, true
			ids = append(ids, assetID)
		}
		preset.AssetIDs = ids
		normalized[role] = preset
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
