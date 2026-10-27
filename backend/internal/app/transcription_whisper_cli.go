package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/transcription"
)

type timelineTranscriptionSegment = transcription.Segment

type timelineTranscriptionResult struct {
	Segments []timelineTranscriptionSegment `json:"segments"`
	SRT      string                         `json:"srt"`
	Language string                         `json:"language"`
}

func decodeWhisperVerboseJSON(payload []byte) ([]timelineTranscriptionSegment, string, error) {
	return transcription.DecodeVerboseJSON(payload)
}

func whisperCLIName() string {
	if runtime.GOOS == "windows" {
		return "whisper-cli.exe"
	}
	return "whisper-cli"
}

func (s *Service) whisperCLIPaths() (string, string, error) {
	if !s.IsLocalMode() {
		return "", "", fmt.Errorf("服务端转写需要配置 CANVAS_WHISPER_BASE_URL")
	}
	directories := []string{filepath.Join(s.dataDir, "..", "tools", "whisper")}
	if executable, err := os.Executable(); err == nil {
		for directory, count := filepath.Dir(executable), 0; count < 7; directory, count = filepath.Dir(directory), count+1 {
			directories = append(directories, filepath.Join(directory, ".local", "tools", "whisper"))
		}
	}
	for _, directory := range directories {
		binary := filepath.Clean(filepath.Join(directory, whisperCLIName()))
		model := filepath.Clean(filepath.Join(directory, "ggml-base.bin"))
		binaryInfo, binaryErr := os.Stat(binary)
		modelInfo, modelErr := os.Stat(model)
		if binaryErr == nil && modelErr == nil && !binaryInfo.IsDir() && !modelInfo.IsDir() && binaryInfo.Size() > 0 && modelInfo.Size() > 0 {
			return binary, model, nil
		}
	}
	return "", "", fmt.Errorf("本地语音引擎未安装：需要项目 .local/tools/whisper 中的 whisper-cli 和 ggml-base.bin")
}

func (s *Service) transcribeWhisperCLI(ctx context.Context, wavPath string, language string) ([]transcription.Segment, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	binary, model, err := s.whisperCLIPaths()
	if err != nil {
		return nil, "", err
	}
	if language = strings.TrimSpace(language); language == "" {
		language = "auto"
	}
	outputBase := filepath.Join(filepath.Dir(wavPath), "transcript")
	threads := min(8, max(1, runtime.NumCPU()-1))
	command := exec.CommandContext(ctx, binary, "-m", model, "-f", wavPath, "-l", language, "-t", strconv.Itoa(threads), "-oj", "-of", outputBase, "-np")
	command.Dir = filepath.Dir(binary)
	hideTranscriptionWindow(command)
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, "", ctx.Err()
		}
		return nil, "", fmt.Errorf("本地语音识别执行失败，请检查运行包和模型文件: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	file, err := os.Open(outputBase + ".json")
	if err != nil {
		return nil, "", fmt.Errorf("本地语音识别未产生结果: %w", err)
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, 8<<20))
	if err != nil {
		return nil, "", fmt.Errorf("读取本地语音结果失败: %w", err)
	}
	segments, detected, err := transcription.DecodeVerboseJSON(payload)
	if err != nil {
		return nil, "", err
	}
	if len(segments) == 0 {
		return nil, "", fmt.Errorf("本地语音引擎未识别出对白")
	}
	return segments, detected, nil
}
