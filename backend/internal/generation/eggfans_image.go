package generation

import (
	"net/url"
	"strings"
)

func IsEggfansGPTImageConfig(Config Config) bool {
	if Config.InterfaceType != "openai-image" {
		return false
	}
	baseURL, err := url.Parse(strings.TrimSpace(Config.BaseURL))
	if err != nil || (baseURL.Scheme != "https" && baseURL.Scheme != "http") {
		return false
	}
	host := strings.ToLower(baseURL.Hostname())
	if host != "api.eggfans.com" && host != "api.eggfans.org" {
		return false
	}
	modelName := strings.ToLower(strings.TrimSpace(Config.Model))
	return modelName == "gpt-image-2" || strings.HasPrefix(modelName, "gpt-image-2-") || modelName == "gpt-image-2.5" || strings.HasPrefix(modelName, "gpt-image-2.5-")
}

func EggfansImageRequestBody(Config Config, path string, body map[string]any) map[string]any {
	isGeneration := path == "/images/generations" || path == "/v1/images/generations"
	if !IsEggfansGPTImageConfig(Config) || (!isGeneration && path != "/images/edits" && path != "/v1/images/edits") {
		return body
	}
	normalized := make(map[string]any, len(body)+1)
	for key, value := range body {
		normalized[key] = value
	}
	if current, exists := normalized["moderation"]; !exists || current == nil || current == "" {
		normalized["moderation"] = "low"
	}
	if format, exists := normalized["output_format"]; isGeneration && exists {
		delete(normalized, "output_format")
		if current, exists := normalized["format"]; !exists || current == nil || current == "" {
			normalized["format"] = format
		}
	}
	return normalized
}
