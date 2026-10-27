package generation

import (
	"net/url"
	"strings"
)

func IsGeminiNanoBananaModel(name string) bool {
	name = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(name)), "models/")
	name = strings.TrimSuffix(strings.TrimSuffix(name, "-nothinking"), "-thinking")
	return name == "gemini-nano-banana-2.1"
}

func GeminiNanoBananaThinkingConfig(Config Config) map[string]string {
	if !IsGeminiNanoBananaModel(Config.Model) {
		return nil
	}
	switch Config.ImageThinkingLevel {
	case "minimal", "high":
		return map[string]string{"thinkingLevel": Config.ImageThinkingLevel}
	default:
		return nil
	}
}

func IsEggfansNanoBananaConfig(Config Config) bool {
	if Config.InterfaceType != "gemini-image" || !IsGeminiNanoBananaModel(Config.Model) {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(Config.BaseURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	return strings.EqualFold(parsed.Hostname(), "api.eggfans.com") || strings.EqualFold(parsed.Hostname(), "api.eggfans.org")
}
