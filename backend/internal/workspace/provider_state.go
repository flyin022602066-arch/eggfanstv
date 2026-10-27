package workspace

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/providerpreset"
)

const providerStateSchemaVersion = 1

var currentGwayVideoModels = map[string]struct{}{
	"minimax-h3":            {},
	"seedance-2.5-g4-m1-官转": {},
	"wan3.0-超限":             {},
	"seedance2.0-g2-o1":     {},
	"seedance2.0":           {},
	"seedance2.0-g2-o2":     {},
	"seedance-2.0-fast-G3":  {},
	"seedance2.0-g5-v":      {},
	"seedance2.0-g5-v2":     {},
	"seedance-2.5-g2-2":     {},
	"seedance2.5":           {},
	"seedance2.0-g4-官转":     {},
	"seedance-2.0-mini-G3":  {},
	"seedance-2.5-g4-m-官转":  {},
	"seedance-2.5-g4-官转":    {},
	"seedance-2.5-g5-L":     {},
	"seedance-2.5-G1":       {},
	"seedance-2.5-g2-1":     {},
	"seedance-2.5-g2-c1":    {},
	"seedance2.0-g2-m1":     {},
	"seedance-2.5-g5-v2":    {},
}

type ConfigHealth string

const (
	ConfigHealthReady     ConfigHealth = "ready"
	ConfigHealthDefault   ConfigHealth = "default"
	ConfigHealthMigrated  ConfigHealth = "migrated"
	ConfigHealthRecovered ConfigHealth = "recovered"
)

type ProviderStateDocument struct {
	SchemaVersion                 int            `json:"schemaVersion"`
	Revision                      int64          `json:"revision"`
	PresetVersions                map[string]int `json:"presetVersions"`
	Config                        map[string]any `json:"config"`
	AssistantDefaultAuthorization string         `json:"assistantDefaultAuthorization,omitempty"`
}

type EffectiveModelConfig struct {
	SchemaVersion  int            `json:"schemaVersion"`
	Revision       int64          `json:"revision"`
	PresetVersions map[string]int `json:"presetVersions"`
	Config         map[string]any `json:"config"`
}

func newProviderState(config map[string]any, revision int64) ProviderStateDocument {
	return ProviderStateDocument{
		SchemaVersion:  providerStateSchemaVersion,
		Revision:       revision,
		PresetVersions: builtinPresetVersions(),
		Config:         config,
	}
}

func effectiveProviderState(document ProviderStateDocument) (EffectiveModelConfig, error) {
	config, err := mergeBuiltinProviderPresets(document.Config)
	if err != nil {
		return EffectiveModelConfig{}, err
	}
	return EffectiveModelConfig{
		SchemaVersion:  providerStateSchemaVersion,
		Revision:       document.Revision,
		PresetVersions: builtinPresetVersions(),
		Config:         config,
	}, nil
}

func mergeBuiltinProviderPresets(config map[string]any) (map[string]any, error) {
	result, err := cloneMap(config)
	if err != nil {
		return nil, err
	}
	channels := map[string]map[string]any{}
	order := make([]string, 0)
	if rawChannels, ok := result["channels"].([]any); ok {
		for _, raw := range rawChannels {
			channel, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			id, _ := channel["id"].(string)
			if id == "" {
				continue
			}
			channels[id] = channel
			order = append(order, id)
		}
	}
	migrateLegacyTopLevelModels(result, channels)

	for _, preset := range providerpreset.BuiltinChannels() {
		local := channels[preset.ID]
		merged, err := presetChannelMap(preset, local)
		if err != nil {
			return nil, err
		}
		channels[preset.ID] = merged
		if !containsString(order, preset.ID) {
			order = append([]string{preset.ID}, order...)
		}
	}

	mergedChannels := make([]any, 0, len(order))
	for _, id := range order {
		if channel := channels[id]; channel != nil {
			mergedChannels = append(mergedChannels, overlayHostedBeefAPIVideoProfiles(channel))
		}
	}
	result["channels"] = mergedChannels
	normalizeEggfansSeedanceChannels(result)
	normalizeJiasuVideoChannels(result)
	return result, nil
}

