package project

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

func (s *Service) MergeSameNameProjectProps(userID, projectID string) (MergeSameNameProjectPropsResult, error) {
	if _, err := s.Active(userID, projectID); err != nil {
		return MergeSameNameProjectPropsResult{}, err
	}
	merged, deferred, err := s.repo.MergeSameNameProjectProps(userID, projectID)
	return MergeSameNameProjectPropsResult{Merged: merged, Deferred: deferred}, mapProjectWriteError(err)
}

func (s *Service) MergeProjectProp(userID, projectID, sourceID string, req MergeProjectPropRequest) (MergeProjectPropResult, error) {
	if _, err := s.Active(userID, projectID); err != nil {
		return MergeProjectPropResult{}, err
	}
	sourceID, req.TargetAssetID = strings.TrimSpace(sourceID), strings.TrimSpace(req.TargetAssetID)
	if sourceID == "" || req.TargetAssetID == "" || sourceID == req.TargetAssetID || req.ExpectedRevision < 1 {
		return MergeProjectPropResult{}, kernel.BadAuthRequest("请选择另一个保留的道具，并刷新项目后重试")
	}
	shots, err := s.repo.MergeProjectProp(userID, projectID, sourceID, req.TargetAssetID, req.ExpectedRevision)
	if err != nil {
		return MergeProjectPropResult{}, mapProjectWriteError(err)
	}
	asset, err := s.repo.AssetForUser(userID, req.TargetAssetID)
	if err != nil {
		return MergeProjectPropResult{}, err
	}
	summary, err := s.assetSummary(userID, projectID, asset)
	return MergeProjectPropResult{Asset: summary, MergedShots: shots}, err
}

func (s *Service) mergedPropDefinition(projectID, assetID, definitionJSON string) (string, error) {
	candidates, err := s.repo.ProjectPropMergeAliases(projectID, assetID)
	if err != nil || len(candidates) == 0 {
		return definitionJSON, err
	}
	definition := map[string]any{}
	if json.Unmarshal([]byte(definitionJSON), &definition) != nil || definition == nil {
		definition = map[string]any{"description": definitionJSON}
	}
	aliases := []string{}
	seen := map[string]bool{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			aliases = append(aliases, value)
		}
	}
	if existing, ok := definition["aliases"].([]any); ok {
		for _, value := range existing {
			if name, ok := value.(string); ok {
				add(name)
			}
		}
	}
	for _, candidate := range candidates {
		add(candidate.Name)
		var details struct {
			Aliases []string `json:"aliases"`
		}
		if json.Unmarshal([]byte(candidate.DetailsJSON), &details) == nil {
			for _, name := range details.Aliases {
				add(name)
			}
		}
	}
	definition["aliases"] = aliases
	encoded, err := json.Marshal(definition)
	return string(encoded), err
}
