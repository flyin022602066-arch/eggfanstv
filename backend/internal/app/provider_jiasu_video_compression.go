package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"infinite-canvas/backend/internal/outbound"
)

const jiasuReferencePrecompressAggregateThreshold = 64 << 20
const jiasuReferencePrecompressImageThreshold = 15 << 20
const jiasuReferencePrecompressMinimumImageBytes = 8 << 20
const jiasuReferenceMaxDimension = 2048
const jiasuReferenceMinimumDimension = 1024
const jiasuReferenceMinimumTargetBytes = 8 << 20
const jiasuReferenceMaximumTargetBytes = 14 << 20
const maxJiasuImageSourceBytes = 256 << 20

func (s *Service) prepareJiasuVideoReferenceImages(ctx context.Context, userID string, input *canvasGenerationInput, force bool) (bool, error) {
	if input == nil || input.Mode != "video" || input.Config.InterfaceType != "jiasu-video" || len(input.ReferenceImages) == 0 {
		return false, nil
	}
	if !force && !jiasuVideoReferencesNeedPrecompression(*input) {
		return false, nil
	}
	changed := false
	for index := range input.ReferenceImages {
		if err := ctx.Err(); err != nil {
			return changed, err
		}
		media := &input.ReferenceImages[index]
		if media.Bytes > 0 && media.Bytes <= jiasuReferencePrecompressMinimumImageBytes {
			continue
		}
		data, mimeType, err := s.jiasuReferenceImageBytes(ctx, userID, input.Config, *media)
		if err != nil {
			continue
		}
		if len(data) <= jiasuReferencePrecompressMinimumImageBytes {
			continue
		}
		compressed, compressedMIME, width, height, err := compressJiasuReferenceImage(data, mimeType)
		if err != nil || len(compressed) >= len(data) {
			continue
		}
		upload, err := s.imageHost().Upload(ctx, userID, compressed)
		if err != nil {
			if ctx.Err() != nil {
				return changed, ctx.Err()
			}
			continue
		}
		media.URL = upload.URL
		media.DataURL = ""
		media.StorageKey = ""
		media.MimeType = compressedMIME
		media.Bytes = int64(len(compressed))
		media.Width = width
		media.Height = height
		changed = true
	}
	return changed, nil
}

func jiasuVideoReferencesNeedPrecompression(input canvasGenerationInput) bool {
	var total int64
	for _, group := range [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios} {
		for _, media := range group {
			if media.Bytes > 0 {
				total += media.Bytes
			}
		}
	}
	if total > jiasuReferencePrecompressAggregateThreshold {
		return true
	}
	for _, media := range input.ReferenceImages {
		if media.Bytes > jiasuReferencePrecompressImageThreshold || media.Bytes > outbound.MaxTemporaryImageBytes {
			return true
		}
	}
	return false
}

func (s *Service) jiasuReferenceImageBytes(ctx context.Context, userID string, config providerConfig, media providerMedia) ([]byte, string, error) {
	if strings.HasPrefix(media.StorageKey, "resource:") {
		resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
		resource, body, err := s.OpenResource(userID, resourceID)
		if err != nil {
			return nil, "", err
		}
		defer body.Close()
		data, err := io.ReadAll(io.LimitReader(body, maxJiasuImageSourceBytes+1))
		if err != nil {
			return nil, "", err
		}
		if len(data) > maxJiasuImageSourceBytes {
			return nil, "", errors.New("佳速参考图超过本地预处理读取范围")
		}
		return data, normalizedMediaMimeType(resource.MimeType, data), nil
	}
	if strings.HasPrefix(media.DataURL, "data:") || strings.HasPrefix(media.URL, "data:") {
		return mediaBytes(media)
	}
	if !isPublicMediaURL(strings.TrimSpace(media.URL)) {
		return nil, "", errors.New("佳速参考图不是可读取的公网图片链接")
	}
	data, mimeType, err := getProviderExternalBinary(ctx, config, media.URL)
	if err != nil {
		return nil, "", err
	}
	return data, normalizedMediaMimeType(firstNonEmpty(media.MimeType, mimeType), data), nil
}

