package workspace

import (
	"net/url"
	"strings"
)

func normalizeEggfansSeedanceChannels(config map[string]any) {
	channels, _ := config["channels"].([]any)
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		baseURL, _ := channel["baseUrl"].(string)
		parsed, err := url.Parse(baseURL)
		if err != nil || !strings.EqualFold(parsed.Hostname(), "api.eggfans.com") {
			continue
		}
		if credentialRef, _ := channel["credentialRef"].(string); credentialRef == "beefapi-enterprise" {
			continue
		}
		profiles, _ := channel["modelProfiles"].([]any)
		byModel := map[string]map[string]any{}
		for _, rawProfile := range profiles {
			if profile, ok := rawProfile.(map[string]any); ok {
				name, _ := profile["model"].(string)
				byModel[name] = profile
			}
		}
		models, _ := channel["models"].([]any)
		for _, rawModel := range models {
			name, ok := rawModel.(string)
			if !ok || !strings.Contains(strings.ToLower(name), "seedance") {
				continue
			}
			profile := byModel[name]
			if profile == nil {
				profile = map[string]any{"model": name}
				profiles = append(profiles, profile)
				byModel[name] = profile
			}
			if protocol, _ := profile["protocol"].(string); protocol != "eggfans-seedance-video" && protocol != "eggfans-volc-video" {
				profile["protocol"] = "eggfans-seedance-video"
			}
			profile["capability"] = "video"
			if strings.Contains(strings.ToLower(name), "seedance-2-5") || strings.Contains(strings.ToLower(name), "seedance-2.5") {
				capabilities, _ := profile["capabilityConfig"].(map[string]any)
				if capabilities != nil {
					video, _ := capabilities["video"].(map[string]any)
					if video != nil {
						references, _ := video["references"].(map[string]any)
						if references != nil {
							references["maxImages"], references["maxVideos"], references["maxAudios"] = 30, 10, 10
						}
					}
				}
			}
		}
		channel["modelProfiles"] = profiles
	}
}
