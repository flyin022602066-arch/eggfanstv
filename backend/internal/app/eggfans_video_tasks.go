package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type EggfansVideoTaskQuery struct {
	Config   providerConfig `json:"config"`
	TaskID   string         `json:"taskId,omitempty"`
	PageSize int            `json:"pageSize,omitempty"`
}

func (s *Service) QueryEggfansVideoTasks(ctx context.Context, userID string, request EggfansVideoTaskQuery) (map[string]any, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, BadAuthRequest("视频任务查询缺少工作区用户")
	}
	config, err := s.resolveProviderConfig(request.Config)
	if err != nil {
		return nil, err
	}
	if config.APIKey == "" || config.BaseURL == "" || !isEggfansSeedanceProtocol(config.InterfaceType) {
		return nil, BadAuthRequest("请选择已配置密钥的 Eggfans Seedance 接口")
	}
	path := "/api/v3/contents/generations/tasks"
	if config.InterfaceType == string(model.ChannelInterfaceEggfansVolcVideo) {
		path = "/volc/v1/contents/generations/tasks"
	}
	query := map[string][]string{}
	if request.TaskID != "" {
		if strings.TrimSpace(request.TaskID) != request.TaskID || strings.ContainsAny(request.TaskID, "/\\?#") || request.TaskID == "." || request.TaskID == ".." {
			return nil, BadAuthRequest("视频任务 ID 无效")
		}
		path += "/" + url.PathEscape(request.TaskID)
	} else {
		pageSize := request.PageSize
		if pageSize == 0 {
			pageSize = 20
		}
		if pageSize < 1 || pageSize > 100 {
			return nil, BadAuthRequest("每页任务数量必须为 1–100")
		}
		query["page_size"] = []string{strconv.Itoa(pageSize)}
	}
	encoded, err := executeProtocolRequest(withoutProviderAnalytics(ctx), config, protocol.RequestSpec{Method: http.MethodGet, Path: path, OriginPath: true, Auth: protocol.ManifestAuth{Type: "bearer", Field: "apiKey"}, Query: query})
	if err != nil {
		return nil, err
	}
	if _, _, failed := providerResponseBusinessFailure(encoded); failed {
		return nil, errors.New(classifyProviderHTTP(providerHTTPError{StatusCode: http.StatusBadRequest, Body: string(encoded)}).UserMessage())
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return nil, errors.New("Eggfans 视频任务返回了无法解析的数据")
	}
	if data, ok := payload["data"].(map[string]any); ok {
		return data, nil
	}
	return payload, nil
}
