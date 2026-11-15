package hanbao

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var runtimeHeader = regexp.MustCompile(`(?im)(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*`)
var runtimeSecret = regexp.MustCompile(`(?i)(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|session(?:id)?|msToken|a_bogus|prompt|input|query)\s*["']?\s*[:=：][\s\S]*`)
var runtimePath = regexp.MustCompile(`(?i)(?:[a-z]:[\\/]|\\\\|/(?:Users|home|private|tmp|var|Volumes|mnt|media|run|root|opt|srv|etc)/)[^\r\n:"'<>]+`)
var runtimeCode = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,64}$`)
var canvasFailure = regexp.MustCompile(`画布连续 [1-9][0-9]* 次生成失败（[^\r\n]*）：这条先跳过，可稍后重试或换个账号`)
var queryWaitLimit = regexp.MustCompile(`^超过 [1-9][0-9]* 分钟仍无结果，已判定失败：请重新生成（建议换一个有视频能力的账号）$`)

func QueryWaitLimitMessage(message string) bool {
	return queryWaitLimit.MatchString(strings.TrimSpace(strings.TrimPrefix(message, "憨包视频结果失败：")))
}

func ConfirmedCanvasFailure(message string) bool {
	return canvasFailure.MatchString(message)
}

func TerminalStatus(state map[string]any) bool {
	status, _ := state["gen_status"].(string)
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "failed", "fail", "error", "expired", "cancelled", "canceled":
		return true
	}
	return false
}

type CallError struct {
	Source string
	Stage  string
	Code   string
	Reason string
}

func (e *CallError) Error() string {
	code := ""
	if e.Code != "" {
		code = "（code=" + e.Code + "）"
	}
	return "憨包" + e.Stage + code + "：" + e.Reason
}

func safeRuntimeMessage(message string, settings Settings) string {
	message = runtimeHeader.ReplaceAllString(message, "[凭据已隐藏]")
	message = runtimeSecret.ReplaceAllString(message, "[凭据已隐藏]")
	message = runtimePath.ReplaceAllString(message, "[路径已隐藏]")
	return smsErrorMessage(message, settings.Feihu, url.Values{})
}

func replyCode(value any) string {
	var code string
	switch typed := value.(type) {
	case string:
		code = typed
	case json.Number:
		code = string(typed)
	case float64:
		code = fmt.Sprintf("%g", typed)
	case json.RawMessage:
		if json.Unmarshal(typed, &code) != nil {
			code = string(typed)
		}
	}
	if runtimeCode.MatchString(code) {
		return code
	}
	return ""
}

func ResultError(state map[string]any) error {
	code := replyCode(state["code"])
	reason := "上游视频任务返回失败状态"
	for _, key := range []string{"fail_reason", "error", "message", "msg", "error_message"} {
		if text, ok := state[key].(string); ok && strings.TrimSpace(text) != "" {
			reason = text
			break
		}
		if detail, ok := state[key].(map[string]any); ok {
			code = replyCode(detail["code"])
			if text, ok := detail["message"].(string); ok && strings.TrimSpace(text) != "" {
				reason = text
				break
			}
		}
	}
	return &CallError{Source: "upstream_response", Stage: "视频结果失败", Code: code, Reason: safeRuntimeMessage(reason, Settings{})}
}
