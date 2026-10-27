package handler

import (
	"errors"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var (
	sunoRelayID        = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	sunoRelayPostPaths = map[string]bool{
		"/suno/submit/music":            true,
		"/suno/uploads/audio":           true,
		"/suno/submit/lyrics":           true,
		"/suno/submit/persona":          true,
		"/suno/fetch":                   true,
		"/suno/submit/adjust-speed":     true,
		"/suno/submit/concat":           true,
		"/suno/submit/fade":             true,
		"/suno/submit/mp4":              true,
		"/suno/submit/regen-img":        true,
		"/suno/submit/set-metadata":     true,
		"/suno/submit/stems":            true,
		"/suno/submit/stems-all":        true,
		"/suno/submit/stems-all-by-url": true,
		"/suno/submit/stems-by-url":     true,
		"/suno/submit/upsample-tags":    true,
		"/suno/submit/url-transfer":     true,
	}
	sunoRelayGetQueries = map[string][]string{
		"/suno/account/integral": nil,
		"/suno/act/music-style":  nil,
		"/suno/act/midi":         {"clipId", "stemClipId"},
		"/suno/act/mp4-state":    {"taskBatchId"},
		"/suno/act/waveform":     {"clipId"},
		"/suno/act/my-musics":    {"pageNum", "pageSize"},
	}
)

func authorizeSunoRelay(method string, requestPath string, apiFormat string, contentType string, query url.Values) error {
	if apiFormat != "openai" {
		return errors.New("Suno 自定义渠道只允许 OpenAI 调用格式")
	}
	if method == http.MethodPost {
		if !sunoRelayPostPaths[requestPath] || len(query) != 0 {
			return errors.New("Suno 自定义渠道不允许访问该上游接口")
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType != "application/json" {
			return errors.New("Suno 自定义渠道请求必须使用 application/json")
		}
		return nil
	}
	if method != http.MethodGet {
		return errors.New("Suno 自定义渠道不允许使用该请求方法")
	}
	allowedKeys, allowed := sunoRelayGetQueries[requestPath]
	if !allowed {
		for _, prefix := range []string{"/suno/fetch/", "/suno/act/wav/", "/suno/act/timing/"} {
			if strings.HasPrefix(requestPath, prefix) && sunoRelayID.MatchString(strings.TrimPrefix(requestPath, prefix)) {
				allowed = true
				break
			}
		}
	}
	if !allowed {
		return errors.New("Suno 自定义渠道不允许访问该上游接口")
	}
	pagination := requestPath == "/suno/act/my-musics"
	if !pagination && len(query) != len(allowedKeys) {
		return errors.New("Suno 自定义渠道查询参数无效")
	}
	for key, values := range query {
		allowedKey := false
		for _, candidate := range allowedKeys {
			if key == candidate {
				allowedKey = true
				break
			}
		}
		if !allowedKey || len(values) != 1 {
			return errors.New("Suno 自定义渠道查询参数无效")
		}
		value := values[0]
		if pagination {
			number, err := strconv.ParseUint(value, 10, 64)
			if err != nil || number == 0 || strings.Trim(value, "0123456789") != "" {
				return errors.New("Suno 自定义渠道分页参数必须是正整数")
			}
		} else if !sunoRelayID.MatchString(value) {
			return errors.New("Suno 自定义渠道查询 ID 无效")
		}
	}
	return nil
}

func sunoRelayAllowsBinaryResponse(requestPath string, contentType string) bool {
	const prefix = "/suno/act/wav/"
	if !strings.HasPrefix(requestPath, prefix) || !sunoRelayID.MatchString(strings.TrimPrefix(requestPath, prefix)) {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	return err == nil && (strings.HasPrefix(mediaType, "audio/") || mediaType == "application/octet-stream")
}