func normalizeJiasuVideoChannels(config map[string]any) {
	channels, _ := config["channels"].([]any)
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["id"] != "jiasu-video" && channel["interfaceType"] != "jiasu-video" {
			continue
		}
		baseURL, _ := channel["baseUrl"].(string)
		if strings.EqualFold(strings.TrimRight(strings.TrimSpace(baseURL), "/"), "https://ai.jiasuapi.com") {
			channel["baseUrl"] = "https://www.gway.dev"
		}
		catalogURL, _ := channel["catalogUrl"].(string)
		if strings.EqualFold(strings.TrimRight(strings.TrimSpace(catalogURL), "/"), "https://ai.jiasuapi.com/pricing") {
			channel["catalogUrl"] = "https://www.gway.dev/pricing"
		}
	}
}

func migrateLegacyTopLevelModels(config map[string]any, channels map[string]map[string]any) {
	modelsByChannel := map[string][]string{}
	for _, key := range []string{"models", "imageModels", "videoModels", "textModels", "audioModels"} {
		rawModels, ok := config[key].([]any)
		if !ok {
			continue
		}
		for _, rawModel := range rawModels {
			value, ok := rawModel.(string)
			if !ok {
				continue
			}
			channelID, model, ok := strings.Cut(strings.TrimSpace(value), "::")
			if !ok {
				continue
			}
			channelID = strings.TrimSpace(channelID)
			model = strings.TrimSpace(model)
			if channelID == "" || model == "" || containsString(modelsByChannel[channelID], model) {
				continue
			}
			modelsByChannel[channelID] = append(modelsByChannel[channelID], model)
		}
	}

	for channelID, models := range modelsByChannel {
		channel := channels[channelID]
		if channel == nil || hasNonEmptyModels(channel["models"]) {
			continue
		}
		migrated := make([]any, 0, len(models))
		for _, model := range models {
			migrated = append(migrated, model)
		}
		channel["models"] = migrated
	}
}

func hasNonEmptyModels(value any) bool {
	switch models := value.(type) {
	case []any:
		for _, model := range models {
			if text, ok := model.(string); ok && strings.TrimSpace(text) != "" {
				return true
			}
		}
	case []string:
		for _, model := range models {
			if strings.TrimSpace(model) != "" {
				return true
			}
		}
	}
	return false
}

func overlayHostedBeefAPIVideoProfiles(channel map[string]any) map[string]any {
	baseURL, _ := channel["baseUrl"].(string)
	profiles, _ := channel["modelProfiles"].([]any)
	seen := map[string]bool{}
	next := make([]any, 0, len(profiles))
	for _, raw := range profiles {
		profile, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		model, _ := profile["model"].(string)
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		seen[model] = true
		if capability, protocol, ok := providerpreset.HostedBeefAPIVideoProfile(baseURL, model); ok {
			overlaid := cloneProfileMap(profile)
			overlaid["capability"] = capability
			overlaid["protocol"] = protocol
			next = append(next, overlaid)
			continue
		}
		next = append(next, profile)
	}
	for _, model := range channelModelIDs(channel["models"]) {
		if seen[model] {
			continue
		}
		capability, protocol, ok := providerpreset.HostedBeefAPIVideoProfile(baseURL, model)
		if !ok {
			continue
		}
		next = append(next, map[string]any{"model": model, "capability": capability, "protocol": protocol})
	}
	channel["modelProfiles"] = next
	return channel
}

func cloneProfileMap(profile map[string]any) map[string]any {
	cloned := make(map[string]any, len(profile))
	for key, value := range profile {
		cloned[key] = value
	}
	return cloned
}

func channelModelIDs(value any) []string {
	switch items := value.(type) {
	case []string:
		ids := make([]string, 0, len(items))
		for _, item := range items {
			if model := strings.TrimSpace(item); model != "" {
				ids = append(ids, model)
			}
		}
		return ids
	case []any:
		ids := make([]string, 0, len(items))
		for _, item := range items {
			model, _ := item.(string)
			if model = strings.TrimSpace(model); model != "" {
				ids = append(ids, model)
			}
		}
		return ids
	default:
		return nil
	}
}

