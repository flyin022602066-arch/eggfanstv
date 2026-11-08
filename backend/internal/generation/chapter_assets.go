package generation

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
)

func runChapterAssetsTextTask(ctx context.Context, runtime Runtime, input Input) (map[string]any, error) {
	if runtime.Prompt == nil {
		return nil, errors.New("章节资产结果无法校验")
	}
	result, text, requestErr := requestChapterAssetsText(ctx, input)
	if err := ctx.Err(); err != nil {
		return result, err
	}
	validationErr := runtime.Prompt.ValidateResult("chapter_assets_extract", map[string]any{"text": text})
	if validationErr == nil && chapterAssetsAcceptsReadResult(requestErr) {
		return result, nil
	}
	var incomplete interface{ IncompleteTextResult() bool }
	if ctx.Err() != nil || !errors.As(validationErr, &incomplete) || !incomplete.IncompleteTextResult() || !chapterAssetsMayContinue(requestErr) {
		if requestErr != nil {
			return result, requestErr
		}
		return result, ResponseDecodeError{Err: validationErr}
	}
	if err := setExecutionStage(ctx, runtime, "章节资产输出截断，正在自动续接（1/1）"); err != nil {
		return result, err
	}
	partial := chapterAssetsUnfenced(text)
	continuation := input
	continuation.TextHistory = append(append([]TextMessage(nil), input.TextHistory...), TextMessage{Role: "user", Content: input.Prompt}, TextMessage{Role: "assistant", Content: partial})
	continuation.Prompt = "上一条章节资产 JSON 在传输中被截断。请续写原 JSON，直到补全所有角色、场景、道具及最外层结束括号。为精确校验拼接断点，回复必须先原样输出下方<断点原文>中的文本，再紧接着续写该文本后尚未完成的内容。标记本身不输出。字段值或字符串未写完时先接着该字符串续写。已生成内容不得重写、删除、替换或省略，除指定断点原文外不得重复已有内容。不要从头重新输出 JSON，不要解释，不要 Markdown 围栏。沿用原章节事实、项目画风、系统表现设定与完整输出契约。\n<断点原文>" + chapterAssetsContinuationAnchor(partial) + "</断点原文>"
	_, suffix, continuationErr := requestChapterAssetsText(ctx, continuation)
	if err := ctx.Err(); err != nil {
		return map[string]any{"mode": "text", "text": partial + suffix}, chapterAssetsContinuationError{Err: err}
	}
	if !chapterAssetsAcceptsReadResult(continuationErr) {
		return map[string]any{"mode": "text", "text": partial + suffix}, chapterAssetsContinuationError{Err: continuationErr}
	}
	joined, joinErr := joinChapterAssetsContinuation(partial, suffix)
	if joinErr != nil {
		return map[string]any{"mode": "text", "text": partial + suffix}, chapterAssetsContinuationError{Err: joinErr, Invalid: true}
	}
	combined := map[string]any{"mode": "text", "text": joined}
	if err := runtime.Prompt.ValidateResult("chapter_assets_extract", combined); err != nil {
		if continuationErr != nil {
			return combined, chapterAssetsContinuationError{Err: continuationErr}
		}
		return combined, chapterAssetsContinuationError{Err: err, Invalid: true}
	}
	return combined, nil
}

type chapterAssetsContinuationError struct {
	Err     error
	Invalid bool
}

func (err chapterAssetsContinuationError) Error() string {
	return fmt.Sprintf("章节资产已自动续接一次，但未获得完整结果，未回填半成品：%v", err.Err)
}

func (err chapterAssetsContinuationError) Unwrap() error { return err.Err }

func requestChapterAssetsText(ctx context.Context, input Input) (map[string]any, string, error) {
	var received strings.Builder
	publish := input.OnTextDelta
	input.OnTextDelta = func(delta string) {
		received.WriteString(delta)
		if publish != nil {
			publish(delta)
		}
	}
	result, err := dispatch(ctx, input)
	text := stringField(result, "text")
	if text == "" {
		text = received.String()
	} else if received.Len() == 0 && publish != nil {
		publish(text)
	}
	normalized := normalizeChapterAssetsLineWraps(text)
	if normalized != "" {
		if result == nil {
			result = map[string]any{"mode": "text"}
		}
		result["text"] = normalized
	}
	return result, normalized, err
}

func chapterAssetsAcceptsReadResult(err error) bool {
	if err == nil {
		return true
	}
	var upstreamHTTP HTTPError
	var upstreamPayload PayloadError
	if errors.Is(err, context.Canceled) || errors.As(err, &upstreamHTTP) || errors.As(err, &upstreamPayload) {
		return false
	}
	var networkError net.Error
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &networkError)
}

func normalizeChapterAssetsLineWraps(raw string) string {
	var normalized strings.Builder
	normalized.Grow(len(raw))
	depth := 0
	inString := false
	escaped := false
	for index := 0; index < len(raw); index++ {
		value := raw[index]
		if inString {
			if !escaped && (value == '\n' || value == '\r' || value == '\t') {
				continue
			}
			if escaped {
				escaped = false
			} else if value == '\\' {
				escaped = true
			} else if value == '"' {
				inString = false
			}
		} else {
			switch value {
			case '{', '[':
				depth++
			case '}', ']':
				depth = max(0, depth-1)
			case '"':
				inString = depth > 0
			}
		}
		normalized.WriteByte(value)
	}
	return normalized.String()
}

func chapterAssetsMayContinue(err error) bool {
	if err == nil {
		return true
	}
	var upstreamHTTP HTTPError
	var upstreamPayload PayloadError
	if errors.As(err, &upstreamHTTP) || errors.As(err, &upstreamPayload) {
		return false
	}
	switch ClassifyError(err).Category {
	case CategoryUnknown, CategoryNetwork, CategoryTimeout, CategoryMalformedResponse:
		return true
	default:
		return false
	}
}

func chapterAssetsUnfenced(text string) string {
	leading := strings.TrimLeft(text, " \t\r\n")
	if strings.HasPrefix(leading, "```") {
		text = leading
		if newline := strings.IndexByte(text, '\n'); newline >= 0 {
			text = text[newline+1:]
		}
	}
	trailing := strings.TrimRight(text, " \t\r\n")
	if strings.HasSuffix(trailing, "```") {
		return strings.TrimSuffix(trailing, "```")
	}
	return text
}

func chapterAssetsContinuationAnchor(partial string) string {
	characters := []rune(partial)
	return string(characters[max(0, len(characters)-64):])
}

func joinChapterAssetsContinuation(partial, suffix string) (string, error) {
	suffix = chapterAssetsUnfenced(suffix)
	anchor := chapterAssetsContinuationAnchor(partial)
	if anchor == "" || !strings.HasPrefix(suffix, anchor) {
		return "", errors.New("续接内容与指定断点不一致，不能安全合并资产")
	}
	return partial + strings.TrimPrefix(suffix, anchor), nil
}
