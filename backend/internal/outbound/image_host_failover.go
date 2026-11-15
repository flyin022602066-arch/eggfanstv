package outbound

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"
	"time"
)

type temporaryImageHost interface {
	Upload(context.Context, string, []byte) (TemporaryImageURL, error)
	URLAvailable(context.Context, string) (bool, error)
	InvalidateURL(string)
}

type ImageFailoverHost struct {
	primary temporaryImageHost
	backups []temporaryImageHost
	mu      sync.Mutex
	uploads map[string]*temporaryImageUpload
}

func NewImageFailoverHost(primary temporaryImageHost, backups ...temporaryImageHost) *ImageFailoverHost {
	return &ImageFailoverHost{primary: primary, backups: backups, uploads: make(map[string]*temporaryImageUpload)}
}

func (host *ImageFailoverHost) AcceptsURL(address string) bool {
	return host.hostForURL(address) != nil
}

func (host *ImageFailoverHost) hostForURL(address string) temporaryImageHost {
	if IsUguuURL(address) {
		return host.primary
	}
	if !IsBackupImageURL(address) {
		return nil
	}
	for _, backup := range host.backups {
		if validator, ok := backup.(interface{ AcceptsURL(string) bool }); ok {
			if validator.AcceptsURL(address) {
				return backup
			}
		} else {
			return backup
		}
	}
	return nil
}

func (host *ImageFailoverHost) Upload(ctx context.Context, scope string, data []byte) (TemporaryImageURL, error) {
	if err := ctx.Err(); err != nil {
		return TemporaryImageURL{}, err
	}
	key := fmt.Sprintf("%s:%x", scope, sha256.Sum256(data))
	host.mu.Lock()
	if cached := host.uploads[key]; cached != nil && (cached.expiresAt.IsZero() || time.Now().Before(cached.expiresAt)) {
		host.mu.Unlock()
		select {
		case <-ctx.Done():
			return TemporaryImageURL{}, ctx.Err()
		case <-cached.done:
			if cached.err != nil {
				return TemporaryImageURL{}, cached.err
			}
			if time.Now().Add(TemporaryURLRefreshMargin).Before(cached.result.ExpiresAt) {
				ready, err := host.URLAvailable(ctx, cached.result.URL)
				if err != nil {
					return TemporaryImageURL{}, err
				}
				if ready {
					return cached.result, nil
				}
			}
			host.InvalidateURL(cached.result.URL)
			return host.Upload(ctx, scope, data)
		}
	}
	for cacheKey, cached := range host.uploads {
		if !cached.expiresAt.IsZero() && time.Now().After(cached.expiresAt) {
			delete(host.uploads, cacheKey)
		}
	}
	upload := &temporaryImageUpload{done: make(chan struct{})}
	host.uploads[key] = upload
	host.mu.Unlock()
	result, err := host.upload(ctx, scope, data)
	host.mu.Lock()
	upload.result, upload.err, upload.expiresAt = result, err, time.Now().Add(20*time.Minute)
	if err != nil {
		delete(host.uploads, key)
	}
	close(upload.done)
	host.mu.Unlock()
	return result, err
}

func (host *ImageFailoverHost) upload(ctx context.Context, scope string, data []byte) (TemporaryImageURL, error) {
	primaryCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	result, primaryErr := host.primary.Upload(primaryCtx, scope, data)
	cancel()
	if err := ctx.Err(); err != nil {
		return TemporaryImageURL{}, err
	}
	if primaryErr == nil || !retryableTemporaryUpload(primaryErr) {
		return result, primaryErr
	}
	failures := []string{primaryErr.Error()}
	for _, backup := range host.backups {
		backupCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		result, err := backup.Upload(backupCtx, scope, data)
		cancel()
		if ctx.Err() != nil {
			return TemporaryImageURL{}, ctx.Err()
		}
		if err == nil {
			return result, nil
		}
		failures = append(failures, err.Error())
	}
	return TemporaryImageURL{}, fmt.Errorf("参考图片图床上传失败，视频请求尚未发送：%s", strings.Join(failures, "；"))
}

func (host *ImageFailoverHost) URLAvailable(ctx context.Context, address string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	source := host.hostForURL(address)
	if source == nil {
		return false, nil
	}
	available, err := source.URLAvailable(ctx, address)
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	if err != nil && retryableTemporaryUpload(err) {
		return false, nil
	}
	return available, err
}

func (host *ImageFailoverHost) InvalidateURL(address string) {
	host.mu.Lock()
	for key, cached := range host.uploads {
		select {
		case <-cached.done:
			if cached.result.URL == address {
				delete(host.uploads, key)
			}
		default:
		}
	}
	host.mu.Unlock()
	if source := host.hostForURL(address); source != nil {
		source.InvalidateURL(address)
	}
}
