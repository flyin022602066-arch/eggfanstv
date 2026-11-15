package generation

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider/hanbao"
)

func EncodeHanbaoTask(task hanbao.TaskRef) string {
	body, _ := json.Marshal(task)
	return "hanbao:" + base64.RawURLEncoding.EncodeToString(body)
}

func DecodeHanbaoTask(value string) (hanbao.TaskRef, error) {
	var task hanbao.TaskRef
	if !strings.HasPrefix(value, "hanbao:") {
		return task, errors.New("憨包任务回执格式无效")
	}
	body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "hanbao:"))
	if err != nil || json.Unmarshal(body, &task) != nil || strings.TrimSpace(task.SubmitID) == "" || strings.TrimSpace(task.Account) == "" {
		return task, errors.New("憨包任务回执缺少任务号或实际账号")
	}
	return task, nil
}

func NormalizeHanbaoTaskFailure(task model.Task) model.Task {
	if task.Status == model.TaskStatusFailed && strings.HasPrefix(task.Model, "hanbao::") && strings.HasPrefix(task.ProviderRequestID, "hanbao:") && task.FailureDiagnostics != nil && hanbao.QueryWaitLimitMessage(task.FailureDiagnostics.Summary) {
		diagnostic := *task.FailureDiagnostics
		diagnostic.Source, diagnostic.ExecutionResult = "local_runtime", "pending"
		diagnostic.Summary = "憨包本地组件查询等待超时，尚未确认上游结果；可取回结果继续查询原任务"
		task.FailureDiagnostics = &diagnostic
		task.Stage, task.Error = "本地组件查询等待超时", diagnostic.Summary
		return task
	}
	if task.Status != model.TaskStatusFailed || task.Stage != "submission_unknown" || task.ProviderRequestID != "" || !strings.HasPrefix(task.Model, "hanbao::") || task.FailureDiagnostics == nil {
		return task
	}
	diagnostic := *task.FailureDiagnostics
	if diagnostic.Source != "local_runtime" || !hanbao.ConfirmedCanvasFailure(diagnostic.Summary) {
		return task
	}
	diagnostic.Source, diagnostic.ExecutionResult = "upstream_response", "failed"
	task.FailureDiagnostics = &diagnostic
	task.Stage = "生成失败"
	task.Error = ClassifyText(diagnostic.Summary).UserMessage()
	return task
}

func RunHanbaoVideoTask(ctx context.Context, input Input, policy VideoPollPolicy) (map[string]any, error) {
	runtime, _ := RuntimeFromContext(ctx)
	if runtime.Hanbao == nil || runtime.LocalVideoReceipts == nil {
		return nil, errors.New("憨包本地执行端口未接入")
	}
	if len(input.ReferenceVideos)+len(input.ReferenceAudios) != 0 || input.Mask != nil {
		return nil, errors.New("憨包仅支持文字和图片参考")
	}
	if err := runtime.LocalVideoReceipts.Ready(ctx); err != nil {
		return nil, err
	}
	release, err := runtime.Hanbao.Acquire()
	for errors.Is(err, hanbao.ErrBusy) {
		stage := "等待憨包本地组件，尚未提交"
		if ResumedProviderRequestID(ctx) != "" {
			stage = "已提交，等待憨包本地组件查询"
		}
		if stageErr := setExecutionStage(ctx, runtime, stage); stageErr != nil {
			return nil, stageErr
		}
		if err := SleepContext(ctx, time.Second); err != nil {
			return nil, err
		}
		release, err = runtime.Hanbao.Acquire()
	}
	if err != nil {
		return nil, err
	}
	defer release()
	id := ResumedProviderRequestID(ctx)
	var task hanbao.TaskRef
	if id != "" {
		task, err = DecodeHanbaoTask(id)
		if err != nil {
			return nil, err
		}
	} else {
		seconds, parseErr := strconv.Atoi(defaultString(input.Config.VideoSeconds, "5"))
		if parseErr != nil {
			return nil, errors.New("憨包视频时长必须是 4～30 秒的整数")
		}
		request := hanbao.VideoRequest{Prompt: input.Prompt, Model: input.Config.Model, Duration: seconds, Ratio: defaultString(input.Config.Size, "16:9")}
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
			if !strings.HasPrefix(mime, "image/") {
				return nil, errors.New("憨包参考素材必须是图片")
			}
			request.Images = append(request.Images, data)
			extension := ".png"
			switch strings.Split(mime, ";")[0] {
			case "image/jpeg":
				extension = ".jpg"
			case "image/webp":
				extension = ".webp"
			}
			request.ImageExtensions = append(request.ImageExtensions, extension)
		}
		if err := setExecutionStage(ctx, runtime, "正在提交憨包生成任务"); err != nil {
			return nil, err
		}
		task, err = runtime.Hanbao.Submit(ctx, request)
		if err != nil {
			var uncertain hanbao.UncertainError
			if errors.As(err, &uncertain) {
				return nil, SubmissionUnknownError{Cause: err}
			}
			return nil, err
		}
		id = EncodeHanbaoTask(task)
		// Save the actual rotated account with the opaque canvas token BEFORE polling.
		if err := runtime.LocalVideoReceipts.RecordAccepted(ctx, id); err != nil {
			return nil, SubmissionUnknownError{Cause: fmt.Errorf("憨包已受理但保存回执失败（%s）：%w", id, err)}
		}
	}
	if err := setExecutionStage(ctx, runtime, "已提交，等待查询上游状态"); err != nil {
		return nil, err
	}
	policy.Interval = max(policy.Interval, 10*time.Second)
	return RunVideoPollLoop(ctx, id, policy, func(ctx context.Context) (VideoPollOutcome, error) {
		result, _, err := queryHanbaoVideoResult(ctx, runtime.Hanbao, task, id, policy)
		return VideoPollOutcome{Done: result != nil, Result: result}, err
	})
}

