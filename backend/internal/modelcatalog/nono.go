package modelcatalog

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func IsNonoBaseURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.Hostname(), "sub-tz.top") && strings.TrimRight(parsed.Path, "/") == "/prod-api/v1"
}

func ParseNonoVideoCatalog(data []byte) ([]ChannelModelCatalogItem, error) {
	var payload struct {
		Code  *int            `json:"code"`
		Error json.RawMessage `json:"error"`
		Data  []struct {
			ID           string `json:"id"`
			Type         string `json:"type"`
			Capabilities struct {
				Limits map[string]int `json:"maxReferenceUploadsByType"`
			} `json:"capabilities"`
			Specs []struct {
				Code     string   `json:"code"`
				Price    *float64 `json:"price_credits"`
				Billing  string   `json:"billing_unit"`
				Defaults struct {
					Duration   int    `json:"duration"`
					Ratio      string `json:"ratio"`
					Resolution string `json:"resolution"`
				} `json:"default_params"`
				Allowed struct {
					Ratio      []string `json:"ratio"`
					Resolution []string `json:"resolution"`
					Duration   struct {
						Min  int `json:"min"`
						Max  int `json:"max"`
						Step int `json:"step"`
					} `json:"duration"`
				} `json:"allowed_params"`
			} `json:"specs"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, CatalogJSONError{Cause: err}
	}
	if payload.Code != nil && *payload.Code != 0 && *payload.Code != 200 || len(payload.Error) > 0 && string(payload.Error) != "null" {
		return nil, CatalogUpstreamRejectedError{}
	}
	items := []ChannelModelCatalogItem{}
	seen := map[string]bool{}
	for _, entry := range payload.Data {
		if strings.TrimSpace(entry.ID) == "" || !strings.EqualFold(strings.TrimSpace(entry.Type), "VIDEO") || seen[entry.ID] {
			continue
		}
		quotes := make([]string, 0, len(entry.Specs))
		selectedSpec := 0
		for index, spec := range entry.Specs {
			quote := nonoCatalogPrice(spec.Price, spec.Billing)
			if len(entry.Specs) > 1 && strings.TrimSpace(spec.Code) != "" {
				quote = spec.Code + " " + quote
			}
			quotes = append(quotes, quote)
			if spec.Code == "720p" && entry.Specs[selectedSpec].Code != "720p" {
				selectedSpec = index
			}
		}
		if len(quotes) == 0 {
			quotes = append(quotes, "价格未提供")
		}
		item := ChannelModelCatalogItem{ID: entry.ID, DisplayName: entry.ID + " · " + strings.Join(quotes, " / "), ModelType: "video", SupportedEndpointTypes: []string{"nono-video"}}
		if len(entry.Specs) > 0 {
			spec := entry.Specs[selectedSpec]
			video := DefaultModelCapabilityConfigForModel("nono-video", entry.ID).Video
			video.References = VideoReferenceConfig{PromptMaxChars: 15000, MaxImages: entry.Capabilities.Limits["IMAGE"], MaxVideos: entry.Capabilities.Limits["VIDEO"], MaxAudios: entry.Capabilities.Limits["AUDIO"]}
			if spec.Allowed.Duration.Min > 0 && spec.Allowed.Duration.Max >= spec.Allowed.Duration.Min {
				video.Duration = VideoDurationConfig{Selection: "range", Min: spec.Allowed.Duration.Min, Max: spec.Allowed.Duration.Max, Step: spec.Allowed.Duration.Step, Default: spec.Defaults.Duration}
			}
			video.Ratios, video.DefaultRatio = spec.Allowed.Ratio, spec.Defaults.Ratio
			if len(spec.Allowed.Resolution) > 0 {
				video.Resolutions = spec.Allowed.Resolution
				video.DefaultResolution = video.Resolutions[0]
			}
			for _, resolution := range video.Resolutions {
				if resolution == spec.Defaults.Resolution {
					video.DefaultResolution = resolution
				}
			}
			if len(spec.Allowed.Resolution) == 0 && spec.Defaults.Resolution != "" {
				video.Resolutions, video.DefaultResolution = []string{spec.Defaults.Resolution}, spec.Defaults.Resolution
			}
			video.Operations = []string{"text_to_video", "image_to_video", "reference_to_video"}
			if video.References.MaxAudios > 0 {
				video.Operations = append(video.Operations, "audio_to_video")
			}
			capability, err := json.Marshal(video)
			if err != nil {
				return nil, err
			}
			version := "nono-v1"
			item.VideoCapabilities, item.VideoCapabilitiesVersion = capability, &version
		}
		items = append(items, item)
		seen[entry.ID] = true
	}
	return items, nil
}

func nonoCatalogPrice(price *float64, billing string) string {
	if price == nil || *price < 0 {
		return "价格未提供"
	}
	unit := strings.TrimSpace(billing)
	switch strings.ToUpper(unit) {
	case "REQUEST", "VIDEO":
		unit = "条"
	case "SECOND":
		unit = "秒"
	case "":
		return fmt.Sprintf("%g积分（计费单位未提供）", *price)
	}
	return fmt.Sprintf("%g积分/%s", *price, unit)
}
