package hanbao

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infinite-canvas/backend/internal/localcrypto"
	"infinite-canvas/backend/internal/outbound"
)

type HTTPClient interface { Do(*http.Request) (*http.Response, error) }

type Order struct {
	ID string `json:"order_id"`
	Phone string `json:"phone"`
	Account string `json:"account"`
	ProjectID string `json:"pid"`
	Status int `json:"status"`
	Code string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type SMSRequest struct {
	Account string `json:"account"`
	OrderID string `json:"orderId"`
	Filters map[string]string `json:"filters"`
}

func validateFeihuBase(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("接码平台地址必须是无账号、查询参数的 HTTPS 地址")
	}
	if parsed.Path == "" { parsed.Path = "/api/sms" }
	if parsed.Path != "/api/sms" { return "", errors.New("接码平台基础路径必须为 /api/sms") }
	if _, err := outbound.ValidateCustomRelayURL(parsed.String()); err != nil { return "", err }
	return parsed.String(), nil
}

func (s *Service) smsCall(ctx context.Context, settings FeihuSettings, action string, fields url.Values) (map[string]any, error) {
	base, err := validateFeihuBase(settings.BaseURL)
	if err != nil { return nil, err }
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/"+action, strings.NewReader(fields.Encode()))
	if err != nil { return nil, errors.New("无法创建接码请求") }
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	outbound.ApplyDefaultOutboundHeaders(req)
	client := s.client
	if client == nil { client = outbound.CustomRelayHTTPClient(30*time.Second) }
	response, err := client.Do(req)
	if err != nil { return nil, errors.New("飞狐接码连接失败，请检查服务地址和网络") }
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 { return nil, fmt.Errorf("飞狐接码 HTTP 请求失败（%d）", response.StatusCode) }
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 { return nil, errors.New("飞狐接码响应无效或过大") }
	var envelope struct { Code int `json:"code"`; Data map[string]any `json:"data"` }
	if json.Unmarshal(body, &envelope) != nil { return nil, errors.New("飞狐接码未返回有效 JSON") }
	if envelope.Code != 200 { return nil, fmt.Errorf("飞狐接码业务请求失败（code=%d）", envelope.Code) }
	return envelope.Data, nil
}

func (s *Service) smsToken(ctx context.Context, settings FeihuSettings) (string, error) {
	if s.token != "" { return s.token, nil }
	if settings.APIKey == "" || settings.APISecret == "" { return "", errors.New("请先保存飞狐 API Key 和 API 密钥") }
	data, err := s.smsCall(ctx, settings, "login", url.Values{"user": {settings.APIKey}, "pass": {settings.APISecret}})
	if err != nil { return "", err }
	token, _ := data["token"].(string)
	if token == "" { return "", errors.New("飞狐登录响应缺少 Token") }
	s.token = token
	return token, nil
}

func (s *Service) loadOrders() error {
	body, err := os.ReadFile(filepath.Join(s.dataDir, "sms-orders.json"))
	if errors.Is(err, os.ErrNotExist) { return nil }
	if err != nil { return errors.New("读取憨包接码订单失败") }
	var cipher string
	if json.Unmarshal(body, &cipher) != nil { return errors.New("憨包接码订单文件损坏") }
	plain, err := localcrypto.Decrypt(s.dataDir, cipher)
	if err != nil { return errors.New("解密憨包接码订单失败") }
	if json.Unmarshal([]byte(plain), &s.orders) != nil { return errors.New("憨包接码订单文件损坏") }
	if s.orders == nil { s.orders = map[string]Order{} }
	return nil
}

func (s *Service) saveOrders() error {
	body, err := json.Marshal(s.orders)
	if err != nil { return err }
	cipher, err := localcrypto.Encrypt(s.dataDir, string(body))
	if err != nil { return err }
	body, _ = json.Marshal(cipher)
	tmp, err := os.CreateTemp(s.dataDir, ".sms-orders-*")
	if err != nil { return err }
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil { _, err = tmp.Write(body) }
	if err == nil { err = tmp.Sync() }
	closeErr := tmp.Close()
	if err != nil { return err }
	if closeErr != nil { return closeErr }
	return os.Rename(tmp.Name(), filepath.Join(s.dataDir, "sms-orders.json"))
}

