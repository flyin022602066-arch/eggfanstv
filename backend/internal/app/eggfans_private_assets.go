package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"

	"gorm.io/gorm"
)

const eggfansAvatarRoutingModel = "doubao-seedance-2-0-260128"
const eggfansAvatarRequestKindPrefix = "eggfans-avatar-"

var opaqueVideoAssetPattern = regexp.MustCompile(`^asset://[A-Za-z0-9_-]+$`)

type eggfansAvatarRequestError struct {
	Operation    string
	Method       string
	Path         string
	RoutingModel string
	Err          error
}

func (err eggfansAvatarRequestError) Error() string {
	return err.withFailure(classifyTaskFailure(err.Err)).UserMessage()
}

func (err eggfansAvatarRequestError) Unwrap() error {
	return err.Err
}

func (err eggfansAvatarRequestError) withFailure(failure generation.Failure) generation.Failure {
	operationNames := map[string]string{
		"create-group": "创建私域素材组", "list-groups": "查询私域素材组", "get-group": "读取私域素材组", "update-group": "更新私域素材组", "delete-group": "删除私域素材组",
		"create-asset": "上传私域素材", "list-assets": "查询私域素材", "get-asset": "读取私域素材", "update-asset": "更新私域素材", "delete-asset": "删除私域素材",
		"auth-session": "创建真人认证会话", "group-from-token": "获取真人素材组",
	}
	stage := firstNonEmpty(operationNames[err.Operation], "私域素材同步")
	if failure.Reason == "当前渠道不支持请求的接口" {
		failure.Action = "请联系 Eggfans 网关维护者确认并开通私域素材接口后重试"
	}
	if failure.HTTPStatus != 0 {
		failure.Reason = fmt.Sprintf("%s失败（HTTP %d，%s %s）：%s", stage, failure.HTTPStatus, err.Method, err.Path, failure.Reason)
	} else {
		failure.Reason = stage + "失败：" + failure.Reason
	}
	return failure
}

type temporaryMediaUploader interface {
	temporaryURLValidator
	UploadMedia(context.Context, string, []byte, string) (outbound.TemporaryImageURL, error)
}

type EggfansAvatarRequest struct {
	Config    providerConfig `json:"config"`
	Operation string         `json:"operation"`
	ID        string         `json:"id,omitempty"`
	Body      map[string]any `json:"body,omitempty"`
}

func isEggfansSeedanceProtocol(value string) bool {
	return value == string(model.ChannelInterfaceEggfansSeedanceVideo) || value == string(model.ChannelInterfaceEggfansVolcVideo)
}

func eggfansAccountScope(userID string, config providerConfig) string {
	headers, _ := json.Marshal(config.Headers)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(userID+"\x00"+strings.TrimRight(config.BaseURL, "/")+"\x00"+config.APIKey+"\x00"+string(headers))))
}

func (s *Service) lockEggfansAsset(ctx context.Context, key string) (func(), error) {
	stored, _ := s.eggfansAssetLocks.LoadOrStore(key, make(chan struct{}, 1))
	lock := stored.(chan struct{})
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Service) mediaHost() temporaryMediaUploader {
	s.temporaryMediaOnce.Do(func() {
		if s.temporaryMedia == nil {
			s.temporaryMedia = outbound.NewUguuImageHost(nil)
		}
	})
	return s.temporaryMedia
}

