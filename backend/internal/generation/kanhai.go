package generation

import (
	"fmt"
	"mime"
	"net/url"
	"path"

	"infinite-canvas/backend/internal/protocol"
)

func kanhaiReferenceFiles(request protocol.GenerationRequest) ([]any, error) {
	files := []any{}
	for index, media := range request.Inputs {
		mediaType, _, _ := mime.ParseMediaType(media.MIMEType)
		extensions := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav"}
		extension := extensions[mediaType]
		if extension == "" {
			parsed, _ := url.Parse(media.URL)
			if parsed != nil {
				extension = path.Ext(parsed.Path)
			}
			if extension == "" {
				extension = path.Ext(media.Name)
			}
		}
		if extension == "" {
			return nil, fmt.Errorf("看海参考素材 %d 缺少实际格式，请重新上传素材", index+1)
		}
		file := map[string]any{"name": fmt.Sprintf("reference-%d%s", index+1, extension)}
		if media.URL != "" {
			file["url"] = media.URL
		} else {
			file["data"] = media.DataURL
		}
		if media.Kind == "video" || media.Kind == "audio" {
			duration := kanhaiMediaDurationMs(media.Metadata["durationMs"]) / 1000
			if duration <= 0 {
				return nil, fmt.Errorf("看海参考%s %d 缺少真实时长，请重新上传素材", media.Kind, index+1)
			}
			file["seconds"] = duration
		}
		files = append(files, file)
	}
	return files, nil
}

func kanhaiMediaDurationMs(value any) float64 {
	switch number := value.(type) {
	case float64:
		return number
	case int:
		return float64(number)
	case int64:
		return float64(number)
	default:
		return 0
	}
}
