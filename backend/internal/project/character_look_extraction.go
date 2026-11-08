package project

import (
	"encoding/json"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/characterlooks"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"time"
)

type characterLookKeys map[string]map[string]bool

func countCharacterLooks(versions []model.AssetVersion) int {
	groups := map[string]bool{}
	for _, version := range versions {
		if version.Status == model.AssetVersionStatusArchived {
			continue
		}
		if profile := referenceProfile(version.ReferenceProfileJSON); profile != nil && profile.LookID != "" {
			groups[profile.LookID] = true
			continue
		}
		var definition map[string]any
		if json.Unmarshal([]byte(version.DefinitionJSON), &definition) != nil {
			continue
		}
		looks, err := characterlooks.Extract(definition)
		if err != nil {
			continue
		}
		for _, look := range looks {
			groups[characterlooks.Key(look)] = true
		}
	}
	return len(groups)
}

func addCharacterLookKeys(index characterLookKeys, identities []string, definition map[string]any) {
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return
	}
	for _, identity := range identities {
		if identity == "" {
			continue
		}
		if index[identity] == nil {
			index[identity] = map[string]bool{}
		}
		for _, look := range looks {
			index[identity][characterlooks.Key(look)] = true
		}
	}
}

func (s *Service) projectCharacterLookKeys(candidates []model.ProjectAssetCandidate, assets []model.Asset) (characterLookKeys, error) {
	result := characterLookKeys{}
	for _, asset := range assets {
		if asset.Category != model.AssetCategoryCharacter {
			continue
		}
		versions, err := s.repo.AssetVersions(asset.ID)
		if err != nil {
			return nil, err
		}
		identities := []string{asset.ID, model.AssetCandidateNameKey(asset.Title)}
		for _, version := range versions {
			if version.Status == model.AssetVersionStatusArchived {
				continue
			}
			var d map[string]any
			if json.Unmarshal([]byte(version.DefinitionJSON), &d) == nil {
				addCharacterLookKeys(result, identities, d)
			}
		}
	}
	for _, candidate := range candidates {
		if candidate.Category != model.AssetCategoryCharacter || candidate.Status != "pending_confirmation" {
			continue
		}
		var d map[string]any
		if json.Unmarshal([]byte(candidate.DetailsJSON), &d) == nil {
			identities := []string{model.AssetCandidateNameKey(candidate.Name)}
			var match struct {
				AssetID string `json:"assetId"`
			}
			if encoded, err := json.Marshal(d["_characterMatch"]); err == nil && json.Unmarshal(encoded, &match) == nil {
				for _, asset := range assets {
					if asset.ID == match.AssetID && asset.Category == model.AssetCategoryCharacter {
						identities = append(identities, asset.ID, model.AssetCandidateNameKey(asset.Title))
					}
				}
			}
			addCharacterLookKeys(result, identities, d)
		}
	}
	return result, nil
}

func newCharacterCandidateLooks(definition map[string]any, identities []string, index characterLookKeys) (map[string]any, bool, error) {
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return nil, false, kernel.BadAuthRequest(err.Error())
	}
	fresh := []characterlooks.Look{}
	seen := map[string]bool{}
	for _, look := range looks {
		key := characterlooks.Key(look)
		exists := seen[key]
		for _, identity := range identities {
			exists = exists || index[identity][key]
		}
		if !exists {
			fresh = append(fresh, look)
			seen[key] = true
		}
	}
	if len(fresh) == 0 {
		return nil, false, nil
	}
	result := make(map[string]any, len(definition))
	for k, v := range definition {
		result[k] = v
	}
	if len(fresh) != len(looks) {
		result["looks"] = fresh
		result["clothing"] = fresh[0].Clothing
	}
	return result, true, nil
}

type ExtractCharacterLooksRequest struct {
	BaseVersionID     string    `json:"baseVersionId"`
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
}

func (s *Service) ValidateCharacterTurnaroundSource(userID, assetID, versionID string) error {
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return err
	}
	if asset.Category != model.AssetCategoryCharacter {
		return kernel.BadAuthRequest("请选择角色资产")
	}
	version, err := s.repo.AssetVersion(versionID)
	if err != nil {
		return err
	}
	if version.Status == model.AssetVersionStatusArchived {
		return gorm.ErrRecordNotFound
	}
	if version.AssetID != asset.ID {
		return kernel.BadAuthRequest("角色版本不属于该角色")
	}
	var definition map[string]any
	if json.Unmarshal([]byte(version.DefinitionJSON), &definition) != nil {
		return kernel.BadAuthRequest("角色设定格式无效")
	}
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return kernel.BadAuthRequest(err.Error())
	}
	if len(looks) > 1 {
		return kernel.BadAuthRequest("当前设定包含多套造型，请先在造型与版本中拆分，再逐套生成图片")
	}
	return nil
}

