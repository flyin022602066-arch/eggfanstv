package hanbao

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var accountValue = regexp.MustCompile(`^[\p{L}\p{N}_-]{1,80}$`)
var versionValue = regexp.MustCompile(`^[0-9.]{1,32}$`)
var idValue = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
func validAccount(value string) bool { return accountValue.MatchString(value) }
func positiveID(value string) bool { return idValue.MatchString(value) }

type Runner func(context.Context, string, []string, []string, string) ([]byte, error)
type Reply struct {
	Success bool `json:"success"`
	Data map[string]any `json:"data"`
	Error string `json:"error"`
}
type TaskRef struct {
	SubmitID string `json:"submit_id"`
	Account string `json:"account"`
}
type VideoRequest struct {
	Prompt string
	Model string
	Duration int
	Ratio string
	Images [][]byte
	ImageExtensions []string
}
type UncertainError struct{ Reason string }
func (e UncertainError) Error() string { return e.Reason + "；上游可能已受理，请先核对任务，避免重复提交" }

func (s *Service) checkExecutable() error {
	if runtime.GOOS != "windows" { return errors.New("憨包本地渠道只支持 Windows") }
	if s.executable == "" { return errors.New("未找到随程序分发的憨包组件，请配置 CANVAS_HANBAO_CLI") }
	file, err := os.Open(s.executable)
	if err != nil { return errors.New("憨包组件不可读取") }
	defer file.Close()
	// Pin the supplied runtime; never execute an arbitrary substituted binary.
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil { return errors.New("憨包组件校验失败") }
	if hex.EncodeToString(hash.Sum(nil)) != CLIHash { return errors.New("憨包组件 SHA-256 与接入包不一致") }
	return nil
}

func parseReply(body []byte) (Reply, error) {
	lines := bytes.Split(bytes.TrimPrefix(body, []byte("\xef\xbb\xbf")), []byte("\n"))
	for i := len(lines)-1; i >= 0; i-- {
		var raw map[string]json.RawMessage
		if json.Unmarshal(bytes.TrimSpace(lines[i]), &raw) != nil { continue }
		var success bool
		if string(raw["success"]) != "true" && string(raw["success"]) != "false" { continue }
		_ = json.Unmarshal(raw["success"], &success)
		var reply Reply
		if err := json.Unmarshal(bytes.TrimSpace(lines[i]), &reply); err != nil { continue }
		reply.Success = success
		return reply, nil
	}
	return Reply{}, errors.New("憨包组件未返回有效响应")
}

func (s *Service) run(ctx context.Context, command string, params []string, timeout time.Duration) (Reply, error) {
	if err := s.checkExecutable(); err != nil { return Reply{}, err }
	s.mu.Lock()
	settings, err := s.load()
	s.mu.Unlock()
	if err != nil { return Reply{}, err }
	if err := os.MkdirAll(s.dataDir, 0700); err != nil { return Reply{}, err }
	env := map[string]string{"DOUBAO_BASE_DIR": s.dataDir, "APPDATA": filepath.Join(s.dataDir, ".isolated-appdata"), "DOUBAO_CHANNEL": settings.Channel, "CANVAS_ATTEMPTS": strconv.Itoa(settings.CanvasAttempts), "DOUBAO_VERSION_CODE": settings.VersionCode, "DOUBAO_PC_VERSION": settings.PCVersion}
	var environment []string
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := env[strings.ToUpper(key)]; !replaced && !strings.EqualFold(key, "DOUBAO_UPLOAD_DEBUG") { environment = append(environment, entry) }
	}
	for key, value := range env { environment = append(environment, key+"="+value) }
	childCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, processErr := s.runner(childCtx, s.executable, append([]string{command}, params...), environment, s.dataDir)
	reply, err := parseReply(body)
	submitting := command == "text2video" || command == "image2video"
	if err != nil || processErr != nil {
		if submitting { return Reply{}, UncertainError{"憨包提交进程中断或响应无效"} }
		if childCtx.Err() != nil { return Reply{}, errors.New("憨包组件等待超时或已中止") }
		return Reply{}, errors.New("憨包组件执行失败")
	}
	if !reply.Success {
		// Do not expose process logs, browser session data, or raw upstream replies.
		reason := "憨包调用失败，请检查账号状态"
		for _, item := range []struct{ match, text string }{{"额度", "憨包账号额度不足"}, {"登录", "憨包账号需要重新登录"}, {"审核", "憨包生成未通过审核"}, {"频繁", "憨包访问频繁，请稍后重试"}} {
			if strings.Contains(reply.Error, item.match) { reason = item.text; break }
		}
		if submitting { return Reply{}, UncertainError{reason} }
		return Reply{}, errors.New(reason)
	}
	return reply, nil
}

func runProcess(ctx context.Context, executable string, args, environment []string, dir string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	command.Env, command.Dir = environment, dir
	hideProcessWindow(command)
	var out bytes.Buffer
	command.Stdout = &out
	command.Stderr = &limitedDiscard{}
	err := command.Run()
	return out.Bytes(), err
}

type limitedDiscard struct{}
func (*limitedDiscard) Write(p []byte) (int, error) { return len(p), nil }

