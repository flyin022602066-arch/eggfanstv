package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
)

type ChannelModelsRequest struct {
	BaseURL       string           `json:"baseUrl"`
	CatalogURL    string           `json:"catalogUrl"`
	APIKey        string           `json:"apiKey"`
	APIFormat     string           `json:"apiFormat"`
	Headers       []OutboundHeader `json:"headers"`
	ChannelID     string           `json:"channelId"`
	CredentialRef string           `json:"credentialRef"`
}

func (s *Service) FetchChannelModels(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]string, error) {
	items, err := s.FetchChannelModelCatalog(ctx, actor, input)
	if err != nil {
		return nil, err
	}
	return modelcatalog.CatalogModelIDs(items), nil
}

func (s *Service) FetchChannelModelCatalog(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]ChannelModelCatalogItem, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if err := s.resolveChannelModelsRequest(&input); err != nil {
		return nil, err
	}
	headers, err := NormalizeOutboundHeaders(input.Headers)
	if err != nil {
		return nil, err
	}
	catalog, err := modelcatalog.LoadChannelModelCatalog(ctx, func(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader) ([]byte, error) {
		return s.fetchChannelModelCatalogBytesFromURL(ctx, baseURL, apiFormat, apiKey, headers, input.CatalogURL)
	}, input.BaseURL, input.APIFormat, input.APIKey, headers, s.catalogExtraSource())
	if err != nil {
		return nil, mapChannelModelCatalogError(err)
	}
	return catalog, nil
}

func (s *Service) fetchChannelModelCatalogBytes(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader) ([]byte, error) {
	return s.fetchChannelModelCatalogBytesFromURL(ctx, baseURL, apiFormat, apiKey, headers, "")
}

func (s *Service) fetchChannelModelCatalogBytesFromURL(ctx context.Context, baseURL, apiFormat, apiKey string, headers []modelcatalog.ChannelHeader, catalogURL string) ([]byte, error) {
	target := strings.TrimSpace(catalogURL)
	if target == "" {
		target = apiURL(baseURL, "/models")
	} else if strings.HasPrefix(target, "/") {
		target = apiURL(baseURL, target)
	}
	if normalized, ok := normalizeJiasuCatalogURL(target); ok && normalized != target {
		target = normalized
	} else if normalized, ok := normalizeEggfansCatalogURL(target); ok {
		target = normalized
	}
	if apiFormat == "gemini" && strings.TrimSpace(catalogURL) == "" {
		if !strings.HasSuffix(strings.ToLower(baseURL), "/v1beta") {
			baseURL += "/v1beta"
		}
		target = baseURL + "/models"
	}
	if _, err := ValidateOutboundURL(target); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, BadAuthRequest("模型服务地址无效")
	}
	if apiFormat == "gemini" {
		request.Header.Set("x-goog-api-key", apiKey)
	} else {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	ApplyOutboundHeaders(request, headers)
	data, _, err := doBinary(request)
	if err != nil {
		var httpErr providerHTTPError
		if errors.As(err, &httpErr) {
			return nil, modelcatalog.CatalogFetchError{StatusCode: httpErr.StatusCode, Cause: err}
		}
		return nil, modelcatalog.CatalogFetchError{Cause: err}
	}
	return data, nil
}

func normalizeEggfansCatalogURL(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return raw, false
	}
	if strings.EqualFold(parsed.Hostname(), "api.eggfans.com") && strings.EqualFold(strings.TrimRight(parsed.Path, "/"), "/pricing") {
		parsed.Path = "/api/pricing_new"
		parsed.RawPath = ""
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String(), true
	}
	return raw, true
}

func normalizeJiasuCatalogURL(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return raw, false
	}
	if (strings.EqualFold(parsed.Hostname(), "ai.jiasuapi.com") || strings.EqualFold(parsed.Hostname(), "www.gway.dev")) && strings.EqualFold(strings.TrimRight(parsed.Path, "/"), "/pricing") {
		parsed.Scheme = "https"
		parsed.Host = "www.gway.dev"
		parsed.Path = "/api/pricing"
		parsed.RawPath = ""
		parsed.RawQuery = "surface=plaza"
		parsed.Fragment = ""
		return parsed.String(), true
	}
	return raw, true
}

func (s *Service) catalogExtraSource() modelcatalog.CatalogExtraSource {
	if s == nil || !s.isPluginEnabled() {
		return nil
	}
	return extraChannelModelCatalogItems
}

func mapChannelModelCatalogError(err error) error {
	if err == nil {
		return nil
	}
	var fetchErr modelcatalog.CatalogFetchError
	if errors.As(err, &fetchErr) {
		return channelModelsUpstreamError(fetchErr.Cause)
	}
	var jsonErr modelcatalog.CatalogJSONError
	if errors.As(err, &jsonErr) {
		return WrapAppError(http.StatusBadGateway, jsonErr.Error(), jsonErr.Cause)
	}
	var rejected modelcatalog.CatalogUpstreamRejectedError
	if errors.As(err, &rejected) {
		return NewAppError(http.StatusBadGateway, rejected.Error())
	}
	return err
}

func channelModelsUpstreamError(err error) error {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr
	}
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return WrapAppError(http.StatusBadGateway, "连接模型服务失败，请检查渠道地址和网络", err)
	}
	switch httpErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return NewAppError(http.StatusBadGateway, "模型服务鉴权失败，请检查 API Key")
	case http.StatusNotFound:
		return NewAppError(http.StatusBadGateway, "模型服务未提供 /models 接口")
	case http.StatusTooManyRequests:
		return NewAppError(http.StatusBadGateway, "模型服务请求过于频繁或额度不足")
	default:
		return WrapAppError(http.StatusBadGateway, httpErr.Error(), err)
	}
}