func callEggfansAvatar(ctx context.Context, config providerConfig, operation, id string, body map[string]any) (result map[string]any, err error) {
	if strings.TrimSpace(config.BaseURL) == "" || strings.TrimSpace(config.APIKey) == "" {
		return nil, BadAuthRequest("请先配置 Eggfans 的 Base URL 和 API Key")
	}
	if body == nil {
		body = map[string]any{}
	}
	routingModel := stringField(body, "model")
	if routingModel == "" {
		routingModel = eggfansAvatarRoutingModel
	}
	if routingModel != eggfansAvatarRoutingModel && routingModel != "doubao-seedance-2-0-fast-260128" {
		return nil, BadAuthRequest("私域素材库路由模型必须使用文档支持的 Seedance 2.0 或 2.0-fast")
	}
	body["model"] = routingModel
	method, path := "", ""
	switch operation {
	case "create-group":
		method, path = http.MethodPost, "/v1/private-avatar/groups"
		if stringField(body, "Name") == "" {
			return nil, BadAuthRequest("请输入素材组名称")
		}
		if groupType := stringField(body, "GroupType"); groupType != "" && groupType != "AIGC" {
			return nil, BadAuthRequest("虚拟人像素材组类型必须为 AIGC；真人组请完成真人认证")
		}
	case "list-groups":
		method, path = http.MethodPost, "/v1/private-avatar/groups/list"
	case "get-group", "update-group", "delete-group":
		path = "/v1/private-avatar/groups/" + url.PathEscape(id)
	case "create-asset":
		method, path = http.MethodPost, "/v1/private-avatar/assets"
		if stringField(body, "GroupId") == "" {
			return nil, BadAuthRequest("请选择私域素材组")
		}
		assetType := stringField(body, "AssetType")
		if assetType != "Image" && assetType != "Video" && assetType != "Audio" {
			return nil, BadAuthRequest("素材类型必须为 Image、Video 或 Audio")
		}
		parsed, err := url.Parse(stringField(body, "URL"))
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
			return nil, BadAuthRequest("私域素材上传需要公开 HTTPS URL")
		}
	case "list-assets":
		method, path = http.MethodPost, "/v1/private-avatar/assets/list"
	case "get-asset", "update-asset", "delete-asset":
		path = "/v1/private-avatar/assets/" + url.PathEscape(id)
	case "auth-session":
		method, path = http.MethodPost, "/v1/real-avatar/auth/session"
		callback, err := url.Parse(stringField(body, "CallbackURL"))
		if err != nil || callback.Hostname() == "" || (callback.Scheme != "https" && callback.Scheme != "http") || callback.User != nil {
			return nil, BadAuthRequest("真人认证需要完整的认证完成跳转地址")
		}
	case "group-from-token":
		method, path = http.MethodPost, "/v1/real-avatar/groups/from-token"
		if stringField(body, "BytedToken") == "" {
			return nil, BadAuthRequest("请输入真人认证返回的 BytedToken")
		}
	default:
		return nil, BadAuthRequest("不支持的私域素材库操作")
	}
	if method == "" {
		if id == "" || strings.ContainsAny(id, "/?#\\") || id == "." || id == ".." {
			return nil, BadAuthRequest("私域素材或分组 ID 无效")
		}
		switch {
		case strings.HasPrefix(operation, "get-"):
			method = http.MethodGet
		case strings.HasPrefix(operation, "delete-"):
			method = http.MethodDelete
		default:
			method = http.MethodPatch
			if existing := stringField(body, "Id"); existing != "" && existing != id {
				return nil, BadAuthRequest("请求中的 Id 必须与路径一致")
			}
			body["Id"] = id
		}
	}
	spec := protocol.RequestSpec{Method: method, Path: path, OriginPath: true, ContentType: "application/json", Body: body, Auth: protocol.ManifestAuth{Type: "bearer", Field: "apiKey"}}
	if method == http.MethodGet || method == http.MethodDelete {
		spec.Body = nil
		spec.Query = map[string][]string{"model": {routingModel}}
	}
	defer func() {
		if err != nil {
			err = eggfansAvatarRequestError{Operation: operation, Method: method, Path: path, RoutingModel: routingModel, Err: err}
		}
	}()
	encoded, err := executeProtocolRequest(withoutProviderAnalytics(ctx), config, spec)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return nil, errors.New("Eggfans 私域素材库返回了无法解析的数据")
	}
	if metadata, ok := payload["ResponseMetadata"].(map[string]any); ok {
		if detail, ok := metadata["Error"].(map[string]any); ok && (stringField(detail, "Code") != "" || stringField(detail, "Message") != "") {
			return nil, fmt.Errorf("私域素材库请求失败：%s", classifyProviderHTTP(providerHTTPError{StatusCode: http.StatusBadRequest, Body: string(encoded)}).UserMessage())
		}
	}
	if _, _, failed := providerResponseBusinessFailure(encoded); failed {
		return nil, errors.New(classifyProviderHTTP(providerHTTPError{StatusCode: http.StatusBadRequest, Body: string(encoded)}).UserMessage())
	}
	result, ok := payload["Result"].(map[string]any)
	if !ok {
		return nil, errors.New("Eggfans 私域素材库未返回 Result 对象")
	}
	return result, nil
}

