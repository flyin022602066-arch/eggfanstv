package modelcatalog

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

var gwayIntegerRange = regexp.MustCompile(`^\s*(\d+)\s*(?:[~～–—-]\s*(\d+))?\s*$`)

func isGwayBaseURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "gway.dev", "www.gway.dev", "ai.jiasuapi.com":
		return true
	}
	return false
}

func parseGwayVideoCatalog(data []byte, apiFormat string) ([]ChannelModelCatalogItem, error) {
	items, err := ParseChannelModelCatalog(data, apiFormat)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID         string          `json:"id"`
			Name       string          `json:"name"`
			ModelName  string          `json:"model_name"`
			Parameters json.RawMessage `json:"api_parameters"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, CatalogJSONError{Cause: err}
	}
	parametersByModel := make(map[string]json.RawMessage, len(payload.Data))
	for _, entry := range payload.Data {
		name := strings.TrimPrefix(kernel.FirstNonEmpty(entry.ID, entry.Name, entry.ModelName), "models/")
		parametersByModel[name] = entry.Parameters
	}
	for index := range items {
		item := &items[index]
		videoEndpoint := false
		for _, endpoint := range item.SupportedEndpointTypes {
			videoEndpoint = videoEndpoint || endpoint == "openai-video"
		}
		if !videoEndpoint {
			continue
		}
		raw := parametersByModel[item.ID]
		var encoded string
		if json.Unmarshal(raw, &encoded) == nil {
			raw = []byte(encoded)
		}
		var parameters []struct {
			Name    string `json:"name"`
			Range   string `json:"range"`
			Default any    `json:"default"`
		}
		if json.Unmarshal(raw, &parameters) != nil {
			continue
		}
		video := DefaultModelCapabilityConfigForModel("jiasu-video", item.ID).Video
		parsed := false
		for _, parameter := range parameters {
			defaultValue := ""
			if parameter.Default != nil {
				defaultValue = fmt.Sprint(parameter.Default)
			}
			switch parameter.Name {
			case "duration":
				minimum, maximum, ok := gwayRangeBounds(parameter.Range)
				if !ok || minimum <= 0 {
					continue
				}
				seconds, _ := strconv.Atoi(defaultValue)
				if seconds < minimum || seconds > maximum {
					seconds = minimum
				}
				video.Duration = VideoDurationConfig{Selection: "range", Min: minimum, Max: maximum, Step: 1, Default: seconds}
			case "ratio", "resolution":
				values := []string{}
				for _, value := range strings.FieldsFunc(parameter.Range, func(character rune) bool { return character == ',' || character == '，' || character == '、' }) {
					if trimmed := strings.TrimSpace(value); trimmed != "" {
						values = appendUniqueString(values, trimmed)
					}
				}
				if len(values) == 0 {
					continue
				}
				selected := values[0]
				for _, value := range values {
					if value == defaultValue {
						selected = value
					}
				}
				if parameter.Name == "ratio" {
					video.Ratios, video.DefaultRatio = values, selected
				} else {
					video.Resolutions, video.DefaultResolution = values, selected
				}
			case "images", "videos", "audios":
				_, maximum, ok := gwayRangeBounds(parameter.Range)
				if !ok {
					continue
				}
				switch parameter.Name {
				case "images":
					video.References.MaxImages = maximum
				case "videos":
					video.References.MaxVideos = maximum
				case "audios":
					video.References.MaxAudios = maximum
				}
			default:
				continue
			}
			parsed = true
		}
		if !parsed {
			continue
		}
		capability, err := json.Marshal(video)
		if err != nil {
			return nil, err
		}
		version := "gway-api-parameters-v1"
		item.ModelType, item.VideoCapabilities, item.VideoCapabilitiesVersion = "video", capability, &version
	}
	return items, nil
}

func gwayRangeBounds(value string) (int, int, bool) {
	match := gwayIntegerRange.FindStringSubmatch(value)
	if len(match) == 0 {
		return 0, 0, false
	}
	minimum, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, 0, false
	}
	maximum := minimum
	if match[2] != "" {
		maximum, err = strconv.Atoi(match[2])
	}
	return minimum, maximum, err == nil && maximum >= minimum
}
