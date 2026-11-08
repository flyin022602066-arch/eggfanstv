package project

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/characterlooks"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type characterCandidateMatch struct {
	AssetID     string `json:"assetId,omitempty"`
	Title       string `json:"title"`
	Mode        string `json:"mode"`
	Description string `json:"description"`
}

func (s *Service) matchingProjectCharactersWithCandidates(assets []model.Asset, candidates []model.ProjectAssetCandidate, name string, details map[string]any) ([]model.Asset, error) {
	nameKey := model.AssetCandidateNameKey(name)
	incomingAliases := assetCandidateAliases(details)
	var matches []model.Asset
	bestRank := 0
	for _, asset := range assets {
		if asset.Category != model.AssetCategoryCharacter {
			continue
		}
		keys := append([]string{model.AssetCandidateNameKey(asset.Title)}, characterAssetAliasKeys(asset.PayloadJSON)...)
		for _, candidate := range candidates {
			if candidate.Category != model.AssetCategoryCharacter || candidate.Status != "confirmed" || candidate.ResolvedAssetID != asset.ID {
				continue
			}
			keys = append(keys, model.AssetCandidateNameKey(candidate.Name))
		}
		versions, err := s.repo.AssetVersions(asset.ID)
		if err != nil {
			return nil, err
		}
		for _, version := range versions {
			if version.Status == model.AssetVersionStatusArchived {
				continue
			}
			var definition map[string]any
			if json.Unmarshal([]byte(version.DefinitionJSON), &definition) == nil {
				keys = append(keys, assetCandidateAliases(definition)...)
			}
		}
		rank := 0
		titleKey := model.AssetCandidateNameKey(asset.Title)
		if nameKey != "" && nameKey == titleKey {
			rank = 3
		} else {
			for _, key := range keys {
				if nameKey != "" && nameKey == key {
					rank = 2
				}
			}
			if rank == 0 {
				for _, alias := range incomingAliases {
					if alias != "" && alias == titleKey {
						rank = 1
					}
				}
			}
		}
		if rank > bestRank {
			matches = nil
			bestRank = rank
		}
		if rank > 0 && rank == bestRank {
			matches = append(matches, asset)
		}
	}
	return matches, nil
}

func provenCharacterLookChanges(definition map[string]any, source string) (map[string]any, bool, error) {
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return nil, false, err
	}
	var changes []characterlooks.Look
	for _, look := range looks {
		if strings.TrimSpace(look.ChangeReason) != "" && len([]rune(strings.TrimSpace(look.SourceEvidence))) >= 4 && strings.Contains(source, strings.TrimSpace(look.SourceEvidence)) {
			changes = append(changes, look)
		}
	}
	if len(changes) == 0 {
		return definition, false, nil
	}
	result := make(map[string]any, len(definition))
	for key, value := range definition {
		result[key] = value
	}
	result["looks"] = changes
	result["clothing"] = changes[0].Clothing
	return result, true, nil
}

func confirmedChapterCharacterTarget(matches []model.Asset, candidates []model.ProjectAssetCandidate, unitID, name string) []model.Asset {
	if len(matches) < 2 {
		return matches
	}
	targets := map[string]bool{}
	for _, candidate := range candidates {
		if candidate.Category == model.AssetCategoryCharacter && candidate.Status == "confirmed" && candidate.UnitID == unitID && model.AssetCandidateNameKey(candidate.Name) == model.AssetCandidateNameKey(name) {
			targets[candidate.ResolvedAssetID] = true
		}
	}
	var selected []model.Asset
	for _, asset := range matches {
		if targets[asset.ID] {
			selected = append(selected, asset)
		}
	}
	if len(selected) == 1 {
		return selected
	}
	return matches
}

func characterCandidateDescription(definition map[string]any) string {
	looks, err := characterlooks.Extract(definition)
	if err != nil {
		return ""
	}
	var descriptions []string
	for _, look := range looks {
		descriptions = append(descriptions, look.Name+"："+look.Clothing+"；差异："+look.ChangeReason+"；原文："+look.SourceEvidence)
	}
	return strings.Join(descriptions, "\n")
}

func (s *Service) confirmReusedCharacterCandidate(userID, projectID string, candidate *model.ProjectAssetCandidate, assetID string) (AssetSummary, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
	if err != nil {
		return AssetSummary{}, err
	}
	candidate.Status, candidate.ResolvedAssetID, candidate.UpdatedAt = "confirmed", asset.ID, time.Now()
	link := model.ProjectAssetLink{ID: kernel.NewID(), ProjectID: projectID, AssetID: asset.ID, CreatedAt: time.Now()}
	if err := s.repo.ConfirmProjectAssetCandidateActive(userID, candidate, asset, &model.AssetVersion{}, &link, false); err != nil {
		return AssetSummary{}, mapProjectWriteError(err)
	}
	return s.assetSummary(userID, projectID, asset)
}
