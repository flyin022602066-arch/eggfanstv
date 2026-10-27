package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"

	"gorm.io/gorm"
)

func mintsAccountScope(userID string, config providerConfig) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte("mints-seedance-video\x00"+eggfansAccountScope(userID, config))))
}

func (s *Service) prepareMintsAssetReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	if input == nil || input.Mode != "video" || input.Config.InterfaceType != "mints-seedance-video" {
		return nil
	}
	groupID := ""
	if options, ok := input.Metadata["providerOptions"].(map[string]any); ok {
		if scoped, ok := options["mints-seedance-video"].(map[string]any); ok {
			groupID = strings.TrimSpace(stringField(scoped, "asset_group_id"))
		}
	}
	for _, group := range []struct {
		kind  string
		media []providerMedia
	}{{"Image", input.ReferenceImages}, {"Video", input.ReferenceVideos}, {"Audio", input.ReferenceAudios}} {
		for index := range group.media {
			media := &group.media[index]
			binding, err := s.ensureMintsAsset(ctx, userID, input.Config, media, group.kind, groupID)
			if err != nil {
				return fmt.Errorf("Mints 第 %d 个%s参考资产绑定失败：%w", index+1, group.kind, err)
			}
			media.URL, media.DataURL = binding.URI, ""
		}
	}
	return nil
}

func callMintsAsset(ctx context.Context, config providerConfig, method, id string, body map[string]any) (map[string]any, error) {
	if strings.TrimSpace(config.APIKey) == "" || strings.TrimSpace(config.BaseURL) == "" {
		return nil, BadAuthRequest("请先配置 Mints Seedance 渠道的 Base URL 和 API Key")
	}
	path := "/api/seedance/assets"
	if method == http.MethodGet {
		if id == "" || strings.ContainsAny(id, "/?#\\") || id == "." || id == ".." {
			return nil, BadAuthRequest("Mints 资产 ID 无效")
		}
		path += "/" + url.PathEscape(id)
	}
	spec := protocol.RequestSpec{Method: method, Path: path, OriginPath: true, ContentType: "application/json", Auth: protocol.ManifestAuth{Type: "bearer", Field: "apiKey"}}
	if method == http.MethodPost {
		spec.Body = body
	}
	encoded, err := executeProtocolRequest(withoutProviderAnalytics(ctx), config, spec)
	if err != nil {
		return nil, fmt.Errorf("Mints 素材接口 %s %s：%w", method, path, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return nil, errors.New("Mints 素材接口返回了无法解析的数据")
	}
	if _, _, failed := providerResponseBusinessFailure(encoded); failed {
		return nil, errors.New(classifyProviderHTTP(providerHTTPError{StatusCode: http.StatusBadRequest, Body: string(encoded)}).UserMessage())
	}
	result, ok := payload["Result"].(map[string]any)
	if !ok {
		return nil, errors.New("Mints 素材接口未返回 Result；请检查渠道地址、权限和真人认证状态")
	}
	return result, nil
}

func (s *Service) ensureMintsAsset(ctx context.Context, userID string, config providerConfig, media *providerMedia, kind, groupID string) (*model.EggfansAssetBinding, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	scope := mintsAccountScope(userID, config)
	resourceID := arkPrivateAssetResourceID(*media)
	source := firstNonEmpty(resourceID, media.DataURL, media.URL)
	if source == "" {
		return nil, BadAuthRequest("请先导入参考素材")
	}
	sourceKey := fmt.Sprintf("%x", sha256.Sum256([]byte(kind+"\x00"+source+"\x00"+groupID)))
	unlock, err := s.lockEggfansAsset(ctx, scope+":"+sourceKey)
	if err != nil {
		return nil, err
	}
	defer unlock()
	var resource *model.Resource
	if resourceID != "" {
		resource, err = s.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return nil, err
		}
		if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), strings.ToLower(kind)+"/") {
			return nil, BadAuthRequest("参考资源未就绪或媒体类型不匹配")
		}
	}
	if resourceID == "" && strings.HasPrefix(source, "asset://") {
		binding, err := s.repo.EggfansAssetBindingByAssetID(userID, scope, strings.TrimPrefix(source, "asset://"))
		if err != nil || binding.AssetType != kind || binding.AssetGroupID != groupID {
			return nil, BadAuthRequest("此 URI 不属于当前 Mints 渠道、Key 或素材组，请连接原始本地素材重新绑定")
		}
		return s.pollMintsAsset(ctx, config, binding)
	}
	binding, err := s.repo.EggfansAssetBinding(userID, scope, sourceKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err == nil && binding.AssetID != "" && binding.Status != "deleted" {
		ready, pollErr := s.pollMintsAsset(ctx, config, binding)
		var upstream providerHTTPError
		if !errors.As(pollErr, &upstream) || upstream.StatusCode != http.StatusNotFound {
			return ready, pollErr
		}
	}
	var publicURL string
	if resource != nil {
		if kind == "Image" {
			publicURL, err = s.uploadTemporaryResourceImage(ctx, userID, resource)
		} else {
			publicURL, err = s.uploadTemporaryResourceMedia(ctx, userID, resource)
		}
	} else {
		copyMedia := *media
		if !strings.HasPrefix(source, "data:") {
			data, mimeType, downloadErr := getExternalBinary(ctx, source)
			if downloadErr != nil {
				return nil, fmt.Errorf("参考链接无法读取，请重新导入本地原始素材：%w", downloadErr)
			}
			if !strings.HasPrefix(strings.ToLower(mimeType), strings.ToLower(kind)+"/") {
				return nil, BadAuthRequest("参考链接返回的媒体类型不匹配")
			}
			copyMedia.DataURL = dataURL(mimeType, data)
		}
		if kind == "Image" {
			err = s.uploadTemporaryInlineImage(ctx, userID, &copyMedia)
		} else {
			err = s.uploadTemporaryInlineMedia(ctx, userID, &copyMedia)
		}
		publicURL = copyMedia.URL
	}
	if err != nil {
		return nil, fmt.Errorf("自动上传 Uguu 失败：%w", err)
	}
	parsed, err := url.Parse(publicURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, BadAuthRequest("Mints 资产上传需要有效的公网 HTTPS 素材链接")
	}
	if binding == nil || binding.ID == "" {
		binding = &model.EggfansAssetBinding{ID: newID(), UserID: userID, AccountScope: scope, SourceKey: sourceKey, CreatedAt: time.Now().UTC()}
	}
	binding.ResourceID, binding.BaseURL, binding.AssetType, binding.AssetGroupID = resourceID, config.BaseURL, kind, groupID
	binding.Status, binding.AssetID, binding.URI, binding.Error = "creating", "", "", ""
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, err
	}
	body := map[string]any{"URL": publicURL, "AssetType": kind, "Name": firstNonEmpty(media.Name, media.ID, kind)}
	if groupID != "" {
		body["GroupId"] = groupID
	}
	created, err := callMintsAsset(ctx, config, http.MethodPost, "", body)
	if err != nil {
		return nil, err
	}
	binding.AssetID = stringField(created, "Id")
	if binding.AssetID == "" {
		return nil, errors.New("Mints 未返回素材 Id，无法绑定参考 URI")
	}
	binding.Status = "processing"
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, fmt.Errorf("Mints 素材已创建但保存 ID 失败：%w", err)
	}
	return s.pollMintsAsset(ctx, config, binding)
}