// This is deliberately not a general SMS relay. Orders must have been created
// here for a named Hanbao account; global release-all and arbitrary IDs are absent.
func (s *Service) SMS(ctx context.Context, action string, input SMSRequest) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch action {
	case "connect", "info", "projects", "orders", "receive", "message", "release", "blacklist":
	default: return nil, errors.New("不支持的憨包接码操作")
	}
	if err := s.loadOrders(); err != nil { return nil, err }
	if action == "orders" {
		orders := make([]Order, 0, len(s.orders))
		for _, order := range s.orders { orders = append(orders, order) }
		return orders, nil
	}
	settings, err := s.load()
	if err != nil { return nil, err }
	if action == "connect" { s.token = "" }
	if action == "receive" {
		if !validAccount(input.Account) { return nil, errors.New("请指定憨包账号标签") }
		if !positiveID(settings.Feihu.ProjectID) { return nil, errors.New("请先选择并保存憨包的接码项目 ID") }
		for _, order := range s.orders {
			if order.Account == input.Account && order.Status == 1 { return nil, errors.New("这个憨包账号已有待收码订单，请先收码或释放") }
		}
	}
	var order Order
	if action == "message" || action == "release" || action == "blacklist" {
		var exists bool
		order, exists = s.orders[input.OrderID]
		if !exists || order.ProjectID != settings.Feihu.ProjectID { return nil, errors.New("订单不属于当前憨包接码项目") }
		if action == "message" {
			if order.Status != 1 { return order, nil }
			if time.Now().UnixMilli()-s.lastPoll[order.ID] < 10000 { return nil, errors.New("请至少间隔 10 秒查询短信") }
			s.lastPoll[order.ID] = time.Now().UnixMilli()
		}
	}
	token, err := s.smsToken(ctx, settings.Feihu)
	if err != nil { return nil, err }
	fields := url.Values{"token": {token}}
	switch action {
	case "connect": return map[string]bool{"connected": true}, nil
	case "info": return s.smsCall(ctx, settings.Feihu, "userInfo", fields)
	case "projects":
		fields.Set("name", "豆包")
		return s.smsCall(ctx, settings.Feihu, "projectList", fields)
	case "receive":
		fields.Set("pid", settings.Feihu.ProjectID)
		for _, key := range []string{"phone", "isp", "province", "cardType", "include", "exclude", "author", "mode", "code", "hk"} {
			if value := input.Filters[key]; value != "" {
				if len(value) > 200 { return nil, errors.New("接码筛选参数过长") }
				fields.Set(key, value)
			}
		}
		data, err := s.smsCall(ctx, settings.Feihu, "getPhone", fields)
		if err != nil { return nil, err }
		id, _ := data["order_id"].(string)
		phone, _ := data["phone"].(string)
		if id == "" || phone == "" { return nil, errors.New("飞狐取号响应缺少号码或订单号，请核对平台订单后再操作") }
		order = Order{ID:id, Phone:phone, Account:input.Account, ProjectID:settings.Feihu.ProjectID, Status:1}
	case "message":
		fields.Set("order_id", order.ID)
		data, err := s.smsCall(ctx, settings.Feihu, "getMessage", fields)
		if err != nil { return nil, err }
		status, ok := data["status"].(float64)
		if !ok { return nil, errors.New("飞狐收码响应缺少状态") }
		if status != 1 && status != 3 && status != 4 && status != 5 && status != 6 { return nil, errors.New("飞狐收码返回未知状态") }
		order.Status = int(status)
		order.Code, _ = data["code"].(string)
		order.Message, _ = data["message"].(string)
	case "release", "blacklist":
		fields.Set("order_id", order.ID)
		upstream := "cancelRecv"
		if action == "blacklist" { upstream = "addBlackList" }
		if _, err := s.smsCall(ctx, settings.Feihu, upstream, fields); err != nil { return nil, err }
		order.Status = 5
	}
	s.orders[order.ID] = order
	if err := s.saveOrders(); err != nil { return order, errors.New("平台操作已完成，但本地订单保存失败；请核对该订单，避免重复取号") }
	return order, nil
}