func (s *Service) EggfansPrivateAvatar(ctx context.Context, userID string, request EggfansAvatarRequest) (map[string]any, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, BadAuthRequest("私域素材库操作缺少工作区用户")
	}
	config, err := s.resolveProviderConfig(request.Config)
	if err != nil {
		return nil, err
	}
	result, err := callEggfansAvatar(ctx, config, request.Operation, strings.TrimSpace(request.ID), request.Body)
	if err != nil {
		return nil, err
	}
	if request.Operation == "delete-asset" || request.Operation == "delete-group" {
		assetID, groupID := "", ""
		if request.Operation == "delete-asset" {
			assetID = request.ID
		} else {
			groupID = request.ID
		}
		if err := s.repo.InvalidateEggfansAsset(userID, eggfansAccountScope(userID, config), assetID, groupID); err != nil {
			return nil, fmt.Errorf("上游已删除，但本地资产状态更新失败：%w", err)
		}
		if groupID != "" {
			if err := s.repo.DeleteSystemSetting(eggfansGroupSettingKey(userID, config)); err != nil {
				return nil, err
			}
		}
	}
	return result, nil
}

func eggfansGroupSettingKey(userID string, config providerConfig) string {
	return "egg-avatar:" + eggfansAccountScope(userID, config)
}

func (s *Service) ensureEggfansAssetGroup(ctx context.Context, userID string, config providerConfig) (string, error) {
	key := eggfansGroupSettingKey(userID, config)
	unlock, err := s.lockEggfansAsset(ctx, key)
	if err != nil {
		return "", err
	}
	defer unlock()
	setting, err := s.repo.SystemSetting(key)
	if err == nil {
		var groupID string
		if json.Unmarshal([]byte(setting.ValueJSON), &groupID) == nil && groupID != "" {
			return groupID, nil
		}
		return "", errors.New("已保存的 Eggfans 私域素材组配置无效")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	name := "Eggfans TV 自动参考素材"
	listed, err := callEggfansAvatar(ctx, config, "list-groups", "", map[string]any{"Filter": map[string]any{"Name": name, "GroupType": "AIGC"}, "PageNumber": 1, "PageSize": 100})
	if err != nil {
		return "", err
	}
	groupID := ""
	items, _ := listed["Items"].([]any)
	for _, value := range items {
		if group, ok := value.(map[string]any); ok && stringField(group, "Name") == name && stringField(group, "GroupType") == "AIGC" {
			groupID = stringField(group, "Id")
			if groupID != "" {
				break
			}
		}
	}
	if groupID == "" {
		created, err := callEggfansAvatar(ctx, config, "create-group", "", map[string]any{"Name": name, "GroupType": "AIGC"})
		if err != nil {
			return "", err
		}
		groupID = stringField(created, "Id")
	}
	if groupID == "" {
		return "", errors.New("Eggfans 私域素材库未返回 GroupId")
	}
	encoded, _ := json.Marshal(groupID)
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: key, ValueJSON: string(encoded), UpdatedBy: userID}); err != nil {
		return "", fmt.Errorf("保存已创建的 Eggfans 素材组失败，请核对上游素材组：%w", err)
	}
	return groupID, nil
}

func (s *Service) prepareEggfansPrivateAssetReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	if input == nil || input.Mode != "video" || !isEggfansSeedanceProtocol(input.Config.InterfaceType) {
		return nil
	}
	switch strings.ToLower(strings.TrimSpace(input.Config.EggfansReferenceMode)) {
	case "url":
		return s.prepareEggfansPublicReferences(ctx, userID, input)
	case "", "uri":
	default:
		return BadAuthRequest("Eggfans Seedance 参考资产提交方式无效，请选择 URI 或 URL")
	}
	if s.IsLocalMode() {
		library, err := s.readVolcAssetLibraryConfig()
		if err != nil {
			return err
		}
		if library.Enabled {
			return s.prepareVolcLibraryReferences(ctx, userID, input, library)
		}
	}
	for _, group := range []struct {
		kind  string
		media []providerMedia
	}{{"Image", input.ReferenceImages}, {"Video", input.ReferenceVideos}, {"Audio", input.ReferenceAudios}} {
		for index := range group.media {
			if taskID := taskExecutionID(ctx); taskID != "" {
				_ = s.repo.UpdateTaskProgress(taskID, fmt.Sprintf("同步私域参考素材：%s %d/%d", group.kind, index+1, len(group.media)), 36)
			}
			binding, err := s.ensureEggfansPrivateAsset(ctx, userID, input.Config, &group.media[index], group.kind, "")
			if err != nil {
				return fmt.Errorf("第 %d 个%s参考素材同步失败：%w", index+1, group.kind, err)
			}
			group.media[index].URL = binding.URI
			group.media[index].DataURL = ""
		}
	}
	return nil
}

