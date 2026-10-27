package generation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/outbound"
)

var SunoMusicVersions = map[string]bool{
	"chirp-v3-0": true, "chirp-v3-5": true, "chirp-v4": true, "chirp-v4-5": true,
	"chirp-v5": true, "chirp-v5-5": true, "chirp-v6": true, "chirp-v6-wild": true,
	"chirp-v6-mini": true, "chirp-v3-5-tau": true, "chirp-v4-tau": true, "chirp-auk": true, "chirp-fenix": true,
}

func IsSunoMusicModel(model string) bool {
	name := strings.ToLower(strings.TrimSpace(model))
	if index := strings.LastIndex(name, "::"); index >= 0 {
		name = name[index+2:]
	}
	return name == "suno" || strings.HasPrefix(name, "suno_") || strings.HasPrefix(name, "suno-") || SunoMusicVersions[name]
}

func SunoMusicBody(Input Input) (map[string]interface{}, error) {
	body := map[string]interface{}{}
	if strings.TrimSpace(Input.Config.AudioSunoParams) != "" {
		if err := json.Unmarshal([]byte(Input.Config.AudioSunoParams), &body); err != nil || body == nil {
			return nil, errors.New("Suno 音乐参数必须是 JSON 对象")
		}
	}
	mode := stringField(body, "mode")
	delete(body, "mode")
	if body["mv"] == nil {
		body["mv"] = "chirp-v5"
		if SunoMusicVersions[Input.Config.Model] {
			body["mv"] = Input.Config.Model
		}
	}
	if !SunoMusicVersions[stringField(body, "mv")] {
		return nil, errors.New("Suno 模型版本无效")
	}
	if body["make_instrumental"] == nil {
		body["make_instrumental"] = false
	}
	if _, ok := body["make_instrumental"].(bool); !ok {
		return nil, errors.New("Suno make_instrumental 必须是布尔值")
	}
	allowed := map[string]bool{"mv": true, "make_instrumental": true, "prompt": true, "gpt_description_prompt": true, "title": true, "tags": true, "task": true, "task_id": true, "continue_clip_id": true, "continue_at": true, "persona_id": true, "artist_clip_id": true, "metadata_params": true}
	for key, value := range body {
		if !allowed[key] {
			return nil, fmt.Errorf("Suno 不支持参数 %s", key)
		}
		switch key {
		case "make_instrumental":
		case "continue_at":
			if numeric, ok := value.(float64); !ok || numeric < 0 {
				return nil, errors.New("Suno 续写时间必须是非负数字")
			}
		case "metadata_params":
			if _, ok := value.(map[string]interface{}); !ok {
				return nil, errors.New("Suno metadata_params 必须是对象")
			}
		default:
			if _, ok := value.(string); !ok {
				return nil, fmt.Errorf("Suno %s 必须是字符串", key)
			}
		}
	}
	if mode != "" {
		if mode != "custom" && mode != "description" {
			return nil, errors.New("Suno 创作模式无效")
		}
		delete(body, "prompt")
		delete(body, "gpt_description_prompt")
		if mode == "custom" {
			body["prompt"] = Input.Prompt
		} else {
			body["gpt_description_prompt"] = Input.Prompt
		}
	} else if body["prompt"] == nil && body["gpt_description_prompt"] == nil {
		body["gpt_description_prompt"] = Input.Prompt
	}
	if stringField(body, "prompt") != "" && stringField(body, "gpt_description_prompt") != "" {
		return nil, errors.New("Suno 歌词与灵感描述不能同时提交")
	}
	if stringField(body, "task") == "" && stringField(body, "prompt") == "" && stringField(body, "gpt_description_prompt") == "" && body["make_instrumental"] != true {
		return nil, errors.New("请填写 Suno 音乐描述或歌词")
	}
	return body, nil
}

func SunoJSON(ctx context.Context, Config Config, method string, path string, body interface{}, target interface{}) error {
	base, err := url.Parse(strings.TrimSpace(defaultString(Config.BaseURL, "https://api.eggfans.com")))
	if err != nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return errors.New("Suno Base URL 无效")
	}
	base.Path = strings.TrimRight(base.Path, "/")
	for _, suffix := range []string{"/v1", "/suno"} {
		base.Path = strings.TrimSuffix(base.Path, suffix)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base.String(), "/")+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+Config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	outbound.ApplyOutboundHeaders(request, Config.Headers)
	if method == http.MethodPost {
		if key, _ := ctx.Value(submissionKeyContext{}).(string); key != "" {
			request.Header.Set("Idempotency-Key", key)
		}
	}
	return DoJSON(request, target)
}

type SunoTaskState struct {
	TaskID string
	Status string
	Clips  []map[string]interface{}
}

func SunoDecodedValue(value interface{}, depth int) (interface{}, error) {
	if depth > 12 {
		return nil, errors.New("Suno 结果数据嵌套过深")
	}
	switch current := value.(type) {
	case string:
		data := []byte(strings.TrimSpace(current))
		if decoded, err := base64.StdEncoding.DecodeString(string(data)); err == nil {
			data = bytes.TrimSpace(decoded)
		}
		if len(data) > 0 && (data[0] == '{' || data[0] == '[') {
			var nested interface{}
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.UseNumber()
			if err := decoder.Decode(&nested); err != nil {
				return nil, errors.New("Suno 结果 JSON 无法解析")
			}
			return SunoDecodedValue(nested, depth+1)
		}
	case []interface{}:
		for index, item := range current {
			decoded, err := SunoDecodedValue(item, depth+1)
			if err != nil {
				return nil, err
			}
			current[index] = decoded
		}
	case map[string]interface{}:
		for _, key := range []string{"data", "result", "output"} {
			if item, exists := current[key]; exists {
				decoded, err := SunoDecodedValue(item, depth+1)
				if err != nil {
					return nil, err
				}
				current[key] = decoded
			}
		}
	}
	return value, nil
}

