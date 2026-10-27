package outbound

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const MaxTemporaryImageBytes = 30 << 20
const MaxTemporaryMediaBytes = 128 << 20
const TemporaryURLRefreshMargin = 5 * time.Minute
const temporaryUploadTimeout = 15 * time.Minute
const temporaryUploadAttempts = 3

type TemporaryImageURL struct {
	URL        string
	UploadedAt time.Time
	ExpiresAt  time.Time
}

type temporaryImageUpload struct {
	done      chan struct{}
	result    TemporaryImageURL
	err       error
	expiresAt time.Time
}

type UguuImageHost struct {
	client  *http.Client
	mu      sync.Mutex
	uploads map[string]*temporaryImageUpload
}

func NewUguuImageHost(client *http.Client) *UguuImageHost {
	if client == nil {
		client = OutboundHTTPClient(temporaryUploadTimeout)
		client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
			return errors.New("Uguu 上传接口不允许重定向")
		}
	}
	return &UguuImageHost{client: client, uploads: make(map[string]*temporaryImageUpload)}
}

func IsUguuURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.User == nil && parsed.Fragment == "" && parsed.Path != "" && (parsed.Port() == "" || parsed.Port() == "443") && (parsed.Hostname() == "uguu.se" || strings.HasSuffix(parsed.Hostname(), ".uguu.se"))
}

func (host *UguuImageHost) URLAvailable(ctx context.Context, value string) (bool, error) {
	if !IsUguuURL(value) {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, value, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("Range", "bytes=0-0")
	ApplyDefaultOutboundHeaders(request)
	client := *host.client
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return false, fmt.Errorf("检查 Uguu 素材链接失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone || response.StatusCode == http.StatusForbidden || response.StatusCode >= 300 && response.StatusCode < 400 {
		return false, nil
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return false, fmt.Errorf("检查 Uguu 素材链接失败（HTTP %d）", response.StatusCode)
	}
	return !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/html"), nil
}

func (host *UguuImageHost) InvalidateURL(value string) {
	host.mu.Lock()
	defer host.mu.Unlock()
	for key, cached := range host.uploads {
		if cached.result.URL == value {
			delete(host.uploads, key)
		}
	}
}

func (host *UguuImageHost) Upload(ctx context.Context, scope string, data []byte) (TemporaryImageURL, error) {
	if err := ctx.Err(); err != nil {
		return TemporaryImageURL{}, err
	}
	if strings.TrimSpace(scope) == "" {
		return TemporaryImageURL{}, errors.New("图片上传缺少工作区用户")
	}
	if len(data) == 0 || len(data) > MaxTemporaryImageBytes {
		return TemporaryImageURL{}, errors.New("Uguu 参考图片不能为空或超过 30MB")
	}
	mimeType := http.DetectContentType(data)
	if !strings.HasPrefix(mimeType, "image/") {
		return TemporaryImageURL{}, errors.New("Uguu 自动图床仅接受图片文件")
	}
	return host.uploadCached(ctx, scope, data, mimeType)
}

func (host *UguuImageHost) UploadMedia(ctx context.Context, scope string, data []byte, mimeType string) (TemporaryImageURL, error) {
	if err := ctx.Err(); err != nil {
		return TemporaryImageURL{}, err
	}
	if strings.TrimSpace(scope) == "" {
		return TemporaryImageURL{}, errors.New("媒体上传缺少工作区用户")
	}
	if len(data) == 0 || len(data) > MaxTemporaryMediaBytes {
		return TemporaryImageURL{}, errors.New("Uguu 媒体文件不能为空或超过 128 MiB")
	}
	mimeType = strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	if !strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "video/") && !strings.HasPrefix(mimeType, "audio/") {
		return TemporaryImageURL{}, errors.New("Uguu 参考素材必须是图片、视频或音频")
	}
	return host.uploadCached(ctx, scope, data, mimeType)
}

