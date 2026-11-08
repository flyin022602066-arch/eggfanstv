package asset

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
)

type SunoMediaRequest struct {
	Identity   string `json:"-"`
	URL        string `json:"url"`
	ClipID     string `json:"clipId"`
	Kind       string `json:"kind"`
	DurationMs int64  `json:"durationMs"`
}

func (s *Service) RetrieveSunoMedia(ctx context.Context, userID string, input SunoMediaRequest, maxBytes int64) (*model.Resource, error) {
	input.ClipID = strings.TrimSpace(input.ClipID)
	input.Identity = strings.TrimSpace(input.Identity)
	if strings.TrimSpace(userID) == "" || input.Identity == "" || len(input.Identity) > 512 || input.ClipID == "" || len(input.ClipID) > 256 || input.DurationMs < 0 || maxBytes <= 0 {
		return nil, kernel.BadAuthRequest("歌曲取回参数不完整")
	}
	if input.Kind != "audio" && input.Kind != "video" {
		return nil, kernel.BadAuthRequest("歌曲取回只支持音频或歌曲视频")
	}
	if len(input.URL) > 8192 {
		return nil, kernel.BadAuthRequest("歌曲媒体地址无效")
	}
	var file *os.File
	defer func() {
		if file != nil {
			name := file.Name()
			_ = file.Close()
			_ = os.Remove(name)
		}
	}()
	return s.RecoverOwned(userID, "suno-media:"+input.Identity+":"+input.Kind+":"+input.ClipID, func() (RecoveredArtifact, error) {
		parsed, err := outbound.ValidateOutboundURL(input.URL)
		if err != nil {
			return RecoveredArtifact{}, kernel.BadAuthRequest("歌曲媒体地址不安全或不可访问，请重新查询原任务")
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return RecoveredArtifact{}, kernel.BadAuthRequest("歌曲媒体地址无效")
		}
		outbound.ApplyDefaultOutboundHeaders(request)
		response, err := outbound.OutboundHTTPClient(3 * time.Minute).Do(request)
		if err != nil {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusBadGateway, "歌曲已生成，但媒体下载未完成，请重试取回原结果；未重新生成")
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusBadGateway, fmt.Sprintf("歌曲媒体下载返回 HTTP %d，请重新查询原任务获取有效链接", response.StatusCode))
		}
		if response.ContentLength > maxBytes {
			return RecoveredArtifact{}, kernel.BadAuthRequest("歌曲媒体超过单个生成文件大小限制")
		}
		file, err = os.CreateTemp("", "eggfans-suno-media-*")
		if err != nil {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusInternalServerError, "无法创建歌曲下载临时文件，请检查磁盘空间和权限")
		}
		size, err := io.Copy(file, io.LimitReader(response.Body, maxBytes+1))
		if err != nil {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusBadGateway, "歌曲媒体下载中断，请重试取回原结果")
		}
		if size == 0 || size > maxBytes {
			return RecoveredArtifact{}, kernel.BadAuthRequest("歌曲媒体为空或超过单个生成文件大小限制")
		}
		if response.ContentLength > 0 && size != response.ContentLength {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusBadGateway, "歌曲媒体下载不完整，请重试取回原结果")
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return RecoveredArtifact{}, err
		}
		header := make([]byte, 512)
		count, _ := file.Read(header)
		mimeType := sunoMediaMime(input.Kind, header[:count], response.Header.Get("Content-Type"))
		if mimeType == "" {
			return RecoveredArtifact{}, kernel.NewAppError(http.StatusBadGateway, "歌曲地址未返回有效媒体文件，请重新查询原任务；未把错误页面保存为歌曲")
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return RecoveredArtifact{}, err
		}
		return RecoveredArtifact{Kind: input.Kind, FileName: "suno." + ExtensionFromMimeType(mimeType), MimeType: mimeType, Size: size, DurationMs: input.DurationMs, Body: file}, nil
	})
}

func sunoMediaMime(kind string, data []byte, declared string) string {
	detected := http.DetectContentType(data)
	if kind == "video" {
		if detected == "video/mp4" || detected == "video/webm" {
			return detected
		}
		return ""
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE")) {
		return "audio/wav"
	}
	if bytes.HasPrefix(data, []byte("ID3")) || len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0 {
		return "audio/mpeg"
	}
	if bytes.HasPrefix(data, []byte("OggS")) {
		return "audio/ogg"
	}
	if bytes.HasPrefix(data, []byte("fLaC")) {
		return "audio/flac"
	}
	if detected == "video/mp4" && strings.HasPrefix(strings.ToLower(declared), "audio/mp4") {
		return "audio/mp4"
	}
	return ""
}
