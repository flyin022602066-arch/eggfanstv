package generation

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/provider/doubaobrowser"
)

func EncodeDoubaoBrowserTask(task doubaobrowser.Receipt) string {
	body, _ := json.Marshal(task)
	return "doubao-browser:" + base64.RawURLEncoding.EncodeToString(body)
}

func DecodeDoubaoBrowserTask(value string) (doubaobrowser.Receipt, error) {
	var task doubaobrowser.Receipt
	body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "doubao-browser:"))
	if !strings.HasPrefix(value, "doubao-browser:") || err != nil || json.Unmarshal(body, &task) != nil || !doubaobrowser.ValidReceipt(task) {
		return task, errors.New("豆包浏览器任务回执无效")
	}
	return task, nil
}

func RunDoubaoBrowserVideoTask(ctx context.Context, input Input, policy VideoPollPolicy) (map[string]any, error) {
	runtime, _ := RuntimeFromContext(ctx)
	meta, _ := CallMetaFromContext(ctx)
	if runtime.DoubaoBrowser == nil || runtime.LocalVideoReceipts == nil || meta.UserID == "" || meta.TaskID == "" {
		return nil, errors.New("豆包浏览器缺少本地任务上下文")
	}
	if len(input.ReferenceVideos)+len(input.ReferenceAudios) != 0 || input.Mask != nil {
		return nil, errors.New("豆包浏览器只支持文字和图片参考")
	}
	if err := runtime.LocalVideoReceipts.Ready(ctx); err != nil {
		return nil, err
	}
	id := ResumedProviderRequestID(ctx)
	if id == "" {
		seconds, err := strconv.Atoi(defaultString(input.Config.VideoSeconds, "5"))
		if err != nil {
			return nil, errors.New("视频时长必须为整数秒")
		}
		request := doubaobrowser.Request{TaskID: meta.TaskID, Model: input.Config.Model, Prompt: input.Prompt, Duration: seconds, Ratio: defaultString(input.Config.Size, "16:9"), Images: []string{}}
		for _, media := range input.ReferenceImages {
			var data []byte
			var mime string
			if strings.HasPrefix(media.DataURL, "data:") || strings.HasPrefix(media.URL, "data:") {
				data, mime, err = MediaBytes(media)
			} else {
				data, mime, err = GetExternalBinary(ctx, media.URL)
			}
			if err != nil {
				return nil, err
			}
			mime = strings.Split(mime, ";")[0]
			if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
				return nil, errors.New("参考图须为 PNG/JPEG/WebP")
			}
			request.Images = append(request.Images, DataURL(mime, data))
		}
		if err := doubaobrowser.Validate(request); err != nil {
			return nil, err
		}
		if err := setExecutionStage(ctx, runtime, "等待豆包浏览器环境，保留两个空闲环境"); err != nil {
			return nil, err
		}
		receipt, err := runtime.DoubaoBrowser.Submit(ctx, meta.UserID, request)
		if err != nil {
			var before doubaobrowser.BeforeSubmitError
			if errors.As(err, &before) {
				return nil, err
			}
			return nil, SubmissionUnknownError{Cause: err}
		}
		if receipt.TaskID != meta.TaskID || receipt.ProfileID == "" {
			return nil, SubmissionUnknownError{Cause: errors.New("豆包浏览器受理身份不匹配")}
		}
		id = EncodeDoubaoBrowserTask(receipt)
		if err := runtime.LocalVideoReceipts.RecordAccepted(ctx, id); err != nil {
			return nil, SubmissionUnknownError{Cause: err}
		}
	}
	policy.Interval = max(policy.Interval, 10*time.Second)
	return RunVideoPollLoop(ctx, id, policy, func(ctx context.Context) (VideoPollOutcome, error) {
		result, _, err := QueryDoubaoBrowserVideoResult(ctx, id, policy)
		return VideoPollOutcome{Done: result != nil, Result: result}, err
	})
}

func QueryDoubaoBrowserVideoResult(ctx context.Context, id string, policy VideoPollPolicy) (map[string]any, string, error) {
	runtime, _ := RuntimeFromContext(ctx)
	meta, _ := CallMetaFromContext(ctx)
	receipt, err := DecodeDoubaoBrowserTask(id)
	if err != nil {
		return nil, "", err
	}
	if runtime.DoubaoBrowser == nil || meta.UserID == "" || receipt.TaskID != meta.TaskID {
		return nil, "", errors.New("豆包浏览器原任务身份不匹配")
	}
	state, err := runtime.DoubaoBrowser.Query(ctx, meta.UserID, receipt)
	if err != nil {
		return nil, "pending", StatePendingError{TaskID: id, Cause: err}
	}
	if state.Status == "failed" {
		return nil, state.Status, errors.New("豆包浏览器：" + defaultString(state.Reason, "上游生成失败"))
	}
	if state.Status != "success" || state.VideoURL == "" {
		return nil, state.Status, nil
	}
	data, mime, err := RunVideoDownload(ctx, id, policy, func(ctx context.Context) ([]byte, string, error) { return GetExternalBinary(ctx, state.VideoURL) })
	if err != nil {
		return nil, state.Status, err
	}
	if !strings.HasPrefix(mime, "video/") && mime != "application/octet-stream" {
		return nil, state.Status, errors.New("豆包浏览器返回的文件不是视频")
	}
	return map[string]any{"mode": "video", "video": map[string]any{"dataUrl": DataURL(mime, data), "mimeType": mime}}, state.Status, nil
}