func (host *UguuImageHost) uploadCached(ctx context.Context, scope string, data []byte, mimeType string) (TemporaryImageURL, error) {
	key := fmt.Sprintf("%s:%x", scope, sha256.Sum256(data))
	host.mu.Lock()
	if cached := host.uploads[key]; cached != nil && (cached.expiresAt.IsZero() || time.Now().Before(cached.expiresAt)) {
		host.mu.Unlock()
		select {
		case <-ctx.Done():
			return TemporaryImageURL{}, ctx.Err()
		case <-cached.done:
			if cached.err != nil {
				return cached.result, cached.err
			}
			available := false
			var err error
			if time.Now().Add(TemporaryURLRefreshMargin).Before(cached.result.ExpiresAt) {
				available, err = host.URLAvailable(ctx, cached.result.URL)
			}
			if err != nil {
				return TemporaryImageURL{}, err
			}
			if available {
				return cached.result, nil
			}
			host.InvalidateURL(cached.result.URL)
			return host.uploadCached(ctx, scope, data, mimeType)
		}
	}
	for cacheKey, cached := range host.uploads {
		if !cached.expiresAt.IsZero() && (time.Now().After(cached.expiresAt) || len(host.uploads) >= 128) {
			delete(host.uploads, cacheKey)
		}
	}
	upload := &temporaryImageUpload{done: make(chan struct{})}
	host.uploads[key] = upload
	host.mu.Unlock()
	uploadedAt := time.Now().UTC()
	resultURL, err := host.upload(ctx, data, mimeType)
	host.mu.Lock()
	upload.result = TemporaryImageURL{URL: resultURL, UploadedAt: uploadedAt, ExpiresAt: uploadedAt.Add(3 * time.Hour)}
	upload.err = err
	upload.expiresAt = time.Now().Add(20 * time.Minute)
	if err != nil {
		delete(host.uploads, key)
	}
	close(upload.done)
	host.mu.Unlock()
	return upload.result, err
}

func (host *UguuImageHost) upload(ctx context.Context, data []byte, mimeType string) (string, error) {
	for attempt := 1; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		result, err := host.uploadOnce(ctx, data, mimeType)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if err == nil || attempt >= temporaryUploadAttempts || !retryableTemporaryUpload(err) {
			return result, err
		}
		timer := time.NewTimer(time.Duration(attempt) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
	}
}

type temporaryUploadHTTPError struct {
	status int
}

func (err temporaryUploadHTTPError) Error() string {
	return fmt.Sprintf("Uguu 图片上传失败（HTTP %d），请稍后重试", err.status)
}

func retryableTemporaryUpload(err error) bool {
	if errors.Is(err, context.Canceled) {
		return false
	}
	var httpErr temporaryUploadHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.status == http.StatusRequestTimeout || httpErr.status == http.StatusTooManyRequests || httpErr.status >= 500 && httpErr.status <= 599
	}
	var networkErr net.Error
	var operationErr *net.OpError
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &networkErr) && networkErr.Timeout() || errors.As(err, &operationErr)
}

func (host *UguuImageHost) uploadOnce(ctx context.Context, data []byte, mimeType string) (string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp"}[mimeType]
	if extension == "" {
		extension = map[string]string{"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/webm": ".webm"}[mimeType]
	}
	if extension == "" {
		extension = ".bin"
	}
	part, err := writer.CreateFormFile("files[]", "reference"+extension)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://uguu.se/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	ApplyDefaultOutboundHeaders(req)
	response, err := host.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("Uguu 图片上传失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", temporaryUploadHTTPError{status: response.StatusCode}
	}
	encoded, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		return "", fmt.Errorf("读取 Uguu 上传结果失败：%w", err)
	}
	if len(encoded) > 64<<10 {
		return "", errors.New("Uguu 上传结果过大")
	}
	var payload struct {
		Success bool `json:"success"`
		Files   []struct {
			URL string `json:"url"`
		} `json:"files"`
	}
	if json.Unmarshal(encoded, &payload) != nil || !payload.Success || len(payload.Files) != 1 {
		return "", errors.New("Uguu 未返回有效图片地址，请稍后重试")
	}
	resultURL := strings.TrimSpace(payload.Files[0].URL)
	if !IsUguuURL(resultURL) {
		return "", errors.New("Uguu 返回了无效的 HTTPS 图片地址")
	}
	return resultURL, nil
}
