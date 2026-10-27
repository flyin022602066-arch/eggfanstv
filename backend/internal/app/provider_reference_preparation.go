package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
)

type videoReferencePreparationError struct {
	Cause error
	Kind  string
	Index int
	Total int
}

func (err videoReferencePreparationError) Error() string {
	return fmt.Sprintf("准备%s %d/%d 失败：%v", err.Kind, err.Index, err.Total, err.Cause)
}

func (err videoReferencePreparationError) Unwrap() error { return err.Cause }

func (err videoReferencePreparationError) failure() generation.Failure {
	failure := classifyTaskFailure(err.Cause)
	if failure.Category != generation.CategoryNetwork && failure.Category != generation.CategoryTimeout && failure.Category != generation.CategoryUnknown {
		return failure
	}
	label := "失败"
	var networkErr net.Error
	if errors.Is(err.Cause, context.DeadlineExceeded) || errors.As(err.Cause, &networkErr) && networkErr.Timeout() {
		label = "超时"
	}
	return generation.Failure{
		Category: generation.CategoryInputInaccessible,
		Reason:   fmt.Sprintf("%s %d/%d 准备%s，视频请求尚未发送", err.Kind, err.Index, err.Total, label),
		Action:   "请检查 Uguu 图床连接或本地素材后重试",
	}
}

func (s *Service) noteVideoReferencePreparation(ctx context.Context, stage string) error {
	runtime, ok := generation.RuntimeFromContext(ctx)
	if !ok || runtime.Stages == nil {
		return nil
	}
	if err := runtime.Stages.SetStage(ctx, stage); err != nil {
		return fmt.Errorf("更新素材准备进度失败，视频请求尚未发送：%w", err)
	}
	return nil
}

type appReferencePreparationPort struct{ service *Service }

func (s *Service) bindCustomGenerationReferences(ctx context.Context) context.Context {
	runtime, _ := generation.RuntimeFromContext(ctx)
	runtime.References = appReferencePreparationPort{service: s}
	return generation.WithRuntime(ctx, runtime)
}

func (p appReferencePreparationPort) Prepare(ctx context.Context, userID string, input *generation.Input) (bool, error) {
	if p.service == nil || input == nil || input.Mode != "video" {
		return false, nil
	}
	switch {
	case input.Config.InterfaceType == "mints-seedance-video":
		return true, p.service.prepareMintsAssetReferences(ctx, userID, input)
	case isEggfansSeedanceProtocol(input.Config.InterfaceType):
		return true, p.service.prepareEggfansPrivateAssetReferences(ctx, userID, input)
	default:
		return false, nil
	}
}

func (p appReferencePreparationPort) CompressJiasu(ctx context.Context, userID string, input *generation.Input) (bool, error) {
	if p.service == nil {
		return false, errors.New("佳速参考素材压缩端口未接入")
	}
	return p.service.prepareJiasuVideoReferenceImages(ctx, userID, input, true)
}

func (p appReferencePreparationPort) Upload(ctx context.Context, userID string, media *generation.Media) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.service == nil || media == nil {
		return errors.New("参考素材上传端口未接入")
	}
	if strings.HasPrefix(media.StorageKey, "resource:") {
		resource, err := p.service.Resource(userID, strings.TrimPrefix(media.StorageKey, "resource:"))
		if err != nil {
			return err
		}
		if resource.Status != model.ResourceStatusReady {
			return errors.New("任务参考资源尚未上传完成")
		}
		var publicURL string
		if resourceLooksLikeImage(resource, media) {
			publicURL, err = p.service.uploadTemporaryResourceImage(ctx, userID, resource)
		} else {
			publicURL, err = p.service.uploadTemporaryResourceMedia(ctx, userID, resource)
		}
		if err != nil {
			return err
		}
		media.URL, media.DataURL, media.MimeType, media.Bytes = publicURL, "", resource.MimeType, resource.Size
		media.Width, media.Height, media.DurationMs = resource.Width, resource.Height, resource.DurationMs
		return nil
	}
	if strings.HasPrefix(firstNonEmpty(media.DataURL, media.URL), "data:") {
		if strings.HasPrefix(firstNonEmpty(media.MimeType, media.Type, media.DataURL, media.URL), "image/") || strings.HasPrefix(firstNonEmpty(media.DataURL, media.URL), "data:image/") {
			return p.service.uploadTemporaryInlineImage(ctx, userID, media)
		}
		return p.service.uploadTemporaryInlineMedia(ctx, userID, media)
	}
	if !isPublicMediaURL(media.URL) {
		return BadAuthRequest("当前渠道只接受公网 URL，请连接原始本地素材重新准备")
	}
	if outbound.IsUguuURL(media.URL) {
		host := p.service.imageHost()
		available, err := host.URLAvailable(ctx, media.URL)
		if err != nil {
			return err
		}
		if !available {
			host.InvalidateURL(media.URL)
			return BadAuthRequest("Uguu 参考链接已失效，当前素材没有可读取的本地原始文件，请重新上传原始素材后再生成")
		}
	}
	return nil
}
