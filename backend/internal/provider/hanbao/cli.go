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

var accountValue = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}_-]{0,79}$`)
var versionValue = regexp.MustCompile(`^[0-9.]{1,32}$`)
var idValue = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

func validAccount(value string) bool { return accountValue.MatchString(value) }
func positiveID(value string) bool   { return idValue.MatchString(value) }

type Runner func(context.Context, string, []string, []string, string) ([]byte, error)
type Reply struct {
	Success bool            `json:"success"`
	Data    map[string]any  `json:"data"`
	Error   string          `json:"error"`
	Code    json.RawMessage `json:"code"`
}
type TaskRef struct {
	SubmitID string `json:"submit_id"`
	Account  string `json:"account"`
}
type VideoRequest struct {
	Prompt          string
	Model           string
	Duration        int
	Ratio           string
	Images          [][]byte
	ImageExtensions []string
}
type UncertainError struct {
	Reason string
	Cause  error
}

func (e UncertainError) Error() string {
	return e.Reason + "；上游可能已受理，请先核对任务，避免重复提交"
}

func (e UncertainError) Unwrap() error { return e.Cause }

func (s *Service) checkExecutable() error {
	if runtime.GOOS != "windows" {
		return errors.New("憨包本地渠道只支持 Windows")
	}
	if s.executable == "" {
		return errors.New("未找到随程序分发的憨包组件，请配置 CANVAS_HANBAO_CLI")
	}
	file, err := os.Open(s.executable)
	if err != nil {
		return errors.New("憨包组件不可读取")
	}
	defer file.Close()
	// Pin the supplied runtime; never execute an arbitrary substituted binary.
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return errors.New("憨包组件校验失败")
	}
	if hex.EncodeToString(hash.Sum(nil)) != CLIHash {
		return errors.New("憨包组件 SHA-256 与接入包不一致")
	}
	return nil
}

func parseReply(body []byte) (Reply, error) {
	var result Reply
	found := false
	for offset := 0; offset < len(body); {
		start := bytes.IndexByte(body[offset:], '{')
		if start < 0 {
			break
		}
		offset += start
		decoder := json.NewDecoder(bytes.NewReader(body[offset:]))
		var raw map[string]json.RawMessage
		if decoder.Decode(&raw) != nil {
			offset++
			continue
		}
		offset += int(decoder.InputOffset())
		if string(raw["success"]) != "true" && string(raw["success"]) != "false" {
			continue
		}
		encoded, _ := json.Marshal(raw)
		var reply Reply
		replyDecoder := json.NewDecoder(bytes.NewReader(encoded))
		replyDecoder.UseNumber()
		if err := replyDecoder.Decode(&reply); err != nil {
			continue
		}
		result, found = reply, true
	}
	if found {
		return result, nil
	}
	return Reply{}, errors.New("憨包组件未返回有效响应")
}

func submissionTaskRef(reply Reply) (TaskRef, bool) {
	var id string
	for _, key := range []string{"submit_id", "conversation_id"} {
		switch value := reply.Data[key].(type) {
		case string:
			id = strings.TrimSpace(value)
		case json.Number:
			if positiveID(value.String()) {
				id = value.String()
			}
		}
		if id != "" {
			break
		}
	}
	account, _ := reply.Data["account"].(string)
	return TaskRef{SubmitID: id, Account: account}, id != "" && validAccount(account)
}

func (s *Service) run(ctx context.Context, command string, params []string, timeout time.Duration) (Reply, error) {
	if err := s.checkExecutable(); err != nil {
		return Reply{}, err
	}
	s.mu.Lock()
	settings, err := s.load()
	s.mu.Unlock()
	if err != nil {
		return Reply{}, err
	}
	if err := os.MkdirAll(s.dataDir, 0700); err != nil {
		return Reply{}, err
	}
	env := map[string]string{"DOUBAO_BASE_DIR": s.dataDir, "APPDATA": filepath.Join(s.dataDir, ".isolated-appdata"), "DOUBAO_CHANNEL": settings.Channel, "CANVAS_ATTEMPTS": strconv.Itoa(settings.CanvasAttempts), "DOUBAO_VERSION_CODE": settings.VersionCode, "DOUBAO_PC_VERSION": settings.PCVersion}
	var environment []string
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := env[strings.ToUpper(key)]; !replaced && !strings.EqualFold(key, "DOUBAO_UPLOAD_DEBUG") {
			environment = append(environment, entry)
		}
	}
	for key, value := range env {
		environment = append(environment, key+"="+value)
	}
	childCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, processErr := s.runner(childCtx, s.executable, append([]string{command}, params...), environment, s.dataDir)
	if command == "login" && childCtx.Err() != nil {
		return Reply{}, fmt.Errorf("憨包登录等待已结束：%w", childCtx.Err())
	}
	reply, err := parseReply(body)
	submitting := command == "text2video" || command == "image2video"
	if err == nil && submitting {
		if _, accepted := submissionTaskRef(reply); accepted {
			return reply, nil
		}
	}
	if err == nil && reply.Success {
		return reply, nil
	}
	if err == nil && command == "query_result" && TerminalStatus(reply.Data) {
		return reply, nil
	}
	reason := "组件未返回有效 JSON 回执"
	if err == nil {
		reason = safeRuntimeMessage(reply.Error, settings)
		if reason == "" {
			reason = "组件返回调用失败，未提供详细原因"
		}
	}
	if childCtx.Err() != nil {
		reason += "；组件等待超时或已中止"
	}
	var exit *exec.ExitError
	if errors.As(processErr, &exit) {
		reason += fmt.Sprintf("；进程退出码=%d", exit.ExitCode())
	}
	failure := &CallError{Source: "local_runtime", Stage: command, Code: replyCode(reply.Code), Reason: reason}
	if submitting {
		if err == nil && !reply.Success && ConfirmedCanvasFailure(reply.Error) {
			failure.Source = "upstream_response"
			if failure.Code != "" {
				failure.Reason += "；组件返回码=" + failure.Code
				failure.Code = ""
			}
			return Reply{}, failure
		}
		var missing *exec.Error
		var path *os.PathError
		if errors.As(processErr, &missing) || errors.As(processErr, &path) {
			failure.Reason = "本地组件未能启动，尚未提交生成"
			return Reply{}, failure
		}
		return Reply{}, UncertainError{Reason: failure.Error(), Cause: failure}
	}
	return Reply{}, failure
}

func runProcess(ctx context.Context, executable string, args, environment []string, dir string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	command.Env, command.Dir = environment, dir
	hideProcessWindow(command)
	var out, stderr bytes.Buffer
	command.Stdout = &out
	command.Stderr = &stderr
	err := command.Run()
	if _, parseErr := parseReply(out.Bytes()); parseErr != nil {
		if reply, stderrErr := parseReply(stderr.Bytes()); stderrErr == nil {
			body, _ := json.Marshal(reply)
			return body, err
		}
	}
	return out.Bytes(), err
}

func (s *Service) Control(ctx context.Context, command, account string, plan string, dailyLimit, dailySeconds *int) (map[string]any, error) {
	if s.mutableGuard != nil {
		if err := s.mutableGuard(); err != nil {
			return nil, err
		}
	}
	switch command {
	case "accounts", "login", "checklogin", "open", "logout", "delete-account", "set-plan", "reset-quota":
	default:
		return nil, errors.New("不支持的账号操作")
	}
	if command != "accounts" && !validAccount(account) {
		return nil, errors.New("请填写有效的账号标签")
	}
	params := []string{}
	if command != "accounts" {
		params = append(params, "--account="+account)
	}
	if command == "login" {
		params = append(params, "--timeout=300")
	}
	if command == "set-plan" {
		if plan != "normal" && plan != "standard" {
			return nil, errors.New("请选择普通或标准套餐标签")
		}
		params = append(params, "--plan="+plan)
		for _, value := range []struct {
			flag  string
			value *int
		}{{"--daily-limit", dailyLimit}, {"--daily-seconds", dailySeconds}} {
			if value.value != nil {
				if *value.value < 0 {
					return nil, errors.New("本地额度阈值不能为负数")
				}
				params = append(params, value.flag+"="+strconv.Itoa(*value.value))
			}
		}
	}
	release, err := s.Acquire()
	if err != nil {
		return nil, err
	}
	defer release()
	reply, err := s.run(ctx, command, params, 330*time.Second)
	if err != nil {
		return nil, err
	}
	if command == "login" && reply.Data["logged_in"] != true {
		return nil, &CallError{Source: "local_runtime", Stage: "login", Reason: "未确认登录完成，请点击账号的“检查登录”核对；如未登录，请重新打开登录窗口"}
	}
	return publicAccountData(reply.Data), nil
}

func publicAccountData(data map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{"active", "account", "label", "logged_in", "saved_at", "removed", "remaining", "plan", "daily_limit", "daily_seconds_limit", "used_today", "used_seconds_today", "remaining_seconds", "profile_removed", "cleared"} {
		if value, ok := data[key]; ok {
			result[key] = value
		}
	}
	if accounts, ok := data["accounts"].([]any); ok {
		list := make([]any, 0, len(accounts))
		for _, raw := range accounts {
			if account, ok := raw.(map[string]any); ok {
				item := publicAccountData(account)
				for _, key := range []string{"id", "blocked", "block_kind", "profile_ready", "last_login", "remaining_today"} {
					if value, ok := account[key]; ok {
						item[key] = value
					}
				}
				list = append(list, item)
			}
		}
		result["accounts"] = list
	}
	return result
}

func (s *Service) Submit(ctx context.Context, request VideoRequest) (TaskRef, error) {
	request.Model = CanonicalModel(request.Model)
	if strings.TrimSpace(request.Prompt) == "" || len(request.Images) > 9 || request.Duration < 4 || request.Duration > 30 {
		return TaskRef{}, errors.New("憨包需要提示词、4～30 秒时长及最多 9 张参考图")
	}
	if !SupportedModel(request.Model) {
		return TaskRef{}, errors.New("憨包模型不在内置清单中")
	}
	if !SupportedRatio(request.Ratio) {
		return TaskRef{}, errors.New("憨包不支持该画面比例")
	}
	s.mu.Lock()
	settings, err := s.load()
	s.mu.Unlock()
	if err != nil {
		return TaskRef{}, err
	}
	params := []string{"--prompt=" + request.Prompt, "--model=" + request.Model, "--duration=" + strconv.Itoa(request.Duration), "--ratio=" + request.Ratio, "--poll=0"}
	command := "text2video"
	if len(request.Images) > 0 {
		if err := os.MkdirAll(s.dataDir, 0700); err != nil {
			return TaskRef{}, err
		}
		dir, err := os.MkdirTemp(s.dataDir, "references-*")
		if err != nil {
			return TaskRef{}, err
		}
		defer os.RemoveAll(dir)
		for index, data := range request.Images {
			extension := ".png"
			if index < len(request.ImageExtensions) {
				switch request.ImageExtensions[index] {
				case ".jpg", ".jpeg", ".webp", ".png":
					extension = request.ImageExtensions[index]
				}
			}
			path := filepath.Join(dir, fmt.Sprintf("reference-%d%s", index, extension))
			if err := os.WriteFile(path, data, 0600); err != nil {
				return TaskRef{}, err
			}
			params = append(params, "--image="+path)
		}
		command = "image2video"
	}
	account, err := s.selectAccount(ctx, settings.Account, request.Duration)
	if err != nil {
		return TaskRef{}, err
	}
	params = append([]string{"--account=" + account}, params...)
	reply, err := s.run(ctx, command, params, 300*time.Second)
	if err != nil {
		return TaskRef{}, err
	}
	ref, accepted := submissionTaskRef(reply)
	if !accepted {
		failure := &CallError{Source: "local_runtime", Stage: command, Reason: "响应缺少完整任务号或实际账号"}
		return TaskRef{}, UncertainError{Reason: failure.Error(), Cause: failure}
	}
	return ref, nil
}

func (s *Service) Query(ctx context.Context, task TaskRef) (map[string]any, error) {
	if strings.TrimSpace(task.SubmitID) == "" || !validAccount(task.Account) {
		return nil, errors.New("憨包任务号或实际账号缺失")
	}
	reply, err := s.run(ctx, "query_result", []string{"--submit_id=" + task.SubmitID, "--account=" + task.Account, "--once", "--timeout=300"}, 330*time.Second)
	return reply.Data, err
}

func SupportedModel(model string) bool {
	return CanonicalModel(model) != ""
}

// CanonicalModel accepts the display names used by the supplied CLI as well
// as the stable enum values persisted by BeefTV. Older workspaces may have
// saved a display name, so normalize it before admission and submission.
func CanonicalModel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "seedance_v2.5", "seedance 2.5", "seedance-2.5", "seedance2.5":
		return "seedance_v2.5"
	case "seedance_v2.0_mini", "seedance 2.0 mini", "seedance-2.0-mini", "seedance2.0 mini":
		return "seedance_v2.0_mini"
	case "seedance_v2.0", "seedance 2.0", "seedance-2.0", "seedance2.0", "seedance 2.0 fast":
		return "seedance_v2.0"
	default:
		return ""
	}
}

func SupportedRatio(ratio string) bool {
	return ratio == "16:9" || ratio == "9:16" || ratio == "1:1" || ratio == "4:3" || ratio == "3:4"
}
