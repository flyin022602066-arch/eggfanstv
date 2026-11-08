package generation

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/provider/hanbao"
)

func EncodeHanbaoTask(task hanbao.TaskRef) string {
	body, _ := json.Marshal(task)
	return "hanbao:"+base64.RawURLEncoding.EncodeToString(body)
}

func DecodeHanbaoTask(value string) (hanbao.TaskRef, error) {
	var task hanbao.TaskRef
	if !strings.HasPrefix(value, "hanbao:") { return task, errors.New("憨包任务回执格式无效") }
	body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "hanbao:"))
	if err != nil || json.Unmarshal(body, &task) != nil || strings.TrimSpace(task.SubmitID) == "" || strings.TrimSpace(task.Account) == "" { return task, errors.New("憨包任务回执缺少任务号或实际账号") }
	return task, nil
}

func RunHanbaoVideoTask(ctx context.Context, input Input, policy VideoPollPolicy) (map[string]any, error) {
	runtime, _ := RuntimeFromContext(ctx)
	if runtime.Hanbao == nil || runtime.LocalVideoReceipts == nil { return nil, errors.New("憨包本地执行端口未接入") }
	if len(input.ReferenceVideos)+len(input.ReferenceAudios) != 0 || input.Mask != nil { return nil, errors.New("憨包仅支持文字和图片参考") }
	if err := runtime.LocalVideoReceipts.Ready(ctx); err != nil { return nil, err }
	release, err := runtime.Hanbao.Acquire()
	for errors.Is(err, hanbao.ErrBusy) {
		if err := SleepContext(ctx, time.Second); err != nil { return nil, err }
		release, err = runtime.Hanbao.Acquire()
	}
	if err != nil { return nil, err }
	defer release()
	id := ResumedProviderRequestID(ctx)
	var task hanbao.TaskRef
	if id != "" {
		task, err = DecodeHanbaoTask(id)
		if err != nil { return nil, err }
	} else {
		seconds, parseErr := strconv.Atoi(defaultString(input.Config.VideoSeconds, "5"))
		if parseErr != nil { return nil, errors.New("憨包视频时长必须是 4～30 秒的整数") }
		request := hanbao.VideoRequest{Prompt: input.Prompt, Model:input.Config.Model, Duration:seconds, Ratio:defaultString(input.Config.Size,"16:9")}
		for _, media := range input.ReferenceImages {
			var data []byte
			var mime string
			if strings.HasPrefix(media.DataURL, "data:") || strings.HasPrefix(media.URL, "data:") {
				data, mime, err = MediaBytes(media)
			} else {
				data, mime, err = GetExternalBinary(ctx, media.URL)
			}
			if err != nil { return nil, err }
			if !strings.HasPrefix(mime,"image/") { return nil, errors.New("憨包参考素材必须是图片") }
			request.Images = append(request.Images, data)
		}
		task, err = runtime.Hanbao.Submit(ctx, request)
		if err != nil {
			var uncertain hanbao.UncertainError
			if errors.As(err, &uncertain) { return nil, SubmissionUnknownError{Cause:err} }
			return nil, err
		}
		id = EncodeHanbaoTask(task)
		// Save the actual rotated account with the opaque canvas token BEFORE polling.
		if err := runtime.LocalVideoReceipts.RecordAccepted(ctx,id); err != nil { return nil, SubmissionUnknownError{Cause:fmt.Errorf("憨包已受理但保存回执失败（%s）：%w",id,err)} }
	}
	policy.Interval = max(policy.Interval, 10*time.Second)
	return RunVideoPollLoop(ctx, id, policy, func(ctx context.Context) (VideoPollOutcome,error) {
		state, err := runtime.Hanbao.Query(ctx,task)
		if err != nil { return VideoPollOutcome{}, StatePendingError{TaskID:id,Cause:err} }
		if queryError, ok := state["query_error"]; ok && queryError != nil {
			empty := false
			switch value := queryError.(type) { case string: empty = value == ""; case bool: empty = !value }
			if !empty { return VideoPollOutcome{}, StatePendingError{TaskID:id,Cause:errors.New("憨包任务本轮暂时不可查询")} }
		}
		status, _ := state["gen_status"].(string)
		switch strings.ToLower(status) {
		case "failed","fail","error": return VideoPollOutcome{}, errors.New("憨包视频生成失败")
		case "expired","cancelled","canceled": return VideoPollOutcome{}, errors.New("憨包视频任务已过期或取消")
		case "success":
			videoURL, _ := state["video_url"].(string)
			if videoURL == "" { return VideoPollOutcome{},nil }
			data,mime,err := RunVideoDownload(ctx,id,policy,func(ctx context.Context)([]byte,string,error){ return GetExternalBinary(ctx,videoURL) })
			if err != nil { return VideoPollOutcome{},err }
			if !strings.HasPrefix(mime, "video/") && mime != "application/octet-stream" { return VideoPollOutcome{}, errors.New("憨包返回的文件不是视频") }
			return VideoPollOutcome{Done:true,Result:map[string]any{"mode":"video","video":map[string]any{"dataUrl":DataURL(mime,data),"mimeType":mime}}},nil
		}
		return VideoPollOutcome{},nil
	})
}
