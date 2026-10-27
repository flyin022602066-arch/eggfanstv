package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/workspace"
)

type volcAssetLibraryConfig struct {
	Enabled     bool   `json:"enabled"`
	BaseURL     string `json:"baseUrl"`
	APIKey      string `json:"apiKey"`
	GroupName   string `json:"groupName"`
	ProjectName string `json:"projectName"`
}

var errVolcGroupNameFilter = errors.New("素材组名称筛选暂不可用")

type VolcLibraryAsset struct {
	ID           string    `json:"id"`
	ResourceID   string    `json:"resourceId"`
	AccountScope string    `json:"accountScope"`
	Name         string    `json:"name"`
	URI          string    `json:"uri"`
	AssetID      string    `json:"assetId"`
	GroupID      string    `json:"groupId"`
	BaseURL      string    `json:"baseUrl"`
	ImageFile    string    `json:"imageFile"`
	PublicURL    string    `json:"publicUrl"`
	MimeType     string    `json:"mimeType"`
	Bytes        int64     `json:"bytes"`
	Width        int       `json:"width"`
	Height       int       `json:"height"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (s *Service) readVolcAssetLibraryConfig() (volcAssetLibraryConfig, error) {
	body, err := s.ReadLocalModelConfig()
	if err != nil {
		return volcAssetLibraryConfig{}, err
	}
	var snapshot struct {
		Library volcAssetLibraryConfig `json:"volcAssetLibrary"`
	}
	if err := json.Unmarshal(body, &snapshot); err != nil {
		return volcAssetLibraryConfig{}, err
	}
	config := snapshot.Library
	config.BaseURL = strings.TrimRight(strings.TrimSpace(defaultString(config.BaseURL, "https://20nbifxd.magine.work/v1")), "/")
	config.GroupName = defaultString(strings.TrimSpace(config.GroupName), "Eggfans TV 自动参考素材")
	config.ProjectName = defaultString(strings.TrimSpace(config.ProjectName), "default")
	config.APIKey = strings.TrimSpace(config.APIKey)
	return config, nil
}

func validateVolcAssetLibraryConfig(config volcAssetLibraryConfig) error {
	if !config.Enabled || config.APIKey == "" || config.APIKey == workspace.RedactedSecret {
		return BadAuthRequest("请在模型配置的火山 URI 资产库中填写独立的资产上传 Key")
	}
	_, err := ValidateOutboundURL(config.BaseURL)
	return err
}

func volcLibraryScope(userID string, config volcAssetLibraryConfig) string {
	return sha256Hex([]byte("volc-library\x00" + userID + "\x00" + config.BaseURL + "\x00" + config.APIKey + "\x00" + config.ProjectName))
}

func callVolcAssetLibrary(ctx context.Context, config volcAssetLibraryConfig, method, path string, query map[string][]string, body map[string]any) (any, error) {
	limit := 60 * time.Second
	if path == "/assets" {
		limit = 140 * time.Second
	}
	ctx, cancel := context.WithTimeout(withoutProviderAnalytics(ctx), limit)
	defer cancel()
	spec := protocol.RequestSpec{Method: method, Path: path, Query: query, Body: body, ContentType: "application/json", Headers: map[string]string{"Accept": "application/json"}, Auth: protocol.ManifestAuth{Type: "bearer", Field: "apiKey"}}
	encoded, err := executeProtocolRequest(ctx, providerConfig{BaseURL: config.BaseURL, APIKey: config.APIKey}, spec)
	if err != nil {
		var upstream providerHTTPError
		if method == http.MethodGet && path == "/assets/groups" && errors.As(err, &upstream) && strings.Contains(upstream.Body, "where express error:DESCRIPTION") {
			return nil, errVolcGroupNameFilter
		}
		return nil, fmt.Errorf("火山资产库 %s %s 失败：%w", method, path, err)
	}
	var response map[string]any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if decoder.Decode(&response) != nil {
		return nil, errors.New("火山资产库返回了无效 JSON")
	}
	if method == http.MethodGet && path == "/assets/groups" && strings.Contains(string(encoded), "where express error:DESCRIPTION") {
		return nil, errVolcGroupNameFilter
	}
	code := fmt.Sprint(response["code"])
	success := response["success"] == true || code == "1" || code == "200" || response["success"] == nil && response["code"] == nil && response["data"] != nil
	if !success || response["error"] != nil {
		return nil, errors.New("火山资产库请求失败：" + classifyProviderHTTP(providerHTTPError{StatusCode: http.StatusBadRequest, Body: string(encoded)}).UserMessage())
	}
	if detail := arkPrivateAssetUpstreamDetail(response); detail != "" {
		return nil, errors.New("火山资产库请求失败：" + strings.ReplaceAll(detail, config.APIKey, "[redacted]"))
	}
	if response["data"] == nil {
		return nil, errors.New("火山资产库未返回 data")
	}
	return response["data"], nil
}

func volcLibraryGroupRecordID(group map[string]any) string {
	for _, field := range []string{"id", "group_id"} {
		switch value := group[field].(type) {
		case string:
			if id := strings.TrimSpace(value); id != "" {
				return id
			}
		case json.Number:
			if id, err := strconv.ParseUint(value.String(), 10, 64); err == nil && id > 0 {
				return value.String()
			}
		}
	}
	return ""
}

func volcLibraryItems(data any) ([]any, error) {
	if items, ok := data.([]any); ok {
		return items, nil
	}
	if object, ok := data.(map[string]any); ok {
		for _, field := range []string{"items", "list", "records", "data"} {
			if items, ok := object[field].([]any); ok {
				return items, nil
			}
		}
	}
	return nil, errors.New("火山资产库列表格式无效")
}

func applyVolcLibraryAssetResult(binding *model.EggfansAssetBinding, asset map[string]any) error {
	binding.AssetID = firstNonEmpty(stringField(asset, "provider_asset_id"), stringField(asset, "providerAssetId"), binding.AssetID)
	uri := strings.TrimSpace(firstNonEmpty(stringField(asset, "asset_uri"), stringField(asset, "assetUri")))
	if len(uri) >= len("asset://") && strings.EqualFold(uri[:len("asset://")], "asset://") {
		uri = "asset://" + uri[len("asset://"):]
	}
	if !strings.EqualFold(stringField(asset, "status"), "Active") || !opaqueVideoAssetPattern.MatchString(uri) || binding.AssetID != "" && uri != "asset://"+binding.AssetID {
		return errors.New("火山资产尚未 Active 或未返回有效且一致的 URI，已保存创建记录")
	}
	if kind := stringField(asset, "asset_type"); kind != "" && !strings.EqualFold(kind, "Image") {
		return errors.New("火山资产类型不是图片")
	}
	binding.AssetID = strings.TrimPrefix(uri, "asset://")
	binding.URI, binding.Status, binding.Error = uri, "active", ""
	return nil
}

func (s *Service) recoverVolcLibraryAsset(ctx context.Context, config volcAssetLibraryConfig, binding *model.EggfansAssetBinding) error {
	for page := 1; page <= 100; page++ {
		data, err := callVolcAssetLibrary(ctx, config, http.MethodGet, "/assets", map[string][]string{"page": {fmt.Sprint(page)}, "page_size": {"100"}, "provider_asset_id": {binding.AssetID}}, nil)
		if err != nil {
			return err
		}
		items, err := volcLibraryItems(data)
		if err != nil {
			return err
		}
		for _, item := range items {
			asset, ok := item.(map[string]any)
			if !ok || firstNonEmpty(stringField(asset, "provider_asset_id"), stringField(asset, "providerAssetId")) != binding.AssetID {
				continue
			}
			if err := applyVolcLibraryAssetResult(binding, asset); err != nil {
				return err
			}
			return s.repo.SaveEggfansAssetBinding(binding)
		}
		if len(items) < 100 {
			break
		}
	}
	return BadAuthRequest("已创建的火山素材尚未确认可用，请核对远端资产记录；不会重复上传")
}

func (s *Service) ensureVolcLibraryGroup(ctx context.Context, userID string, config volcAssetLibraryConfig) (string, error) {
	key := "volc-library-group:" + volcLibraryScope(userID, config) + ":" + sha256Hex([]byte(config.GroupName))
	unlock, err := s.lockEggfansAsset(ctx, key)
	if err != nil {
		return "", err
	}
	defer unlock()
	if saved, err := s.repo.SystemSetting(key); err == nil {
		var id string
		if json.Unmarshal([]byte(saved.ValueJSON), &id) != nil || id == "" {
			return "", errors.New("本地火山素材组记录无效")
		}
		return id, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	var groupID string
	nameFilter := true
	for page := 1; page <= 100; page++ {
		query := map[string][]string{"page": {fmt.Sprint(page)}, "page_size": {"100"}}
		if nameFilter {
			query["name"] = []string{config.GroupName}
		}
		data, err := callVolcAssetLibrary(ctx, config, http.MethodGet, "/assets/groups", query, nil)
		if nameFilter && errors.Is(err, errVolcGroupNameFilter) {
			delete(query, "name")
			nameFilter = false
			data, err = callVolcAssetLibrary(ctx, config, http.MethodGet, "/assets/groups", query, nil)
		}
		if err != nil {
			return "", err
		}
		items, err := volcLibraryItems(data)
		if err != nil {
			return "", err
		}
		for _, value := range items {
			if group, ok := value.(map[string]any); ok && stringField(group, "name") == config.GroupName {
				groupID = volcLibraryGroupRecordID(group)
				if groupID == "" {
					return "", errors.New("火山素材组缺少记录 ID")
				}
				break
			}
		}
		if groupID != "" || len(items) < 100 {
			break
		}
		if page == 100 {
			return "", errors.New("火山素材组分页过多，请缩小素材组范围")
		}
	}
	if groupID == "" {
		data, err := callVolcAssetLibrary(ctx, config, http.MethodPost, "/assets/groups", nil, map[string]any{"name": config.GroupName, "description": config.GroupName + " 剧本素材组", "project_name": config.ProjectName})
		if err != nil {
			return "", err
		}
		group, _ := data.(map[string]any)
		groupID = volcLibraryGroupRecordID(group)
	}
	if groupID == "" {
		return "", errors.New("创建火山素材组未返回记录 ID")
	}
	encoded, _ := json.Marshal(groupID)
	return groupID, s.repo.SaveSystemSetting(&model.SystemSetting{Key: key, ValueJSON: string(encoded), UpdatedBy: userID})
}

func (s *Service) prepareVolcLibraryReferences(ctx context.Context, userID string, input *canvasGenerationInput, config volcAssetLibraryConfig) error {
	if len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios) == 0 {
		return nil
	}
	if err := validateVolcAssetLibraryConfig(config); err != nil {
		return err
	}
	for index := range input.ReferenceImages {
		binding, err := s.ensureVolcLibraryImage(ctx, userID, config, &input.ReferenceImages[index])
		if err != nil {
			return fmt.Errorf("第 %d 张火山参考图片同步失败：%w", index+1, err)
		}
		input.ReferenceImages[index].URL, input.ReferenceImages[index].DataURL = binding.URI, ""
	}
	for _, media := range [][]providerMedia{input.ReferenceVideos, input.ReferenceAudios} {
		for index := range media {
			if err := s.hydrateProviderMedia(userID, &media[index], providerMediaHydrationPolicy{RequireURL: true}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) ensureVolcLibraryImage(ctx context.Context, userID string, config volcAssetLibraryConfig, media *providerMedia) (*model.EggfansAssetBinding, error) {
	resourceID := arkPrivateAssetResourceID(*media)
	if resourceID == "" {
		return nil, BadAuthRequest("火山 URI 参考图片必须先保存到本地资产库，不能使用其他通道的未知 URI")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return nil, err
	}
	if resource.Provider != "local" || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, BadAuthRequest("本地参考图片未就绪")
	}
	accountScope := volcLibraryScope(userID, config)
	sourceKey := sha256Hex([]byte("Image\x00" + resourceID + "\x00" + config.GroupName))
	unlock, err := s.lockEggfansAsset(ctx, accountScope+":"+sourceKey)
	if err != nil {
		return nil, err
	}
	defer unlock()
	binding, err := s.repo.EggfansAssetBinding(userID, accountScope, sourceKey)
	if err == nil {
		if binding.Status == "unknown" && binding.AssetID != "" {
			if err := s.recoverVolcLibraryAsset(ctx, config, binding); err != nil {
				return nil, err
			}
		}
		if binding.Status == "active" && opaqueVideoAssetPattern.MatchString(binding.URI) {
			if err := s.saveVolcLibraryAsset(userID, resource, binding, media.Name, resource.TemporaryImageURL); err != nil {
				return nil, err
			}
			return binding, nil
		}
		return nil, BadAuthRequest("火山素材创建结果尚未确认，请核对远端资产记录后处理，避免重复创建")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	groupID, err := s.ensureVolcLibraryGroup(ctx, userID, config)
	if err != nil {
		return nil, err
	}
	publicURL, err := s.eggfansReferencePublicURL(ctx, userID, media, "Image")
	if err != nil {
		return nil, err
	}
	name := firstNonEmpty(strings.TrimSpace(media.Name), "参考图片")
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	binding = &model.EggfansAssetBinding{ID: newID(), UserID: userID, AccountScope: accountScope, SourceKey: sourceKey, ResourceID: resourceID, BaseURL: config.BaseURL, AssetType: "Image", AssetGroupID: groupID, Status: "creating", CreatedAt: time.Now().UTC()}
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, err
	}
	var groupReference any = groupID
	if id, err := strconv.ParseUint(groupID, 10, 64); err == nil && id > 0 {
		groupReference = json.Number(groupID)
	}
	data, createErr := callVolcAssetLibrary(ctx, config, http.MethodPost, "/assets", nil, map[string]any{"group_id": groupReference, "url": publicURL, "name": name, "asset_type": "Image", "project_name": config.ProjectName, "wait_for_active": true, "timeout_ms": 120000})
	if createErr == nil {
		asset, _ := data.(map[string]any)
		createErr = applyVolcLibraryAssetResult(binding, asset)
	}
	if createErr != nil {
		binding.Status, binding.URI, binding.Error = "unknown", "", "请查询远端资产，创建结果尚未确认"
		if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
			return nil, err
		}
		return nil, createErr
	}
	binding.Status = "active"
	if err := s.repo.SaveEggfansAssetBinding(binding); err != nil {
		return nil, err
	}
	if err := s.saveVolcLibraryAsset(userID, resource, binding, name, publicURL); err != nil {
		return nil, fmt.Errorf("URI 已创建，本地归档失败；下次将补存而不重复上传：%w", err)
	}
	return binding, nil
}

func (s *Service) volcLibraryDir(userID string) string {
	root := s.dataDir
	if filepath.Base(filepath.Dir(root)) == ".local" {
		root = filepath.Dir(filepath.Dir(root))
	}
	return filepath.Join(root, "asset-library", "volc", sha256Hex([]byte(userID)))
}

func writeVolcLibraryFile(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".asset-*")
	if err != nil {
		return err
	}
	temp := file.Name()
	defer os.Remove(temp)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

func (s *Service) saveVolcLibraryAsset(userID string, resource *model.Resource, binding *model.EggfansAssetBinding, name, publicURL string) error {
	dir := s.volcLibraryDir(userID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	recordPath := filepath.Join(dir, binding.ID+".json")
	if existing, err := os.ReadFile(recordPath); err == nil {
		var record VolcLibraryAsset
		if json.Unmarshal(existing, &record) == nil && record.URI == binding.URI && record.ResourceID == resource.ID {
			if _, err := os.Stat(filepath.Join(dir, filepath.Base(record.ImageFile))); err == nil {
				return nil
			}
		}
	}
	reader, err := localasset.NewFileStore(s.dataDir).Open(resource.ObjectKey)
	if err != nil {
		return err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 30*1024*1024+1))
	if err != nil {
		return err
	}
	if len(data) > 30*1024*1024 {
		return BadAuthRequest("参考图片不能超过 30 MB")
	}
	imageFile := binding.ID + resourceFileExtension(resource.ObjectKey, resource.MimeType, "image")
	if err := writeVolcLibraryFile(filepath.Join(dir, imageFile), data); err != nil {
		return err
	}
	record := VolcLibraryAsset{ID: binding.ID, ResourceID: resource.ID, AccountScope: binding.AccountScope, Name: firstNonEmpty(name, "参考图片"), URI: binding.URI, AssetID: binding.AssetID, GroupID: binding.AssetGroupID, BaseURL: binding.BaseURL, ImageFile: imageFile, PublicURL: publicURL, MimeType: resource.MimeType, Bytes: resource.Size, Width: resource.Width, Height: resource.Height, CreatedAt: binding.CreatedAt}
	encoded, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return writeVolcLibraryFile(recordPath, encoded)
}

func (s *Service) ListVolcLibraryAssets(userID string) ([]VolcLibraryAsset, error) {
	if userID == "" || !s.IsLocalMode() {
		return nil, BadAuthRequest("火山本地资产库需要本地工作区用户")
	}
	if err := os.MkdirAll(s.volcLibraryDir(userID), 0o700); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.volcLibraryDir(userID))
	if errors.Is(err, os.ErrNotExist) {
		return []VolcLibraryAsset{}, nil
	}
	if err != nil {
		return nil, err
	}
	assets := []VolcLibraryAsset{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		body, err := os.ReadFile(filepath.Join(s.volcLibraryDir(userID), entry.Name()))
		if err != nil {
			return nil, err
		}
		var record VolcLibraryAsset
		if json.Unmarshal(body, &record) != nil || record.ID+".json" != entry.Name() || filepath.Base(record.ImageFile) != record.ImageFile || !opaqueVideoAssetPattern.MatchString(record.URI) {
			return nil, errors.New("本地火山资产记录损坏，请检查 JSON 记录")
		}
		assets = append(assets, record)
	}
	sort.Slice(assets, func(left, right int) bool { return assets[left].CreatedAt.After(assets[right].CreatedAt) })
	return assets, nil
}

func (s *Service) SyncResourceToVolcLibrary(ctx context.Context, userID, resourceID, name string) (*model.EggfansAssetBinding, error) {
	if !s.IsLocalMode() || userID == "" {
		return nil, BadAuthRequest("火山本地资产库需要本地工作区用户")
	}
	config, err := s.readVolcAssetLibraryConfig()
	if err != nil {
		return nil, err
	}
	if err := validateVolcAssetLibraryConfig(config); err != nil {
		return nil, err
	}
	return s.ensureVolcLibraryImage(ctx, userID, config, &providerMedia{StorageKey: "resource:" + resourceID, Name: name})
}