func (s *Service) Control(ctx context.Context, command, account string, plan string, dailyLimit, dailySeconds *int) (map[string]any, error) {
	switch command {
	case "accounts", "login", "checklogin", "open", "logout", "delete-account", "set-plan", "reset-quota":
	default: return nil, errors.New("不支持的账号操作")
	}
	if command != "accounts" && !validAccount(account) { return nil, errors.New("请填写有效的账号标签") }
	params := []string{}
	if command != "accounts" { params = append(params, "--account="+account) }
	if command == "login" { params = append(params, "--timeout=300") }
	if command == "set-plan" {
		if plan != "normal" && plan != "standard" { return nil, errors.New("请选择普通或标准套餐标签") }
		params = append(params, "--plan="+plan)
		for _, value := range []struct{ flag string; value *int }{{"--daily-limit", dailyLimit}, {"--daily-seconds", dailySeconds}} {
			if value.value != nil {
				if *value.value < 0 { return nil, errors.New("本地额度阈值不能为负数") }
				params = append(params, value.flag+"="+strconv.Itoa(*value.value))
			}
		}
	}
	release, err := s.Acquire()
	if err != nil { return nil, err }
	defer release()
	reply, err := s.run(ctx, command, params, 330*time.Second)
	if err != nil { return nil, err }
	return publicAccountData(reply.Data), nil
}

func publicAccountData(data map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{"active", "account", "label", "logged_in", "saved_at", "removed", "remaining", "plan", "daily_limit", "daily_seconds_limit", "used_today", "used_seconds_today", "remaining_seconds", "profile_removed", "cleared"} {
		if value, ok := data[key]; ok { result[key] = value }
	}
	if accounts, ok := data["accounts"].([]any); ok {
		list := make([]any, 0, len(accounts))
		for _, raw := range accounts {
			if account, ok := raw.(map[string]any); ok {
				item := publicAccountData(account)
				for _, key := range []string{"id", "blocked", "block_kind", "profile_ready", "last_login", "remaining_today"} { if value, ok := account[key]; ok { item[key] = value } }
				list = append(list, item)
			}
		}
		result["accounts"] = list
	}
	return result
}

func (s *Service) Submit(ctx context.Context, request VideoRequest) (TaskRef, error) {
	if strings.TrimSpace(request.Prompt) == "" || len(request.Images) > 9 || request.Duration < 4 || request.Duration > 30 { return TaskRef{}, errors.New("憨包需要提示词、4～30 秒时长及最多 9 张参考图") }
	if !SupportedModel(request.Model) { return TaskRef{}, errors.New("憨包模型不在内置清单中") }
	if !SupportedRatio(request.Ratio) { return TaskRef{}, errors.New("憨包不支持该画面比例") }
	s.mu.Lock()
	settings, err := s.load()
	s.mu.Unlock()
	if err != nil { return TaskRef{}, err }
	if !validAccount(settings.Account) { return TaskRef{}, errors.New("请先在憨包账号管理中选择生成账号") }
	params := []string{"--account="+settings.Account, "--prompt="+request.Prompt, "--model="+request.Model, "--duration="+strconv.Itoa(request.Duration), "--ratio="+request.Ratio, "--poll=0"}
	command := "text2video"
	if len(request.Images) > 0 {
		if err := os.MkdirAll(s.dataDir, 0700); err != nil { return TaskRef{}, err }
		dir, err := os.MkdirTemp(s.dataDir, "references-*")
		if err != nil { return TaskRef{}, err }
		defer os.RemoveAll(dir)
		var total int
		for index, data := range request.Images {
			total += len(data)
			if total > 4<<20 { return TaskRef{}, errors.New("憨包参考图总大小需不超过 4 MiB，请先压缩，避免组件丢弃参考图") }
			path := filepath.Join(dir, fmt.Sprintf("reference-%d.png", index))
			if err := os.WriteFile(path, data, 0600); err != nil { return TaskRef{}, err }
			params = append(params, "--image="+path)
		}
		command = "image2video"
	}
	reply, err := s.run(ctx, command, params, 300*time.Second)
	if err != nil { return TaskRef{}, err }
	id, _ := reply.Data["submit_id"].(string)
	actualAccount, _ := reply.Data["account"].(string)
	if strings.TrimSpace(id) == "" || !validAccount(actualAccount) { return TaskRef{}, UncertainError{"憨包响应缺少完整任务号或实际账号"} }
	return TaskRef{SubmitID: id, Account: actualAccount}, nil
}

func (s *Service) Query(ctx context.Context, task TaskRef) (map[string]any, error) {
	if strings.TrimSpace(task.SubmitID) == "" || !validAccount(task.Account) { return nil, errors.New("憨包任务号或实际账号缺失") }
	reply, err := s.run(ctx, "query_result", []string{"--submit_id="+task.SubmitID, "--account="+task.Account, "--once", "--timeout=300"}, 180*time.Second)
	return reply.Data, err
}

func SupportedModel(model string) bool { return model == "seedance_v2.5" || model == "seedance_v2.0_mini" || model == "seedance_v2.0" }
func SupportedRatio(ratio string) bool { return ratio == "16:9" || ratio == "9:16" || ratio == "1:1" || ratio == "4:3" || ratio == "3:4" }
