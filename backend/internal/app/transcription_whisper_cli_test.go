package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestWhisperCLILocalBoundary(t *testing.T) {
	service := &Service{mode: serviceModeHosted, dataDir: t.TempDir()}
	if _, _, err := service.whisperCLIPaths(); err == nil {
		t.Fatal("hosted runtime must not execute a desktop binary")
	}
}

func TestWhisperCLIRealLocalSpeech(t *testing.T) {
	root := os.Getenv("CANVAS_EDITOR_TEST_ROOT")
	if root == "" {
		t.Skip("requires explicit local synthetic speech fixture")
	}
	t.Setenv(renderFfmpegEnv, filepath.Join(root, ".local", "tools", "ffmpeg", "ffmpeg.exe"))
	file, err := os.Open(filepath.Join(root, ".local", "cache", "editor-speech.wav"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cache := filepath.Join(root, ".local", "cache", "whisper-test")
	wav, cleanup, err := prepareWhisperWav(ctx, file, "audio/wav", cache)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if !strings.HasPrefix(wav, cache+string(os.PathSeparator)) {
		t.Fatal("temporary speech left project cache")
	}
	service := &Service{mode: serviceModeLocal, dataDir: filepath.Join(root, ".local", "EggfansTV")}
	segments, language, err := service.transcribeWhisperCLI(ctx, wav, "zh")
	if err != nil || language != "zh" || len(segments) == 0 {
		t.Fatalf("real transcript = %+v, %s, %v", segments, language, err)
	}
	var text strings.Builder
	for _, segment := range segments {
		text.WriteString(segment.Text)
	}
	if !strings.Contains(text.String(), "本地") || (!strings.Contains(text.String(), "视频") && !strings.Contains(text.String(), "視頻")) {
		t.Fatalf("speech was not recognized: %q", text.String())
	}
	t.Logf("local synthetic speech: %s", text.String())
	interrupted, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer stop()
	started := time.Now()
	if _, _, err := service.transcribeWhisperCLI(interrupted, wav, "zh"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("running cancellation = %v", err)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("CLI did not stop promptly")
	}
}

func TestWhisperCLIPathsAndCancellation(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".local", "EggfansTV")
	directory := filepath.Join(dataDir, "..", "tools", "whisper")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{whisperCLIName(), "ggml-base.bin"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	service := &Service{mode: serviceModeLocal, dataDir: dataDir}
	binary, model, err := service.whisperCLIPaths()
	if err != nil || binary != filepath.Clean(filepath.Join(directory, whisperCLIName())) || model != filepath.Clean(filepath.Join(directory, "ggml-base.bin")) {
		t.Fatalf("local dependency paths = %q, %q, %v", binary, model, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := service.transcribeWhisperCLI(ctx, "missing.wav", "auto"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled CLI = %v", err)
	}
}

func TestTimelineTranscriptionRealLocalTask(t *testing.T) {
	root := os.Getenv("CANVAS_EDITOR_TEST_ROOT")
	if root == "" {
		t.Skip("requires explicit local synthetic speech fixture")
	}
	t.Setenv(whisperLangEnv, "")
	t.Setenv(renderFfmpegEnv, filepath.Join(root, ".local", "tools", "ffmpeg", "ffmpeg.exe"))
	service, db := newTimelineTaskTestService(t)
	service.mode = serviceModeLocal
	service.dataDir = t.TempDir()
	resourceDir := filepath.Join(service.dataDir, "resources")
	if err := os.MkdirAll(resourceDir, 0700); err != nil {
		t.Fatal(err)
	}
	speech, err := os.ReadFile(filepath.Join(root, ".local", "cache", "editor-speech.wav"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resourceDir, "speech.wav"), speech, 0600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "synthetic-speech", UserID: "usr-timeline-test", Kind: "audio", Provider: "local", Status: model.ResourceStatusReady, MimeType: "audio/wav", ObjectKey: "speech.wav", Size: int64(len(speech))}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	task := seedRunningTimelineTask(t, db, `{"resourceId":"synthetic-speech","language":"zh"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := newTaskWorkerCoordinator(service).processTimelineTranscription(task, ctx); err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	var result timelineTranscriptionResult
	if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded || len(result.Segments) == 0 || result.Language != "zh" || !strings.Contains(result.SRT, "-->") {
		t.Fatalf("persisted transcript = %+v, %+v", stored, result)
	}
	entries, err := os.ReadDir(filepath.Join(service.dataDir, "cache", "whisper"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary media was not cleaned: %v, %v", entries, err)
	}
	expired := seedRunningTimelineTask(t, db, `{"resourceId":"synthetic-speech","language":"zh"}`)
	deadline, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	if err := newTaskWorkerCoordinator(service).processTimelineTranscription(expired, deadline); err != nil {
		t.Fatal(err)
	}
	stored = model.Task{}
	if err := db.First(&stored, "id = ?", expired.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed {
		t.Fatalf("expired transcription stuck: %s", stored.Status)
	}
}
