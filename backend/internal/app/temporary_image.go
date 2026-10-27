package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"

	"gorm.io/gorm"
)

type temporaryImageUploader interface {
	temporaryURLValidator
	Upload(context.Context, string, []byte) (outbound.TemporaryImageURL, error)
}

type temporaryURLValidator interface {
	URLAvailable(context.Context, string) (bool, error)
	InvalidateURL(string)
}

func reusableTemporaryURL(ctx context.Context, host temporaryURLValidator, value string, expiresAt *time.Time) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if value == "" {
		return false, nil
	}
	if !outbound.IsUguuURL(value) || expiresAt == nil || !time.Now().Add(outbound.TemporaryURLRefreshMargin).Before(*expiresAt) {
		host.InvalidateURL(value)
		return false, nil
	}
	available, err := host.URLAvailable(ctx, value)
	if err == nil && !available {
		host.InvalidateURL(value)
	}
	return available, err
}

func (s *Service) imageHost() temporaryImageUploader {
	s.temporaryImagesOnce.Do(func() {
		if s.temporaryImages == nil {
			s.temporaryImages = outbound.NewUguuImageHost(nil)
		}
	})
	return s.temporaryImages
}

func (s *Service) ResourceUpstreamURL(ctx context.Context, userID string, id string) (string, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", NotFound("资源不存在")
	}
	if err != nil {
		return "", err
	}
	if !s.IsLocalMode() || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("参考素材必须是已保存的本地资源")
	}
	if publicURL, err := s.signedHTTPSPublicResourceURL(resource, time.Now().Add(providerResourceURLTTL)); err == nil {
		return publicURL, nil
	}
	if !resourceLooksLikeImage(resource, nil) {
		if strings.HasPrefix(resource.MimeType, "video/") || strings.HasPrefix(resource.MimeType, "audio/") {
			return s.uploadTemporaryResourceMedia(ctx, userID, resource)
		}
		return "", BadAuthRequest("临时图床仅支持图片、视频或音频")
	}
	return s.uploadTemporaryResourceImage(ctx, userID, resource)
}

// ResourceTemporaryImageURL explicitly prepares the owned image for manual
// inspection or copying. It intentionally bypasses CANVAS_PUBLIC_BASE_URL so
// the button always means "upload to Uguu".
func (s *Service) ResourceTemporaryImageURL(ctx context.Context, userID string, id string) (string, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", NotFound("资源不存在")
	}
	if err != nil {
		return "", err
	}
	if !s.IsLocalMode() || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("参考素材必须是已保存的本地资源")
	}
	if !resourceLooksLikeImage(resource, nil) {
		return "", BadAuthRequest("只有图片资源可以上传到 Uguu 临时图床")
	}
	return s.uploadTemporaryResourceImage(ctx, userID, resource)
}

func (s *Service) uploadTemporaryResourceImage(ctx context.Context, userID string, resource *model.Resource) (string, error) {
	host := s.imageHost()
	if available, err := reusableTemporaryURL(ctx, host, resource.TemporaryImageURL, resource.TemporaryImageExpiresAt); err != nil {
		return "", err
	} else if available {
		return resource.TemporaryImageURL, nil
	}
	if resource.Size > outbound.MaxTemporaryImageBytes {
		return "", BadAuthRequest("Uguu 参考图片不能超过 30MB")
	}
	_, body, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return "", fmt.Errorf("读取本地参考图片失败：%w", err)
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, outbound.MaxTemporaryImageBytes+1))
	if err != nil {
		return "", fmt.Errorf("读取本地参考图片失败：%w", err)
	}
	upload, err := host.Upload(ctx, userID, data)
	if err != nil {
		return "", err
	}
	if err := s.repo.SaveResourceTemporaryImageURL(userID, resource.ID, upload.URL, upload.UploadedAt, upload.ExpiresAt); err != nil {
		return "", fmt.Errorf("保存临时图片链接失败：%w", err)
	}
	return upload.URL, nil
}

func (s *Service) uploadTemporaryResourceMedia(ctx context.Context, userID string, resource *model.Resource) (string, error) {
	host := s.mediaHost()
	if available, err := reusableTemporaryURL(ctx, host, resource.TemporaryMediaURL, resource.TemporaryMediaExpiresAt); err != nil {
		return "", err
	} else if available {
		return resource.TemporaryMediaURL, nil
	}
	if resource.Size > outbound.MaxTemporaryMediaBytes {
		return "", BadAuthRequest("Uguu 单个视频或音频不能超过 128 MiB，请压缩后重试")
	}
	_, body, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return "", err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, outbound.MaxTemporaryMediaBytes+1))
	if err != nil {
		return "", err
	}
	upload, err := host.UploadMedia(ctx, userID, data, resource.MimeType)
	if err != nil {
		return "", err
	}
	if err := s.repo.SaveResourceTemporaryMediaURL(userID, resource.ID, upload.URL, upload.UploadedAt, upload.ExpiresAt); err != nil {
		return "", err
	}
	return upload.URL, nil
}

func (s *Service) uploadTemporaryInlineImage(ctx context.Context, userID string, media *providerMedia) error {
	data, mimeType, err := mediaBytes(*media)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(mimeType, "image/") {
		return errors.New("Uguu 自动图床仅接受图片文件")
	}
	upload, err := s.imageHost().Upload(ctx, userID, data)
	if err != nil {
		return err
	}
	media.URL, media.DataURL, media.MimeType, media.Bytes = upload.URL, "", mimeType, int64(len(data))
	return nil
}

func (s *Service) uploadTemporaryInlineMedia(ctx context.Context, userID string, media *providerMedia) error {
	data, mimeType, err := mediaBytes(*media)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(mimeType, "video/") && !strings.HasPrefix(mimeType, "audio/") {
		return errors.New("Uguu 临时图床仅接受视频或音频文件")
	}
	upload, err := s.mediaHost().UploadMedia(ctx, userID, data, mimeType)
	if err != nil {
		return err
	}
	media.URL, media.DataURL, media.MimeType, media.Bytes = upload.URL, "", mimeType, int64(len(data))
	return nil
}
