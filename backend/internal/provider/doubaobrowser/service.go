// Package doubaobrowser isolates the browser worker and account pool per workspace owner.
package doubaobrowser

import (
	"bufio"
	"context"
	"crypto/sha256"
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
	"sync"
	"time"
	"unicode/utf8"
)

const Protocol = "doubao-browser-video"
const ChannelID = "doubao-browser"

var taskIDPattern = regexp.MustCompile("^[A-Za-z0-9_-]{1,128}$")
var profileIDPattern = regexp.MustCompile("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")

func ValidReceipt(ref Receipt) bool {
	return taskIDPattern.MatchString(ref.TaskID) && profileIDPattern.MatchString(ref.ProfileID)
}

type BeforeSubmitError struct{ Cause error }

type ReceiptNotFoundError struct{}

func (ReceiptNotFoundError) Error() string {
	return "未找到原任务浏览器回执；无法确认上游是否受理，已停止自动查询，可重新查询或仅本地停止；不会重新生成"
}

func (e BeforeSubmitError) Error() string { return e.Cause.Error() }
func (e BeforeSubmitError) Unwrap() error { return e.Cause }

type Request struct {
	TaskID   string   `json:"taskId"`
	Model    string   `json:"model"`
	Prompt   string   `json:"prompt"`
	Duration int      `json:"duration"`
	Ratio    string   `json:"ratio"`
	Images   []string `json:"images"`
}
type Receipt struct {
	TaskID    string `json:"taskId"`
	ProfileID string `json:"profileId"`
}
type Result struct {
	Status   string `json:"status"`
	VideoURL string `json:"videoUrl"`
	Reason   string `json:"reason"`
}

func IsModel(model string) bool {
	switch model {
	case "seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini":
		return true
	}
	return false
}

type reply struct {
	ID               int64           `json:"id"`
	Data             json.RawMessage `json:"data"`
	Error            string          `json:"error"`
	BeforeGeneration bool            `json:"beforeGeneration"`
}
type worker struct {
	cmd        *exec.Cmd
	in         io.WriteCloser
	mu         sync.Mutex
	writes     sync.Mutex
	pending    map[int64]chan reply
	next       int64
	done       chan struct{}
	exitReason string
}
type Service struct {
	directory string
	mu        sync.Mutex
	workers   map[string]*worker
	closed    bool
}

func New(directory string) *Service {
	return &Service{directory: filepath.Join(directory, "doubao-browser"), workers: map[string]*worker{}}
}

// Resume only starts a worker for an explicitly enabled, existing pool.
func (s *Service) Resume(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("缺少工作区身份")
	}
	file := filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID))), "pool.json")
	stream, err := os.Open(file)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return errors.New("读取豆包浏览器维护设置失败")
	}
	defer stream.Close()
	var settings struct{ Enabled bool }
	if err := json.NewDecoder(io.LimitReader(stream, 32<<20)).Decode(&settings); err != nil {
		return errors.New("豆包浏览器账号池记录损坏")
	}
	if !settings.Enabled {
		return nil
	}
	_, err = s.start(userID)
	return err
}

