package doubaobrowser

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type stagedImage struct {
	File   string `json:"file"`
	MIME   string `json:"mime"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type stagedSubmission struct {
	TaskID   string        `json:"taskId"`
	Model    string        `json:"model"`
	Prompt   string        `json:"prompt"`
	Duration int           `json:"duration"`
	Ratio    string        `json:"ratio"`
	Images   []stagedImage `json:"images"`
}

func (s *Service) ownerDirectory(userID string) string {
	return filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(userID))))
}
func (s *Service) prepareSubmission(userID string, input Request) (stagedSubmission, func(), error) {
	wire := stagedSubmission{TaskID: input.TaskID, Model: input.Model, Prompt: input.Prompt, Duration: input.Duration, Ratio: input.Ratio, Images: []stagedImage{}}
	cleanup := func() {}
	if strings.TrimSpace(userID) == "" {
		return wire, cleanup, errors.New("缺少工作区身份")
	}
	if err := Validate(input); err != nil {
		return wire, cleanup, err
	}
	if len(input.Images) == 0 {
		return wire, cleanup, nil
	}
	owner, err := filepath.Abs(s.ownerDirectory(userID))
	if err != nil {
		return wire, cleanup, err
	}
	if err := os.MkdirAll(owner, 0700); err != nil {
		return wire, cleanup, err
	}
	directory, err := os.MkdirTemp(owner, ".submit-")
	if err != nil {
		return wire, cleanup, err
	}
	cleanup = func() { _ = os.RemoveAll(directory) }
	for index, image := range input.Images {
		header, encoded, found := strings.Cut(image, ",")
		mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		extension := map[string]string{"image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp"}[mime]
		if !found || extension == "" || header != "data:"+mime+";base64" {
			cleanup()
			return wire, func() {}, errors.New("参考图须为 PNG/JPEG/WebP")
		}
		name := fmt.Sprintf("%d.%s", index, extension)
		file, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			cleanup()
			return wire, func() {}, err
		}
		hash := sha256.New()
		size, copyErr := io.Copy(io.MultiWriter(file, hash), base64.NewDecoder(base64.StdEncoding, strings.NewReader(encoded)))
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil || size == 0 {
			cleanup()
			return wire, func() {}, errors.New("参考图暂存失败或数据无效")
		}
		wire.Images = append(wire.Images, stagedImage{File: filepath.ToSlash(filepath.Join(filepath.Base(directory), name)), MIME: mime, Bytes: size, SHA256: fmt.Sprintf("%x", hash.Sum(nil))})
	}
	return wire, cleanup, nil
}

type workerDiagnostics struct {
	mu       sync.Mutex
	tail     string
	category string
}

func (d *workerDiagnostics) Write(body []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	text := d.tail + string(body)
	switch {
	case strings.Contains(text, "heap out of memory"), strings.Contains(text, "Reached heap limit"):
		d.category = "Node 内存不足"
	case d.category == "" && strings.Contains(text, "ECONNRESET"):
		d.category = "浏览器管道连接被重置（ECONNRESET）"
	case d.category == "" && strings.Contains(text, "EPIPE"):
		d.category = "浏览器管道写入中断（EPIPE）"
	case d.category == "" && strings.Contains(text, "Unhandled 'error' event"):
		d.category = "浏览器工作进程遇到未处理的管道错误"
	}
	if len(text) > 256 {
		text = text[len(text)-256:]
	}
	d.tail = text
	return len(body), nil
}
func (d *workerDiagnostics) reason() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.category
}
func defaultWorkerExit(reason string) string {
	if reason == "" {
		reason = "浏览器运行层已退出"
	}
	return reason + "，提交结果可能未确认；正在按原任务回执核对"
}