func (s *Service) ExtractCharacterLooks(userID, projectID, assetID string, req ExtractCharacterLooksRequest) ([]model.AssetVersion, error) {
	if _, err := s.Active(userID, projectID); err != nil {
		return nil, err
	}
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
	if err != nil {
		return nil, err
	}
	base, err := s.repo.AssetVersionForProject(projectID, req.BaseVersionID)
	if err != nil {
		return nil, err
	}
	if base.Status == model.AssetVersionStatusArchived {
		return nil, gorm.ErrRecordNotFound
	}
	if base.AssetID != assetID || req.ExpectedUpdatedAt.IsZero() || !base.UpdatedAt.Equal(req.ExpectedUpdatedAt) {
		return nil, kernel.BadAuthRequest("角色版本已变化，请刷新后拆分")
	}
	var d map[string]any
	if err := json.Unmarshal([]byte(base.DefinitionJSON), &d); err != nil {
		return nil, err
	}
	looks, err := characterlooks.Extract(d)
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	if len(looks) < 2 {
		return nil, kernel.BadAuthRequest("当前设定未发现多套造型，请使用新建造型填写")
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	maxVersion := 0
	for _, v := range versions {
		if v.Version > maxVersion {
			maxVersion = v.Version
		}
		if v.Status == model.AssetVersionStatusArchived {
			continue
		}
		if p := referenceProfile(v.ReferenceProfileJSON); p != nil {
			seen[p.LookID] = true
		}
	}
	nextAsset := *asset
	created := []model.AssetVersion{}
	voices := []model.CharacterVoiceBinding{}
	for _, look := range looks {
		key := characterlooks.Key(look)
		if seen[key] {
			continue
		}
		b := *asset
		b.PrimaryVersionID = base.ID
		encoded, _ := json.Marshal(characterlooks.Definition(d, look))
		a, v, _, voice, err := s.prepareNextCharacterVersion(&b, asset.Title, string(encoded), []model.AssetRepresentation{}, nil, false)
		if err != nil {
			return nil, err
		}
		maxVersion++
		v.Version = maxVersion
		v.Prompt = ""
		profile, _ := json.Marshal(CharacterReferenceProfile{LookID: key, Name: look.Name, Description: look.Clothing, MatchHints: look.MatchHints, ExcludeHints: look.ExcludeHints, Enabled: true})
		v.ReferenceProfileJSON = string(profile)
		if len(created) == 0 {
			nextAsset = a
		}
		created = append(created, v)
		if voice != nil {
			voices = append(voices, *voice)
		}
		seen[key] = true
	}
	if len(created) == 0 {
		return created, nil
	}
	if err := s.repo.SaveExtractedCharacterLooks(userID, projectID, asset.PrimaryVersionID, base.ID, req.ExpectedUpdatedAt, &nextAsset, created, voices); err != nil {
		return nil, mapProjectWriteError(err)
	}
	return created, nil
}

func isolatedCharacterLookVersions(version *model.AssetVersion, source string) ([]model.AssetVersion, error) {
	var definition map[string]any
	if err := json.Unmarshal([]byte(source), &definition); err != nil {
		return nil, kernel.BadAuthRequest("角色造型设定格式无效")
	}
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	if len(looks) < 2 && definition["looks"] == nil {
		return nil, nil
	}
	var extra []model.AssetVersion
	original := *version
	for i, look := range looks {
		item := original
		if i > 0 {
			item.ID = kernel.NewID()
			item.Version += i
		}
		data, err := json.Marshal(characterlooks.Definition(definition, look))
		if err != nil {
			return nil, err
		}
		description := look.Clothing
		if look.ChangeReason != "" {
			description += "；差异：" + look.ChangeReason
		}
		if look.SourceEvidence != "" {
			description += "；原文：" + look.SourceEvidence
		}
		profile, err := json.Marshal(CharacterReferenceProfile{LookID: characterlooks.Key(look), Name: look.Name, Description: description, MatchHints: look.MatchHints, ExcludeHints: look.ExcludeHints, Enabled: true})
		if err != nil {
			return nil, err
		}
		item.DefinitionJSON = string(data)
		item.ReferenceProfileJSON = string(profile)
		item.Prompt = ""
		if i == 0 {
			*version = item
		} else {
			extra = append(extra, item)
		}
	}
	return extra, nil
}