func findRuntime() (string, string, error) {
	root, _ := os.Getwd()
	exe, _ := os.Executable()
	roots := []string{filepath.Dir(exe), root}
	for range 8 {
		roots = append(roots, root)
		parent := filepath.Dir(root)
		if parent == root {
			break
		}
		root = parent
	}
	for _, root := range roots {
		script := filepath.Join(root, "tools", "doubao-browser", "server.mjs")
		if _, err := os.Stat(script); err != nil {
			continue
		}
		name := "node"
		if runtime.GOOS == "windows" {
			name = "node.exe"
		}
		for _, node := range []string{filepath.Join(root, "agent-host", "runtime", name), filepath.Join(root, "agent-host", "runtime", "bin", name)} {
			if _, err := os.Stat(node); err == nil {
				return node, script, nil
			}
		}
		if node, err := exec.LookPath(name); err == nil {
			return node, script, nil
		}
	}
	return "", "", errors.New("豆包浏览器运行文件或 Node 24 缺失")
}
func (s *Service) start(userID string) (*worker, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("缺少工作区身份")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("豆包浏览器运行层已关闭")
	}
	if w := s.workers[userID]; w != nil {
		select {
		case <-w.done:
			delete(s.workers, userID)
		default:
			return w, nil
		}
	}
	node, script, err := findRuntime()
	if err != nil {
		return nil, err
	}
	directory, err := filepath.Abs(filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID)))))
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	cmd := exec.Command(node, script, directory)
	// Only launch prerequisites reach the browser worker, never provider/API credentials.
	for _, key := range []string{"PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "EGGFANSTV_CHROMIUM"} {
		if value := os.Getenv(key); value != "" {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	hideWorkerWindow(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	diagnostics := &workerDiagnostics{}
	cmd.Stderr = diagnostics
	if err := cmd.Start(); err != nil {
		return nil, errors.New("启动豆包浏览器运行层失败")
	}
	w := &worker{cmd: cmd, in: in, pending: map[int64]chan reply{}, done: make(chan struct{})}
	s.workers[userID] = w
	go func() {
		scanner := bufio.NewScanner(out)
		scanner.Buffer(make([]byte, 4096), 4<<20)
		for scanner.Scan() {
			var packet reply
			if json.Unmarshal(scanner.Bytes(), &packet) != nil {
				continue
			}
			w.mu.Lock()
			ch := w.pending[packet.ID]
			delete(w.pending, packet.ID)
			w.mu.Unlock()
			if ch != nil {
				ch <- packet
			}
		}
		scanErr := scanner.Err()
		waitErr := cmd.Wait()
		if waitErr != nil || scanErr != nil {
			w.exitReason = diagnostics.reason()
			if w.exitReason == "" {
				w.exitReason = "浏览器工作进程异常退出"
			}
			if scanErr != nil {
				w.exitReason = "浏览器工作进程响应读取中断"
			}
			code := -1
			if cmd.ProcessState != nil {
				code = cmd.ProcessState.ExitCode()
			}
			w.exitReason += fmt.Sprintf("；进程退出码=%d", code)
			record, _ := json.Marshal(map[string]any{"reason": w.exitReason, "exitCode": code, "time": time.Now().UTC().Format(time.RFC3339Nano)})
			_ = os.WriteFile(filepath.Join(directory, "worker-exit.json"), record, 0600)
		}
		close(w.done)
	}()
	return w, nil
}
func (s *Service) call(ctx context.Context, userID, method string, params any, result any, finished ...func()) error {
	var completion func()
	if len(finished) > 0 {
		completion = finished[0]
	}
	defer func() {
		if completion != nil {
			completion()
		}
	}()
	if err := ctx.Err(); err != nil {
		return err
	}
	w, err := s.start(userID)
	if err != nil {
		if method == "submit" {
			return BeforeSubmitError{Cause: err}
		}
		return err
	}
	w.mu.Lock()
	w.next++
	id := w.next
	ch := make(chan reply, 1)
	w.pending[id] = ch
	w.mu.Unlock()
	retained := false
	removePending := func() { w.mu.Lock(); delete(w.pending, id); w.mu.Unlock() }
	defer func() {
		if !retained {
			removePending()
		}
	}()
	body, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		if method == "submit" {
			return BeforeSubmitError{Cause: err}
		}
		return err
	}
	w.writes.Lock()
	_, err = w.in.Write(append(body, '\n'))
	w.writes.Unlock()
	if err != nil {
		s.retireWorker(userID, w)
		return errors.New("浏览器运行层连接中断，提交结果可能未确认")
	}
	select {
	case <-ctx.Done():
		if completion != nil {
			retained = true
			callback := completion
			completion = nil
			go func() {
				select {
				case <-ch:
				case <-w.done:
				}
				removePending()
				callback()
			}()
		}
		return ctx.Err()
	case <-w.done:
		return errors.New(defaultWorkerExit(w.exitReason))
	case packet := <-ch:
		if packet.Error != "" {
			if method == "submit" && packet.BeforeGeneration {
				return BeforeSubmitError{Cause: errors.New(packet.Error)}
			}
			return errors.New(packet.Error)
		}
		if result != nil {
			if err := json.Unmarshal(packet.Data, result); err != nil {
				return errors.New("浏览器运行层返回无效数据")
			}
		}
		return nil
	}
}

func (s *Service) retireWorker(userID string, current *worker) {
	s.mu.Lock()
	if s.workers[userID] == current {
		delete(s.workers, userID)
	}
	s.mu.Unlock()
	_ = current.in.Close()
	if current.cmd != nil && current.cmd.Process != nil {
		_ = current.cmd.Process.Kill()
	}
}

func (s *Service) Control(ctx context.Context, userID, action string, input any) (map[string]any, error) {
	switch action {
	case "status", "configure", "open", "clear":
	default:
		return nil, errors.New("不支持的账号管理操作")
	}
	var result map[string]any
	err := s.call(ctx, userID, action, input, &result)
	return result, err
}
func (s *Service) Submit(ctx context.Context, userID string, input Request) (Receipt, error) {
	var result Receipt
	wire, cleanup, err := s.prepareSubmission(userID, input)
	if err != nil {
		return result, BeforeSubmitError{Cause: err}
	}
	err = s.call(ctx, userID, "submit", wire, &result, cleanup)
	return result, err
}
func (s *Service) Query(ctx context.Context, userID string, input Receipt) (Result, error) {
	var result Result
	err := s.call(ctx, userID, "query", input, &result)
	return result, err
}
func (s *Service) Lookup(ctx context.Context, userID, taskID string) (Receipt, error) {
	if err := ctx.Err(); err != nil {
		return Receipt{}, err
	}
	if strings.TrimSpace(userID) == "" || !taskIDPattern.MatchString(taskID) {
		return Receipt{}, errors.New("原任务身份无效")
	}
	file := filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID))), "pool.json")
	stream, err := os.Open(file)
	if os.IsNotExist(err) {
		return Receipt{}, ReceiptNotFoundError{}
	}
	if err != nil {
		return Receipt{}, errors.New("读取原任务浏览器回执失败")
	}
	defer stream.Close()
	var pool struct {
		Jobs map[string]struct {
			Receipt Receipt `json:"receipt"`
		} `json:"jobs"`
	}
	if err := json.NewDecoder(stream).Decode(&pool); err != nil {
		return Receipt{}, errors.New("原任务浏览器回执文件损坏，无法核对")
	}
	if err := ctx.Err(); err != nil {
		return Receipt{}, err
	}
	job, exists := pool.Jobs[taskID]
	if !exists {
		return Receipt{}, ReceiptNotFoundError{}
	}
	if job.Receipt.TaskID != taskID || !ValidReceipt(job.Receipt) {
		return Receipt{}, errors.New("原任务浏览器回执无效")
	}
	return job.Receipt, nil
}
func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	workers := make([]*worker, 0, len(s.workers))
	for _, w := range s.workers {
		workers = append(workers, w)
	}
	s.mu.Unlock()
	for _, w := range workers {
		_ = w.in.Close()
		select {
		case <-w.done:
		case <-time.After(8 * time.Second):
			_ = w.cmd.Process.Kill()
			select {
			case <-w.done:
			case <-time.After(2 * time.Second):
			}
		}
	}
}
func Validate(input Request) error {
	if !taskIDPattern.MatchString(input.TaskID) || !IsModel(input.Model) {
		return errors.New("豆包浏览器任务或模型无效")
	}
	maximum := 15
	if input.Model == "seedance_v2.5" {
		maximum = 30
	}
	if input.Duration < 1 || input.Duration > maximum {
		return errors.New("当前模型时长须为 1～" + strconv.Itoa(maximum) + " 秒")
	}
	if strings.TrimSpace(input.Prompt) == "" || utf8.RuneCountInString(input.Prompt) > 8000 {
		return errors.New("提示词须为 1～8000 字符")
	}
	switch input.Ratio {
	case "16:9", "9:16", "1:1", "4:3", "3:4":
	default:
		return errors.New("视频比例不支持")
	}
	if len(input.Images) > 10 {
		return errors.New("最多支持十张参考图")
	}
	return nil
}