func (s *Service) pollMintsAsset(ctx context.Context, config providerConfig, binding *model.EggfansAssetBinding) (*model.EggfansAssetBinding, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	for {
		result, err := callMintsAsset(ctx, config, http.MethodGet, binding.AssetID, nil)
		if err != nil {
			return nil, err
		}
		if id := stringField(result, "Id"); id != "" && id != binding.AssetID {
			return nil, errors.New("Mints 返回的素材 ID 与当前绑定不一致")
		}
		if kind := stringField(result, "AssetType"); kind != "" && kind != binding.AssetType {
			return nil, BadAuthRequest("Mints 资产类型不匹配")
		}
		binding.Status = strings.ToLower(stringField(result, "Status"))
		switch binding.Status {
		case "active":
			binding.URI, binding.Error = "asset://"+binding.AssetID, ""
		case "failed":
			binding.URI, binding.Error = "", "Mints 素材处理失败，请检查素材、使用权限及真人认证状态"
		case "processing":
			binding.URI, binding.Error = "", ""
		default:
			return nil, errors.New("Mints 返回了未知素材状态")
		}
		if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
			return nil, err
		}
		if binding.Status == "active" {
			return binding, nil
		}
		if binding.Status == "failed" {
			return nil, errors.New(binding.Error)
		}
		if err := sleepContext(ctx, 3*time.Second); err != nil {
			return nil, fmt.Errorf("Mints 素材仍在处理，已保存资产 ID，重试将继续查询：%w", err)
		}
	}
}