func (s *Service) prepareEggfansPublicReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	for _, group := range []struct {
		kind  string
		media []providerMedia
	}{{"Image", input.ReferenceImages}, {"Video", input.ReferenceVideos}, {"Audio", input.ReferenceAudios}} {
		for index := range group.media {
			media := &group.media[index]
			inlineURL := strings.TrimSpace(firstNonEmpty(media.DataURL, media.URL))
			if strings.HasPrefix(inlineURL, "asset://") {
				return BadAuthRequest("Eggfans Seedance URL 模式不接受私域资产 URI，请使用原始素材或已保存资源")
			}
			if strings.HasPrefix(inlineURL, "data:") && !strings.HasPrefix(media.StorageKey, "resource:") {
				var err error
				if group.kind == "Image" {
					err = s.uploadTemporaryInlineImage(ctx, userID, media)
				} else {
					err = s.uploadTemporaryInlineMedia(ctx, userID, media)
				}
				if err != nil {
					return fmt.Errorf("第 %d 个%s参考素材上传到 Uguu 失败：%w", index+1, group.kind, err)
				}
			} else if err := s.hydrateProviderMedia(userID, media, providerMediaHydrationPolicy{RequireURL: true, PreferURL: true, PublicOnly: true}); err != nil {
				return fmt.Errorf("第 %d 个%s参考素材准备公网 URL 失败：%w", index+1, group.kind, err)
			}
			if !isPublicMediaURL(strings.TrimSpace(media.URL)) {
				return BadAuthRequest(fmt.Sprintf("第 %d 个%s参考素材没有可用的公网 URL", index+1, group.kind))
			}
			media.DataURL = ""
		}
	}
	return nil
}

func (s *Service) ensureEggfansPrivateAsset(ctx context.Context, userID string, config providerConfig, media *providerMedia, assetType, groupID string) (*model.EggfansAssetBinding, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resourceID := arkPrivateAssetResourceID(*media)
	source := resourceID
	if source == "" {
		source = firstNonEmpty(media.DataURL, media.URL)
	}
	if source == "" {
		return nil, BadAuthRequest("参考素材尚未保存，请重新导入")
	}
	accountScope := eggfansAccountScope(userID, config)
	sourceKey := fmt.Sprintf("%x", sha256.Sum256([]byte(assetType+"\x00"+source+"\x00"+groupID)))
	unlock, err := s.lockEggfansAsset(ctx, accountScope+":"+sourceKey)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if resourceID != "" {
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return nil, err
		}
		if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), strings.ToLower(assetType)+"/") {
			return nil, BadAuthRequest("参考资源未就绪或媒体类型不匹配")
		}
	}
	if opaqueVideoAssetPattern.MatchString(strings.TrimSpace(media.URL)) {
		assetID := strings.TrimPrefix(strings.TrimSpace(media.URL), "asset://")
		known, lookupErr := s.repo.EggfansAssetBindingByAssetID(userID, accountScope, assetID)
		if lookupErr == nil && known.Status == "active" {
			return known, nil
		}
		if lookupErr == nil && known.Status == "deleted" {
			return nil, BadAuthRequest("私域参考资产已删除，请重新同步素材")
		}
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return nil, lookupErr
		}
		result, err := callEggfansAvatar(ctx, config, "get-asset", assetID, nil)
		if err != nil {
			return nil, err
		}
		if stringField(result, "Status") != "Active" {
			return nil, BadAuthRequest("私域参考资产尚未审核通过，请在素材库查询状态")
		}
		if kind := stringField(result, "AssetType"); kind != "" && kind != assetType {
			return nil, BadAuthRequest("私域参考资产类型不匹配")
		}
		return &model.EggfansAssetBinding{URI: "asset://" + assetID, AssetID: assetID, Status: "active", AssetType: assetType}, nil
	}
	binding, err := s.repo.EggfansAssetBinding(userID, accountScope, sourceKey)
	if err == nil && binding.Status == "active" && binding.URI != "" {
		return binding, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err == nil && binding.Status != "deleted" {
		if binding.AssetID != "" && binding.Status != "failed" {
			return s.pollEggfansPrivateAsset(ctx, config, binding)
		}
		return nil, fmt.Errorf("私域素材状态为 %s，请在私域素材库核对后重新同步：%s", binding.Status, binding.Error)
	}
	if groupID == "" {
		groupID, err = s.ensureEggfansAssetGroup(ctx, userID, config)
		if err != nil {
			return nil, err
		}
	}
	publicURL, err := s.eggfansReferencePublicURL(ctx, userID, media, assetType)
	if err != nil {
		return nil, err
	}
	if binding.ID == "" {
		binding = &model.EggfansAssetBinding{ID: newID(), UserID: userID, AccountScope: accountScope, SourceKey: sourceKey, CreatedAt: time.Now().UTC()}
	}
	binding.ResourceID, binding.BaseURL, binding.AssetType, binding.AssetGroupID = resourceID, config.BaseURL, assetType, groupID
	binding.Status, binding.Error, binding.AssetID, binding.URI = "creating", "", "", ""
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, err
	}
	created, err := callEggfansAvatar(ctx, config, "create-asset", "", map[string]any{"GroupId": groupID, "URL": publicURL, "AssetType": assetType, "Name": firstNonEmpty(media.Name, media.ID, assetType)})
	if err != nil {
		binding.Status, binding.Error = "unknown", "创建结果未确认，请先查询私域素材库，避免重复上传"
		if saveErr := s.repo.SaveEggfansAssetBinding(binding); saveErr != nil {
			return nil, fmt.Errorf("素材创建失败且状态保存失败：%w", saveErr)
		}
		return nil, err
	}
	binding.AssetID = stringField(created, "Id")
	if binding.AssetID == "" {
		return nil, errors.New("私域素材上传未返回 AssetId，请先查询素材列表")
	}
	binding.Status = "processing"
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, fmt.Errorf("资产已创建但保存 AssetId 失败，请在私域素材库核对，避免重复上传：%w", err)
	}
	return s.pollEggfansPrivateAsset(ctx, config, binding)
}