func QueryHanbaoVideoResult(ctx context.Context, id string, policy VideoPollPolicy) (map[string]any, string, error) {
	task, err := DecodeHanbaoTask(id)
	if err != nil {
		return nil, "", err
	}
	runtime, _ := RuntimeFromContext(ctx)
	if runtime.Hanbao == nil {
		return nil, "", errors.New("憨包本地执行端口未接入")
	}
	release, err := runtime.Hanbao.Acquire()
	if err != nil {
		return nil, "", err
	}
	defer release()
	return queryHanbaoVideoResult(ctx, runtime.Hanbao, task, id, policy)
}

func queryHanbaoVideoResult(ctx context.Context, port HanbaoPort, task hanbao.TaskRef, id string, policy VideoPollPolicy) (map[string]any, string, error) {
	runtime, _ := RuntimeFromContext(ctx)
	if err := setExecutionStage(ctx, runtime, "已提交，正在查询上游状态（发起于 "+time.Now().Format("15:04:05")+"）"); err != nil {
		return nil, "", err
	}
	state, err := port.Query(ctx, task)
	if err != nil {
		if stageErr := setExecutionStage(ctx, runtime, "查询暂不可用，稍后继续查询原任务（"+time.Now().Format("15:04:05")+"）"); stageErr != nil {
			return nil, "", stageErr
		}
		return nil, "", StatePendingError{TaskID: id, Cause: err}
	}
	status, _ := state["gen_status"].(string)
	status = strings.ToLower(strings.TrimSpace(status))
	if queryError, ok := state["query_error"]; ok && queryError != nil {
		empty := false
		switch value := queryError.(type) {
		case string:
			empty = strings.TrimSpace(value) == ""
		case bool:
			empty = !value
		case float64:
			empty = value == 0
		case json.Number:
			number, err := value.Float64()
			empty = err == nil && number == 0
		}
		if !empty {
			if err := setExecutionStage(ctx, runtime, "查询暂不可用，稍后继续查询原任务（"+time.Now().Format("15:04:05")+"）"); err != nil {
				return nil, status, err
			}
			return nil, status, StatePendingError{TaskID: id, Cause: errors.New("憨包任务本轮暂时不可查询，请稍后再次取回结果")}
		}
	}
	if hanbao.TerminalStatus(state) && (hanbao.QueryWaitLimitMessage(stringMapField(state, "fail_reason")) || hanbao.QueryWaitLimitMessage(stringMapField(state, "state_text"))) {
		if err := setExecutionStage(ctx, runtime, "本地组件查询等待超时，上游结果未确认（"+time.Now().Format("15:04:05")+"）"); err != nil {
			return nil, "", err
		}
		return nil, "pending", StatePendingError{TaskID: id, Cause: &hanbao.CallError{Source: "local_runtime", Stage: "查询等待超时", Reason: "组件等待时限已到，尚未确认上游结果，将继续查询原任务"}}
	}
	if hanbao.TerminalStatus(state) {
		if err := setExecutionStage(ctx, runtime, "上游已返回生成失败"); err != nil {
			return nil, status, err
		}
		return nil, status, hanbao.ResultError(state)
	}
	videoURL, _ := state["video_url"].(string)
	if status != "success" || strings.TrimSpace(videoURL) == "" {
		stage := "上游状态未确认，继续查询原任务"
		switch status {
		case "in_queue":
			stage = "上游排队中"
		case "running":
			stage = "上游生成中"
		case "success":
			stage = "上游已报成功，等待视频链接"
		}
		if err := setExecutionStage(ctx, runtime, stage+"（查询于 "+time.Now().Format("15:04:05")+"）"); err != nil {
			return nil, status, err
		}
		return nil, status, nil
	}
	data, mime, err := RunVideoDownload(ctx, id, policy, func(ctx context.Context) ([]byte, string, error) { return GetExternalBinary(ctx, videoURL) })
	if err != nil {
		return nil, status, err
	}
	if !strings.HasPrefix(mime, "video/") && mime != "application/octet-stream" {
		return nil, status, errors.New("憨包返回的文件不是视频")
	}
	if err := setExecutionStage(ctx, runtime, "视频已取回，正在保存"); err != nil {
		return nil, status, err
	}
	return map[string]any{"mode": "video", "video": map[string]any{"dataUrl": DataURL(mime, data), "mimeType": mime}}, status, nil
}
