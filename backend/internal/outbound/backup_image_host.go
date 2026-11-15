package outbound

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type BackupImageHost struct {
	client    *http.Client
	name      string
	endpoint  string
	fileField string
	domain    string
}

func NewPoneImageHost(client *http.Client) *BackupImageHost {
	return newBackupImageHost(client, "Pone", "https://pone.rs/upload", "files[]", "u.pone.rs")
}

func NewLeopardImageHost(client *http.Client) *BackupImageHost {
	return newBackupImageHost(client, "Leopard", "https://leopard.hosting.pecon.us/upload.php", "uploadContent", "leopard.hosting.pecon.us")
}

func newBackupImageHost(client *http.Client, name, endpoint, field, domain string) *BackupImageHost {
	if client == nil {
		client = OutboundHTTPClient(2 * time.Minute)
	}
	isolated := *client
	isolated.Jar = nil
	isolated.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &BackupImageHost{client: &isolated, name: name, endpoint: endpoint, fileField: field, domain: domain}
}

func IsBackupImageURL(address string) bool {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || parsed.Path == "" || parsed.Path == "/" || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	return parsed.Hostname() == "u.pone.rs" || parsed.Hostname() == "leopard.hosting.pecon.us" && strings.HasPrefix(parsed.Path, "/dl/") && len(strings.Split(strings.Trim(parsed.Path, "/"), "/")) >= 3
}

func (host *BackupImageHost) AcceptsURL(address string) bool {
	parsed, err := url.Parse(address)
	return err == nil && parsed.Hostname() == host.domain && IsBackupImageURL(address)
}

func (host *BackupImageHost) Upload(ctx context.Context, scope string, data []byte) (TemporaryImageURL, error) {
	if err := ctx.Err(); err != nil {
		return TemporaryImageURL{}, err
	}
	if strings.TrimSpace(scope) == "" {
		return TemporaryImageURL{}, errors.New("备用图片上传缺少工作区用户")
	}
	if len(data) == 0 || len(data) > MaxTemporaryImageBytes {
		return TemporaryImageURL{}, errors.New("备用参考图片不能为空或超过 30MB")
	}
	extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp"}[http.DetectContentType(data)]
	if extension == "" {
		return TemporaryImageURL{}, errors.New("备用图床仅接受图片文件")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile(host.fileField, "reference"+extension)
	if err != nil {
		return TemporaryImageURL{}, err
	}
	if _, err := part.Write(data); err != nil {
		return TemporaryImageURL{}, err
	}
	if host.name == "Leopard" {
		for _, field := range [][2]string{{"password", ""}, {"public", "no"}, {"showname", "yes"}, {"json", "true"}} {
			if err := writer.WriteField(field[0], field[1]); err != nil {
				return TemporaryImageURL{}, err
			}
		}
	}
	if err := writer.Close(); err != nil {
		return TemporaryImageURL{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint, &body)
	if err != nil {
		return TemporaryImageURL{}, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	ApplyDefaultOutboundHeaders(request)
	response, err := host.client.Do(request)
	if err != nil {
		return TemporaryImageURL{}, fmt.Errorf("%s 图片上传连接失败：%w", host.name, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return TemporaryImageURL{}, fmt.Errorf("%s 图片上传失败（HTTP %d）", host.name, response.StatusCode)
	}
	encoded, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		return TemporaryImageURL{}, fmt.Errorf("%s 上传响应读取失败：%w", host.name, err)
	}
	var payload struct {
		Success bool `json:"success"`
		Files   []struct {
			URL string `json:"url"`
		} `json:"files"`
		Upload struct {
			DownloadURL string `json:"downloadURL"`
		} `json:"upload"`
	}
	if len(encoded) > 64<<10 || json.Unmarshal(encoded, &payload) != nil {
		return TemporaryImageURL{}, fmt.Errorf("%s 未返回有效上传结果", host.name)
	}
	address := strings.TrimSpace(payload.Upload.DownloadURL)
	if host.name == "Pone" {
		if !payload.Success || len(payload.Files) != 1 {
			return TemporaryImageURL{}, fmt.Errorf("%s 未返回有效图片地址", host.name)
		}
		address = strings.TrimSpace(payload.Files[0].URL)
	}
	if !host.AcceptsURL(address) {
		return TemporaryImageURL{}, fmt.Errorf("%s 未返回有效 HTTPS 原图直链", host.name)
	}
	ready, err := host.URLAvailable(ctx, address)
	if err != nil {
		return TemporaryImageURL{}, err
	}
	if !ready {
		return TemporaryImageURL{}, fmt.Errorf("%s 返回的链接不可读取或不是原图", host.name)
	}
	uploadedAt := time.Now().UTC()
	return TemporaryImageURL{URL: address, UploadedAt: uploadedAt, ExpiresAt: uploadedAt.Add(24 * time.Hour)}, nil
}

func (host *BackupImageHost) URLAvailable(ctx context.Context, address string) (bool, error) {
	if !host.AcceptsURL(address) {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("Range", "bytes=0-511")
	ApplyDefaultOutboundHeaders(request)
	response, err := host.client.Do(request)
	if err != nil {
		return false, fmt.Errorf("%s 原图链接检查失败：%w", host.name, err)
	}
	if response.StatusCode == http.StatusRequestedRangeNotSatisfiable {
		response.Body.Close()
		request.Header.Del("Range")
		response, err = host.client.Do(request)
		if err != nil {
			return false, fmt.Errorf("%s 原图链接检查失败：%w", host.name, err)
		}
	}
	defer response.Body.Close()
	if response.StatusCode >= 500 || response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusRequestTimeout {
		return false, temporaryUploadHTTPError{status: response.StatusCode, host: host.name}
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return false, nil
	}
	prefix, err := io.ReadAll(io.LimitReader(response.Body, 512))
	if err != nil {
		return false, fmt.Errorf("%s 原图校验读取失败：%w", host.name, err)
	}
	return strings.HasPrefix(http.DetectContentType(prefix), "image/"), nil
}

func (host *BackupImageHost) InvalidateURL(string) {}
