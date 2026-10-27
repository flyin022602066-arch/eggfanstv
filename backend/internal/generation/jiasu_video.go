package generation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/protocol"
)

const JiasuVideoTaskTimeout = 120 * time.Minute
const JiasuVideoPollInterval = 3 * time.Second

var jiasuReferenceToken = regexp.MustCompile(`@(图片|视频|音频)([1-9][0-9]*)`)
var sdVideoVersionPattern = regexp.MustCompile(`(?:sd|seedance)[-_]?2[._-]([05])(?:[^0-9]|$)`)

func sdVideoImageReferenceLimit(_ string, modelName string) (int, bool) {
	version := sdVideoVersionPattern.FindStringSubmatch(strings.ToLower(strings.TrimSpace(modelName)))
	if len(version) < 2 {
		return 0, false
	}
	if version[1] == "5" {
		return 30, true
	}
	return 10, true
}

func JiasuModelSupportsServerFace(modelName string) bool {
	return !strings.EqualFold(strings.TrimSpace(modelName), "sd-2.5-j2-V")
}

func ApplyJiasuReferenceNames(request *protocol.GenerationRequest) {
	groups := map[string][]protocol.MediaReference{"图片": request.Images, "视频": request.Videos, "音频": request.Audios}
	for _, match := range jiasuReferenceToken.FindAllStringSubmatch(request.Prompt, -1) {
		index, err := strconv.Atoi(match[2])
		Media := groups[match[1]]
		if err == nil && index > 0 && index <= len(Media) {
			Media[index-1].Name = match[1] + match[2]
		}
	}
}

func ValidateJiasuVideoInput(Input Input) error {
	modelName := strings.ToLower(strings.TrimSpace(Input.Config.Model))
	if !JiasuModelSupportsServerFace(modelName) && (Input.Config.VideoJiasuFaceMode == "light" || Input.Config.VideoJiasuFaceMode == "heavy") {
		return BadAuthRequest("佳速 sd-2.5-j2-V 不接受 face 参数，请将服务端人脸处理改为默认，并在需要时开启本地自动人脸遮罩")
	}
	maxImages := 10
	maxVideos := 0
	maxAudios := 0
	switch modelName {
	case "dola-sd-2.5":
		maxImages = 30
		if len(Input.ReferenceAudios) > 10 {
			return BadAuthRequest("佳速 dola-sd-2.5 最多支持 10 段参考音频")
		}
	case "dola-sd-2.0":
		maxImages = 10
	case "sd-2.0-mini-j1":
		maxImages = 10
		maxVideos = 3
		maxAudios = 3
	case "sd-2.5-j2-v", "sd-2.5-j3-doubao":
		maxImages = 30
		maxVideos = 10
		maxAudios = 10
	case "sd-2.5-j2":
		maxImages = 30
		maxVideos = 10
		maxAudios = 10
	case "minimax-h3":
		if utf8.RuneCountInString(Input.Prompt) > 6000 {
			return BadAuthRequest("佳速 MiniMax H3 提示词最多支持 6000 字符")
		}
		if len(Input.ReferenceVideos) > 3 || len(Input.ReferenceAudios) > 3 || len(Input.ReferenceImages)+len(Input.ReferenceVideos)+len(Input.ReferenceAudios) > 10 {
			return BadAuthRequest("佳速 MiniMax H3 最多支持 3 段视频、3 段音频，全部素材合计最多 10 个")
		}
		var totalDurationMs int64
		for _, video := range Input.ReferenceVideos {
			if video.DurationMs <= 0 {
				return BadAuthRequest("佳速 MiniMax H3 参考视频缺少实际时长，请重新导入视频")
			}
			totalDurationMs += video.DurationMs
		}
		if totalDurationMs > 15000 {
			return BadAuthRequest("佳速 MiniMax H3 参考视频总时长不能超过 15 秒")
		}
	default:
		if maximum, ok := sdVideoImageReferenceLimit("jiasu-video", modelName); ok {
			maxImages = maximum
			if maximum == 30 {
				maxVideos, maxAudios = 10, 10
			}
		} else {
			return BadAuthRequest("佳速视频渠道不支持当前模型")
		}
	}
	if len(Input.ReferenceImages) > maxImages {
		return BadAuthRequest("参考图片数量超过佳速视频模型限制")
	}
	if maxVideos > 0 && len(Input.ReferenceVideos) > maxVideos {
		return BadAuthRequest(fmt.Sprintf("佳速 %s 最多支持 %d 段参考视频", Input.Config.Model, maxVideos))
	}
	if maxAudios > 0 && len(Input.ReferenceAudios) > maxAudios {
		return BadAuthRequest(fmt.Sprintf("佳速 %s 最多支持 %d 段参考音频", Input.Config.Model, maxAudios))
	}
	for _, group := range [][]Media{Input.ReferenceImages, Input.ReferenceVideos, Input.ReferenceAudios} {
		for _, Media := range group {
			if strings.HasPrefix(strings.TrimSpace(Media.URL), "asset://") && !strings.HasPrefix(Media.StorageKey, "resource:") {
				return BadAuthRequest("佳速视频只接受公网 URL，不支持私域资产 URI")
			}
		}
	}
	if len(Input.ReferenceAudios) > 0 {
		for _, image := range ProtocolVideoImageReferences(Input) {
			if image.Role == "first_frame" || image.Role == "last_frame" {
				return BadAuthRequest("佳速视频首尾帧模式不能同时使用参考音频，请改为普通参考图或移除音频")
			}
		}
	}
	return nil
}
