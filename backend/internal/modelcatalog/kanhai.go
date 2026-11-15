package modelcatalog

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func IsKanhaiBaseURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.Hostname(), "yioapp.top") && strings.TrimRight(parsed.Path, "/") == "/openapi/v1"
}

type kanhaiModel struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	DisplayName           string   `json:"displayName"`
	Type                  string   `json:"type"`
	GenerationType        string   `json:"generationType"`
	Billing               string   `json:"billing"`
	PricingType           string   `json:"pricingType"`
	Points                *float64 `json:"points"`
	NormalPoints          *float64 `json:"normalPoints"`
	MemberPoints          *float64 `json:"memberPoints"`
	NormalPointsPerSecond *float64 `json:"normalPointsPerSecond"`
	MemberPointsPerSecond *float64 `json:"memberPointsPerSecond"`
	EffectivePrice        *struct {
		Points *float64 `json:"points"`
	} `json:"effective_price"`
	Enabled            *bool    `json:"enabled"`
	Maintenance        bool     `json:"maintenance"`
	SupportsRealPerson *bool    `json:"supportsRealPerson"`
	Durations          []int    `json:"durations"`
	DefaultDuration    int      `json:"defaultDuration"`
	AspectRatios       []string `json:"aspectRatios"`
	Resolutions        []string `json:"resolutions"`
	DefaultResolution  string   `json:"defaultResolution"`
	MinImages          int      `json:"minReferenceImages"`
	MaxImages          int      `json:"maxReferenceImages"`
	MaxVideos          int      `json:"maxReferenceVideos"`
	MaxAudios          int      `json:"maxReferenceAudios"`
	PromptMaxChars     int      `json:"max_prompt_length"`
}

func ParseKanhaiVideoCatalog(data []byte) ([]ChannelModelCatalogItem, error) {
	var raw json.RawMessage = data
	var envelope struct {
		Data    json.RawMessage `json:"data"`
		Models  json.RawMessage `json:"models"`
		Error   json.RawMessage `json:"error"`
		Success *bool           `json:"success"`
	}
	if len(data) == 0 {
		return nil, CatalogJSONError{}
	}
	if strings.HasPrefix(strings.TrimSpace(string(data)), "{") {
		if err := json.Unmarshal(data, &envelope); err != nil {
			return nil, CatalogJSONError{Cause: err}
		}
		if envelope.Success != nil && !*envelope.Success || len(envelope.Error) > 0 && string(envelope.Error) != "null" {
			return nil, CatalogUpstreamRejectedError{}
		}
		raw = envelope.Data
		if len(raw) == 0 {
			raw = envelope.Models
		}
		if strings.HasPrefix(strings.TrimSpace(string(raw)), "{") {
			var nested struct {
				Models json.RawMessage `json:"models"`
			}
			if err := json.Unmarshal(raw, &nested); err != nil {
				return nil, CatalogJSONError{Cause: err}
			}
			raw = nested.Models
		}
	}
	var models []kanhaiModel
	if err := json.Unmarshal(raw, &models); err != nil {
		return nil, CatalogJSONError{Cause: err}
	}
	items := []ChannelModelCatalogItem{}
	seen := map[string]bool{}
	for _, entry := range models {
		id := strings.TrimSpace(entry.ID)
		if id == "" || seen[id] || entry.Type != "video" && entry.GenerationType != "video" {
			continue
		}
		seen[id] = true
		label := entry.DisplayName
		if label == "" {
			label = entry.Name
		}
		if label == "" {
			label = id
		}
		unit := "条"
		if entry.Billing == "per_second" || entry.PricingType == "per_second" {
			unit = "秒"
		}
		price, member := entry.NormalPoints, entry.MemberPoints
		if unit == "秒" {
			if entry.NormalPointsPerSecond != nil {
				price = entry.NormalPointsPerSecond
			}
			if entry.MemberPointsPerSecond != nil {
				member = entry.MemberPointsPerSecond
			}
		}
		if price == nil {
			price = entry.Points
		}
		if entry.EffectivePrice != nil && entry.EffectivePrice.Points != nil {
			label += fmt.Sprintf(" · 本账号 %g积分/%s", *entry.EffectivePrice.Points, unit)
		} else if price != nil {
			label += fmt.Sprintf(" · 普通 %g积分/%s", *price, unit)
			if member != nil {
				label += fmt.Sprintf(" / 会员 %g积分/%s", *member, unit)
			}
		} else {
			label += " · 价格以账号目录为准"
		}
		faceSupported := strings.Contains(label, "不卡人脸") || strings.Contains(label, "不卡脸") || strings.Contains(label, "过真人") || strings.Contains(label, "过人脸")
		if strings.Contains(label, "不过人脸") || strings.Contains(label, "不过真人") || strings.Contains(label, "不支持真人") {
			faceSupported = false
		}
		if entry.SupportsRealPerson != nil {
			faceSupported = *entry.SupportsRealPerson
		}
		if faceSupported {
			label += " · 不卡人脸（渠道声明）"
		}
		if entry.Maintenance {
			label += " · 维护中"
		} else if entry.Enabled != nil && !*entry.Enabled {
			label += " · 已关闭"
		}
		video := DefaultModelCapabilityConfigForModel("kanhai-video", id).Video
		video.References = VideoReferenceConfig{PromptMaxChars: entry.PromptMaxChars, MinImages: entry.MinImages, MaxImages: entry.MaxImages, MaxVideos: entry.MaxVideos, MaxAudios: entry.MaxAudios}
		if len(entry.Durations) > 0 {
			defaultDuration := entry.DefaultDuration
			if !containsKanhaiDuration(entry.Durations, defaultDuration) {
				defaultDuration = entry.Durations[len(entry.Durations)-1]
			}
			video.Duration = VideoDurationConfig{Selection: "enum", Values: entry.Durations, Default: defaultDuration}
		}
		video.Ratios, video.Resolutions = entry.AspectRatios, entry.Resolutions
		video.DefaultRatio, video.DefaultResolution = "", ""
		if len(video.Ratios) > 0 {
			video.DefaultRatio = video.Ratios[0]
		}
		if len(video.Resolutions) > 0 {
			video.DefaultResolution = video.Resolutions[0]
		}
		for _, resolution := range entry.Resolutions {
			if resolution == entry.DefaultResolution {
				video.DefaultResolution = resolution
			}
		}
		video.Operations = []string{"text_to_video"}
		if entry.MaxImages > 0 {
			video.Operations = append(video.Operations, "image_to_video", "reference_to_video")
		}
		if entry.MaxAudios > 0 {
			video.Operations = append(video.Operations, "audio_to_video")
		}
		video.DefaultOperation = "text_to_video"
		if entry.MinImages > 0 {
			video.Operations = []string{"image_to_video", "reference_to_video"}
			video.DefaultOperation = "image_to_video"
		}
		capability, err := json.Marshal(video)
		if err != nil {
			return nil, err
		}
		version := "kanhai-v1"
		items = append(items, ChannelModelCatalogItem{ID: id, DisplayName: label, ModelType: "video", SupportedEndpointTypes: []string{"kanhai-video"}, VideoCapabilities: capability, VideoCapabilitiesVersion: &version})
	}
	return items, nil
}

func containsKanhaiDuration(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