func compressJiasuReferenceImage(data []byte, declaredMIME string) ([]byte, string, int, int, error) {
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, err
	}
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	if width <= 0 || height <= 0 {
		return nil, "", 0, 0, errors.New("参考图片尺寸无效")
	}
	targetBytes := jiasuReferenceCompressionTargetBytes(len(data))
	transparent := imageHasTransparency(source)
	best := data
	bestMIME := normalizedMediaMimeType(declaredMIME, data)
	bestWidth, bestHeight := width, height
	current := source
	if max(width, height) > jiasuReferenceMaxDimension {
		scale := float64(jiasuReferenceMaxDimension) / float64(max(width, height))
		current = resizeJiasuReferenceImage(source, max(128, int(float64(width)*scale)), max(128, int(float64(height)*scale)))
	}
	for attempt := 0; attempt < 24; attempt++ {
		var encoded []byte
		var outputMIME string
		if transparent {
			var buffer bytes.Buffer
			if err := png.Encode(&buffer, current); err != nil {
				return nil, "", 0, 0, err
			}
			encoded, outputMIME = buffer.Bytes(), "image/png"
		} else {
			for _, quality := range []int{88, 82, 76, 70, 64} {
				var buffer bytes.Buffer
				if err := jpeg.Encode(&buffer, current, &jpeg.Options{Quality: quality}); err != nil {
					return nil, "", 0, 0, err
				}
				encoded = buffer.Bytes()
				outputMIME = "image/jpeg"
				if len(encoded) < len(best) {
					best, bestMIME = encoded, outputMIME
					bestWidth, bestHeight = current.Bounds().Dx(), current.Bounds().Dy()
				}
				if len(encoded) <= targetBytes && len(encoded) < len(data) {
					return encoded, outputMIME, current.Bounds().Dx(), current.Bounds().Dy(), nil
				}
			}
		}
		if transparent && len(encoded) < len(best) {
			best, bestMIME = encoded, outputMIME
			bestWidth, bestHeight = current.Bounds().Dx(), current.Bounds().Dy()
		}
		if len(encoded) <= targetBytes && len(encoded) < len(data) {
			return encoded, outputMIME, current.Bounds().Dx(), current.Bounds().Dy(), nil
		}
		if max(current.Bounds().Dx(), current.Bounds().Dy()) <= jiasuReferenceMinimumDimension {
			break
		}
		newWidth := max(1, current.Bounds().Dx()*85/100)
		newHeight := max(1, current.Bounds().Dy()*85/100)
		if max(newWidth, newHeight) < jiasuReferenceMinimumDimension {
			scale := float64(jiasuReferenceMinimumDimension) / float64(max(current.Bounds().Dx(), current.Bounds().Dy()))
			newWidth = max(1, int(float64(current.Bounds().Dx())*scale))
			newHeight = max(1, int(float64(current.Bounds().Dy())*scale))
		}
		current = resizeJiasuReferenceImage(source, newWidth, newHeight)
	}
	if len(best) >= len(data) {
		return data, bestMIME, width, height, nil
	}
	return best, bestMIME, bestWidth, bestHeight, nil
}

func jiasuReferenceCompressionTargetBytes(sourceBytes int) int {
	target := sourceBytes * 3 / 4
	if target < jiasuReferenceMinimumTargetBytes {
		target = jiasuReferenceMinimumTargetBytes
	}
	if target > jiasuReferenceMaximumTargetBytes {
		target = jiasuReferenceMaximumTargetBytes
	}
	return target
}

func imageHasTransparency(source image.Image) bool {
	bounds := source.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha < 0xffff {
				return true
			}
		}
	}
	return false
}

func resizeJiasuReferenceImage(source image.Image, width, height int) *image.NRGBA {
	resized := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(resized, resized.Bounds(), source, source.Bounds(), draw.Over, nil)
	return resized
}

func isJiasuReferenceSizeRejection(err error) bool {
	if err == nil {
		return false
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		if httpErr.StatusCode == 413 {
			return true
		}
		if httpErr.StatusCode != 400 && httpErr.StatusCode != 422 {
			return false
		}
		return isJiasuReferenceSizeMessage(httpErr.Body)
	}
	var payloadErr providerPayloadError
	if errors.As(err, &payloadErr) {
		return isJiasuReferenceSizeMessage(payloadErr.Raw())
	}
	return false
}

func isJiasuReferenceSizeMessage(message string) bool {
	message = strings.ToLower(strings.TrimSpace(message))
	if message == "" {
		return false
	}
	mentionsReference := strings.Contains(message, "reference") || strings.Contains(message, "image") || strings.Contains(message, "素材") || strings.Contains(message, "图片") || strings.Contains(message, "参考")
	mentionsSizeFailure := strings.Contains(message, "size") || strings.Contains(message, "large") || strings.Contains(message, "limit") || strings.Contains(message, "exceed") || strings.Contains(message, "too big") || strings.Contains(message, "too large") || strings.Contains(message, "大小") || strings.Contains(message, "超过") || strings.Contains(message, "超限") || strings.Contains(message, "过大") || strings.Contains(message, "限制")
	return mentionsReference && mentionsSizeFailure
}
