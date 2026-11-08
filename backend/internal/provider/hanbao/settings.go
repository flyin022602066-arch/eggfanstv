package hanbao

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/localcrypto"
)

const Protocol = "hanbao-video"
const ChannelID = "hanbao"
const CLIHash = "1e548f69030af8790d20a0fcd42ec2207a3e35b15ecb4c70021f4e24aad72866"

var ErrBusy = errors.New("憨包正在执行任务，请稍后再管理账号或修改设置")

type FeihuSettings struct {
	BaseURL string `json:"baseUrl"`
	APIKey string `json:"apiKey"`
	APISecret string `json:"apiSecret"`
	ProjectID string `json:"projectId"`
	Token string `json:"-"`
	HasAPIKey bool `json:"hasApiKey"`
	HasAPISecret bool `json:"hasApiSecret"`
}

type Settings struct {
	Account string `json:"account"`
	Channel string `json:"channel"`
	CanvasAttempts int `json:"canvasAttempts"`
	VersionCode string `json:"versionCode"`
	PCVersion string `json:"pcVersion"`
	Feihu FeihuSettings `json:"feihu"`
}

type Status struct {
	Settings Settings `json:"settings"`
	Available bool `json:"available"`
	Reason string `json:"reason,omitempty"`
}

type Service struct {
	dataDir string
	executable string
	mu sync.Mutex
	operation chan struct{}
	runner Runner
	// Tokens and SMS contents stay in this workspace process, never browser storage.
	token string
	orders map[string]Order
	lastPoll map[string]int64
	client HTTPClient
}

func New(dataDir string) *Service {
	return &Service{dataDir: filepath.Join(dataDir, "hanbao"), executable: findExecutable(), operation: make(chan struct{}, 1), runner: runProcess, orders: map[string]Order{}, lastPoll: map[string]int64{}}
}

func DefaultSettings() Settings {
	return Settings{Channel: "auto", CanvasAttempts: 1, VersionCode: "20800", PCVersion: "3.43.2", Feihu: FeihuSettings{BaseURL: "https://my.feihu2026.com/api/sms"}}
}

func (s *Service) load() (Settings, error) {
	settings := DefaultSettings()
	body, err := os.ReadFile(filepath.Join(s.dataDir, "settings.json"))
	if errors.Is(err, os.ErrNotExist) { return settings, nil }
	if err != nil { return settings, errors.New("读取憨包设置失败") }
	var envelope struct { Encrypted string `json:"encrypted"` }
	if json.Unmarshal(body, &envelope) != nil || envelope.Encrypted == "" { return settings, errors.New("憨包设置已损坏") }
	plain, err := localcrypto.Decrypt(s.dataDir, envelope.Encrypted)
	if err != nil { return settings, errors.New("解密憨包设置失败") }
	if json.Unmarshal([]byte(plain), &settings) != nil { return settings, errors.New("憨包设置已损坏") }
	return settings, nil
}

func (s *Service) Status() (Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings, err := s.load()
	if err != nil { return Status{}, err }
	settings.Feihu.HasAPIKey = settings.Feihu.APIKey != ""
	settings.Feihu.HasAPISecret = settings.Feihu.APISecret != ""
	settings.Feihu.APIKey, settings.Feihu.APISecret, settings.Feihu.Token = "", "", ""
	status := Status{Settings: settings}
	if err := s.checkExecutable(); err != nil { status.Reason = err.Error() } else { status.Available = true }
	return status, nil
}

func (s *Service) Save(settings Settings) error {
	release, err := s.Acquire()
	if err != nil { return err }
	defer release()
	s.mu.Lock()
	defer s.mu.Unlock()
	if settings.Account != "" && !validAccount(settings.Account) { return errors.New("账号标签只支持文字、数字、横线和下划线") }
	if settings.Channel != "auto" && settings.Channel != "canvas" && settings.Channel != "chat" { return errors.New("通道必须是 auto、canvas 或 chat") }
	if settings.CanvasAttempts < 1 || settings.CanvasAttempts > 3 { return errors.New("画布尝试次数必须在 1～3 之间") }
	if !versionValue.MatchString(settings.VersionCode) || !versionValue.MatchString(settings.PCVersion) { return errors.New("网页版本参数格式无效") }
	baseURL, err := validateFeihuBase(settings.Feihu.BaseURL)
	if err != nil { return err }
	settings.Feihu.BaseURL = baseURL
	if settings.Feihu.ProjectID != "" && !positiveID(settings.Feihu.ProjectID) { return errors.New("接码项目 ID 必须是正整数") }
	old, err := s.load()
	if err != nil { return err }
	if settings.Feihu.APIKey == "" { settings.Feihu.APIKey = old.Feihu.APIKey }
	if settings.Feihu.APISecret == "" { settings.Feihu.APISecret = old.Feihu.APISecret }
	changedSMS := old.Feihu.BaseURL != baseURL || old.Feihu.APIKey != settings.Feihu.APIKey || old.Feihu.APISecret != settings.Feihu.APISecret || old.Feihu.ProjectID != settings.Feihu.ProjectID
	if changedSMS {
		if err := s.loadOrders(); err != nil { return err }
		for _, order := range s.orders { if order.Status == 1 { return errors.New("请先收码或释放待处理订单，再修改接码凭据或项目") } }
	}
	if old.Feihu.BaseURL != baseURL || old.Feihu.APIKey != settings.Feihu.APIKey || old.Feihu.APISecret != settings.Feihu.APISecret {
		s.token = ""
	}
	settings.Feihu.HasAPIKey, settings.Feihu.HasAPISecret = false, false
	body, err := json.Marshal(settings)
	if err != nil { return err }
	ciphertext, err := localcrypto.Encrypt(s.dataDir, string(body))
	if err != nil { return errors.New("加密憨包设置失败") }
	body, _ = json.Marshal(map[string]string{"encrypted": ciphertext})
	if err := os.MkdirAll(s.dataDir, 0700); err != nil { return err }
	tmp, err := os.CreateTemp(s.dataDir, ".settings-*")
	if err != nil { return err }
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil { _, err = tmp.Write(body) }
	if err == nil { err = tmp.Sync() }
	closeErr := tmp.Close()
	if err != nil { return err }
	if closeErr != nil { return closeErr }
	return os.Rename(tmp.Name(), filepath.Join(s.dataDir, "settings.json"))
}

// A single lease covers submission and all polling, so profile deletion cannot
// race a generation between two CLI invocations.
func (s *Service) Acquire() (func(), error) {
	select {
	case s.operation <- struct{}{}: return func() { <-s.operation }, nil
	default: return nil, ErrBusy
	}
}

func findExecutable() string {
	if configured := strings.TrimSpace(os.Getenv("CANVAS_HANBAO_CLI")); configured != "" { return configured }
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "tools", "hanbao", "doubao.exe")
		if _, err := os.Stat(candidate); err == nil { return candidate }
	}
	current, _ := os.Getwd()
	for range 8 {
		candidate := filepath.Join(current, "tools", "hanbao", "doubao.exe")
		if _, err := os.Stat(candidate); err == nil { return candidate }
		parent := filepath.Dir(current)
		if parent == current { break }
		current = parent
	}
	return ""
}