func (s *Service) pollEggfansPrivateAsset(ctx context.Context, config providerConfig, binding *model.EggfansAssetBinding) (*model.EggfansAssetBinding, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	for {
		result, err := callEggfansAvatar(ctx, config, "get-asset", binding.AssetID, nil)
		if err != nil {
			return nil, err
		}
		switch strings.ToLower(stringField(result, "Status")) {
		case "active":
			binding.Status, binding.URI, binding.Error = "active", "asset://"+binding.AssetID, ""
			if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
				return nil, err
			}
			return binding, nil
		case "failed":
			binding.Status, binding.Error = "failed", "私域素材审核失败，请检查素材或完成真人认证"
			if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
				return nil, err
			}
			return nil, errors.New(binding.Error)
		case "processing":
		default:
			return nil, errors.New("私域素材库返回了未知素材状态")
		}
		if err := sleepContext(ctx, 2*time.Second); err != nil {
			return nil, fmt.Errorf("私域素材尚未就绪，已保存 AssetId，下次将继续查询：%w", err)
		}
	}
}

func (s *Service) eggfansReferencePublicURL(ctx context.Context, userID string, media *providerMedia, assetType string) (string, error) {
	if resourceID := arkPrivateAssetResourceID(*media); resourceID != "" {
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return "", err
		}
		if assetType == "Image" {
			return s.uploadTemporaryResourceImage(ctx, userID, resource)
		}
		return s.uploadTemporaryResourceMedia(ctx, userID, resource)
	}
	if strings.HasPrefix(strings.TrimSpace(media.URL), "https://") && media.DataURL == "" {
		return strings.TrimSpace(media.URL), nil
	}
	data, mimeType, err := mediaBytes(*media)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(strings.ToLower(mimeType), strings.ToLower(assetType)+"/") {
		return "", BadAuthRequest("参考素材类型不匹配")
	}
	upload, err := s.mediaHost().UploadMedia(ctx, userID, data, mimeType)
	if err != nil {
		return "", err
	}
	return upload.URL, nil
}

func (s *Service) SyncResourceToEggfansPrivateAsset(ctx context.Context, userID, resourceID string, request EggfansAvatarRequest) (*model.EggfansAssetBinding, error) {
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return nil, err
	}
	assetType := map[string]string{"image": "Image", "video": "Video", "audio": "Audio"}[strings.Split(resource.MimeType, "/")[0]]
	if assetType == "" {
		return nil, BadAuthRequest("私域素材库仅支持图片、视频和音频")
	}
	config, err := s.resolveProviderConfig(request.Config)
	if err != nil {
		return nil, err
	}
	media := providerMedia{ID: resource.ID, Name: stringField(request.Body, "Name"), StorageKey: "resource:" + resource.ID}
	return s.ensureEggfansPrivateAsset(ctx, userID, config, &media, assetType, stringField(request.Body, "GroupId"))
}

func (s *Service) ResourceEggfansPrivateAssets(userID, resourceID string) ([]model.EggfansAssetBinding, error) {
	if _, err := s.repo.ResourceForUser(userID, resourceID); err != nil {
		return nil, err
	}
	return s.repo.ResourceEggfansAssets(userID, resourceID)
}