func presetChannelMap(preset providerpreset.ChannelPreset, local map[string]any) (map[string]any, error) {
	models := make([]string, 0, len(preset.Models))
	profiles := make([]any, 0, len(preset.Models))
	presetModels := make(map[string]struct{}, len(preset.Models))
	for _, profile := range preset.Models {
		models = append(models, profile.Model)
		presetModels[profile.Model] = struct{}{}
		var capabilityConfig any
		if err := json.Unmarshal(profile.CapabilityConfig, &capabilityConfig); err != nil {
			return nil, fmt.Errorf("decode %s capability config: %w", profile.Model, err)
		}
		profiles = append(profiles, map[string]any{
			"model": profile.Model, "capability": profile.Capability,
			"protocol": profile.Protocol, "capabilityConfig": capabilityConfig,
		})
	}
	if localModels, ok := local["models"].([]any); ok {
		for _, value := range localModels {
			model, ok := value.(string)
			if !ok || model == "" {
				continue
			}
			if preset.ID == "jiasu-video" && !gwayModelAllowedDuringMigration(local, model) {
				continue
			}
			if _, managed := presetModels[model]; !managed && !containsString(models, model) {
				models = append(models, model)
			}
		}
	}
	if localProfiles, ok := local["modelProfiles"].([]any); ok {
		for _, value := range localProfiles {
			profile, ok := value.(map[string]any)
			if !ok {
				continue
			}
			model, _ := profile["model"].(string)
			if preset.ID == "jiasu-video" && !containsString(models, model) {
				continue
			}
			if preset.ID == "mints-seedance" {
				for _, candidate := range profiles {
					managed := candidate.(map[string]any)
					if managed["model"] != model {
						continue
					}
					for _, key := range []string{"defaultOptions", "displayName", "capabilityConfig"} {
						if value, exists := profile[key]; exists {
							managed[key] = value
						}
					}
				}
			}
			if _, managed := presetModels[model]; model != "" && !managed {
				profiles = append(profiles, profile)
			}
		}
	}
	result := map[string]any{
		"id": preset.ID, "name": preset.DisplayName, "baseUrl": preset.BaseURL, "catalogUrl": preset.CatalogURL,
		"apiFormat": preset.CatalogProtocol, "scope": "user", "pinned": preset.Pinned,
		"presetVersion": preset.PresetVersion, "models": models, "modelProfiles": profiles,
		"apiKey": "", "secretKey": "", "headers": []any{}, "enabled": true,
	}
	for _, key := range []string{"name", "baseUrl", "catalogUrl", "apiFormat", "apiKey", "secretKey", "headers", "enabled"} {
		if value, ok := local[key]; ok {
			if isLegacyBeefAPIDefault(preset, key, value) {
				continue
			}
			result[key] = value
		}
	}
	if preset.ID == "beefapi" {
		base, _ := local["baseUrl"].(string)
		if base == "https://enterprise.beefapi.com" || base == "https://beeftv.app" {
			result["baseUrl"] = base
		} else if key, _ := local["apiKey"].(string); base == "" && key != "" {
			// Pre-brand manual credentials without an origin were issued by BeefAPI.
			result["baseUrl"] = "https://enterprise.beefapi.com"
		}
	}
	return result, nil
}

func gwayModelAllowedDuringMigration(local map[string]any, model string) bool {
	if _, ok := currentGwayVideoModels[strings.TrimSpace(model)]; ok {
		return true
	}
	// Once the Gway catalog has been saved at the current preset version, the
	// saved model list is authoritative and may contain newly published IDs.
	version, _ := local["presetVersion"].(float64)
	return version >= 3
}

func isLegacyBeefAPIDefault(preset providerpreset.ChannelPreset, key string, value any) bool {
	if preset.ID != "beefapi" {
		return false
	}
	text, ok := value.(string)
	if !ok {
		return false
	}
	switch key {
	case "name":
		return strings.EqualFold(strings.TrimSpace(text), "BeefAPI")
	case "baseUrl":
		return strings.EqualFold(strings.TrimRight(strings.TrimSpace(text), "/"), "https://enterprise.beefapi.com")
	default:
		return false
	}
}

func builtinPresetVersions() map[string]int {
	versions := make(map[string]int)
	for _, preset := range providerpreset.BuiltinChannels() {
		versions[preset.ID] = preset.PresetVersion
	}
	return versions
}

func cloneMap(value map[string]any) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var clone map[string]any
	if err := json.Unmarshal(body, &clone); err != nil {
		return nil, err
	}
	return clone, nil
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