func ParseSunoState(raw []byte) (SunoTaskState, error) {
	state := SunoTaskState{}
	var root interface{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return state, errors.New("Suno 响应不是有效 JSON")
	}
	root, err := SunoDecodedValue(root, 0)
	if err != nil {
		return state, err
	}
	seen := map[string]bool{}
	var inspect func(interface{}, int) error
	inspect = func(value interface{}, depth int) error {
		if depth > 12 {
			return errors.New("Suno 结果数据嵌套过深")
		}
		switch item := value.(type) {
		case []interface{}:
			for _, child := range item {
				if err := inspect(child, depth+1); err != nil {
					return err
				}
			}
		case map[string]interface{}:
			if code := item["code"]; code != nil {
				codeText := strings.ToLower(fmt.Sprint(code))
				if codeText != "success" && codeText != "ok" && codeText != "0" && codeText != "200" {
					return HTTPError{StatusCode: 400, Body: string(raw)}
				}
			}
			if item["success"] == false || item["error"] != nil {
				return HTTPError{StatusCode: 400, Body: string(raw)}
			}
			if id, err := firstJSONString(item, "task_id", "taskId"); err != nil {
				return err
			} else if id != "" && state.TaskID == "" {
				state.TaskID = id
			}
			status := strings.ToLower(stringField(item, "status"))
			switch status {
			case "failed", "failure", "error", "cancelled", "canceled", "expired":
				return fmt.Errorf("Suno 上游任务失败：%s", defaultString(stringField(item, "fail_reason"), "上游拒绝了任务"))
			}
			if state.Status == "" && status != "" {
				state.Status = status
			}
			audio := firstNonEmpty(stringField(item, "audio_url"), stringField(item, "audioUrl"), stringField(item, "cld2AudioUrl"))
			if audio != "" {
				id, err := firstJSONString(item, "clip_id", "clipId", "id")
				if err != nil {
					return err
				}
				if id != "" && !seen[id] {
					seen[id] = true
					item["clipId"], item["audioUrl"] = id, audio
					state.Clips = append(state.Clips, item)
				}
				if status != "" && status != "success" && status != "succeeded" && status != "complete" && status != "completed" && status != "done" {
					state.Status = "processing"
				}
			}
			for _, key := range []string{"data", "clips", "songs", "results", "result", "output", "music"} {
				if child, exists := item[key]; exists {
					if err := inspect(child, depth+1); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	if err := inspect(root, 0); err != nil {
		return state, err
	}
	if payload, ok := root.(map[string]interface{}); ok && state.TaskID == "" {
		if id, ok := payload["data"].(string); ok && !strings.ContainsAny(id, " /?\n") {
			state.TaskID = strings.TrimSpace(id)
		}
	}
	if state.Status == "" && len(state.Clips) > 0 {
		state.Status = "success"
	}
	return state, nil
}

func RunSunoAudioTaskWithPolicy(ctx context.Context, Input Input, policy VideoPollPolicy) (map[string]interface{}, error) {
	id := ResumedProviderRequestID(ctx)
	if id == "" {
		body, err := SunoMusicBody(Input)
		if err != nil {
			return nil, err
		}
		var raw json.RawMessage
		if err := SunoJSON(WithRequestKind(ctx, "create"), Input.Config, http.MethodPost, "/suno/submit/music", body, &raw); err != nil {
			return nil, err
		}
		created, err := ParseSunoState(raw)
		if err != nil {
			return nil, err
		}
		id = created.TaskID
		if id == "" {
			return nil, errors.New("Suno 已响应但未返回任务 ID，请核对渠道记录，勿重复提交")
		}
	}
	return RunVideoPollLoop(ctx, id, policy, func(ctx context.Context) (VideoPollOutcome, error) {
		var raw json.RawMessage
		if err := SunoJSON(WithRequestKind(ctx, "poll"), Input.Config, http.MethodGet, "/suno/fetch/"+url.PathEscape(id), nil, &raw); err != nil {
			return VideoPollOutcome{}, err
		}
		state, err := ParseSunoState(raw)
		if err != nil {
			return VideoPollOutcome{}, err
		}
		switch state.Status {
		case "success", "succeeded", "complete", "completed", "done":
		default:
			return VideoPollOutcome{}, nil
		}
		if len(state.Clips) == 0 {
			return VideoPollOutcome{}, errors.New("Suno 任务已完成，但未返回可下载音频；请使用任务 ID 在音乐导演台查询")
		}
		items := make([]interface{}, 0, len(state.Clips))
		for _, clip := range state.Clips {
			mediaURL := stringField(clip, "audioUrl")
			if !IsPublicMediaURL(mediaURL) {
				return VideoPollOutcome{}, errors.New("Suno 音频地址无效")
			}
			data, mimeType, err := RunVideoDownload(ctx, id, policy, func(ctx context.Context) ([]byte, string, error) {
				return GetExternalBinary(WithRequestKind(ctx, "download"), mediaURL)
			})
			if err != nil {
				return VideoPollOutcome{}, err
			}
			mimeType, err = ValidateGeneratedAudio(mimeType, data, "mp3")
			if err != nil {
				return VideoPollOutcome{}, err
			}
			items = append(items, map[string]interface{}{"dataUrl": DataURL(mimeType, data), "mimeType": mimeType, "format": localasset.ExtensionFromMimeType(mimeType), "clipId": clip["clipId"], "title": clip["title"], "sourceUrl": mediaURL})
		}
		return VideoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "audio", "audio": items[0], "audios": items, "providerTaskId": id}}, nil
	})
}
