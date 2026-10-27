package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func TestSunoMusicSubmitPollAllSongsAndResume(t *testing.T) {
	creates, polls := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/suno/submit/music":
			creates++
			if request.Header.Get("Authorization") != "Bearer fixture-key" || request.Header.Get("X-Fixture") != "isolated" {
				t.Error("missing channel auth or custom header")
			}
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			if body["mv"] != "chirp-v5-5" || body["gpt_description_prompt"] != "原创钢琴" || body["make_instrumental"] != true || body["voice"] != nil || body["model"] != nil {
				t.Errorf("invalid Suno payload %#v", body)
			}
			_, _ = writer.Write([]byte(`{"code":"success","data":"1268154180129529857"}`))
		case "/suno/fetch/1268154180129529857":
			polls++
			if polls == 1 {
				_, _ = writer.Write([]byte(`{"code":"success","data":{"status":"processing","task_id":"1268154180129529857"}}`))
				return
			}
			clips, _ := json.Marshal([]any{map[string]any{"id": "a", "audio_url": server.URL + "/a.mp3", "title": "一"}, map[string]any{"id": "b", "audio_url": server.URL + "/b.mp3", "title": "二"}})
			_ = json.NewEncoder(writer).Encode(map[string]any{"code": "success", "data": map[string]any{"status": "success", "task_id": "1268154180129529857", "data": base64.StdEncoding.EncodeToString(clips)}})
		case "/a.mp3", "/b.mp3":
			writer.Header().Set("Content-Type", "audio/mpeg")
			_, _ = writer.Write(append([]byte("ID3"), make([]byte, 64)...))
		default:
			t.Errorf("unexpected route %s", request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	input := canvasGenerationInput{Mode: "audio", Prompt: "原创钢琴", Config: providerConfig{Model: "suno_music_open", InterfaceType: "openai-audio", BaseURL: server.URL + "/v1", APIKey: "fixture-key", Headers: []OutboundHeader{{Name: "X-Fixture", Value: "isolated"}}, AudioSunoParams: `{"mode":"description","mv":"chirp-v5-5","make_instrumental":true}`}}
	result, err := runSunoAudioTaskWithPolicy(context.Background(), input, fastVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if creates != 1 || polls != 2 || len(result["audios"].([]interface{})) != 2 {
		t.Fatalf("lost songs or wrong request counts: %#v", result)
	}
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: "1268154180129529857"})
	if _, err := runSunoAudioTaskWithPolicy(ctx, input, fastVideoPollPolicy()); err != nil {
		t.Fatal(err)
	}
	if creates != 1 {
		t.Fatal("resuming a paid task submitted again")
	}
}

func TestSunoBusinessFailureAndFalseAudio(t *testing.T) {
	for _, raw := range []string{`{"code":401,"msg":"401"}`, `{"code":"success","data":{"status":"failed","fail_reason":"fixture rejected"}}`} {
		if _, err := parseSunoState([]byte(raw)); err == nil {
			t.Fatalf("accepted failure %s", raw)
		}
	}
	result := &protocol.Result{Audios: []protocol.MediaReference{{DataURL: dataURL("audio/mpeg", []byte(`{"msg":"401","code":401}`)), MIMEType: "audio/mpeg"}}}
	if _, err := finishProtocolResult(context.Background(), providerConfig{AudioFormat: "mp3"}, "audio", "", result, videoPollPolicy{}); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("JSON error accepted as playable audio: %v", err)
	}
}

func TestSunoAcceptedIDCheckpointAndConfigBoundary(t *testing.T) {
	log := &model.ApiCallLog{Capability: "audio", Path: "/suno/submit/music", Status: model.ApiCallStatusSucceeded}
	(&Service{}).EnrichAPICallLog(log, []byte(`{"code":"success","data":"1268154180129529857"}`))
	if log.ProviderRequestID != "1268154180129529857" {
		t.Fatalf("lost accepted task ID: %#v", log)
	}
	if providerRequestIDFromPath("/suno/fetch/1268154180129529857") != log.ProviderRequestID {
		t.Fatal("poll ID missing")
	}
	raw, _ := json.Marshal(generation.Config{AudioSunoParams: `{"mv":"chirp-v6","prompt":"fixture"}`})
	var config providerConfig
	if err := json.Unmarshal(raw, &config); err != nil || config.AudioSunoParams != `{"mv":"chirp-v6","prompt":"fixture"}` {
		t.Fatal("Suno parameters lost across task boundary")
	}
}

func TestSunoSongsPersistOnceWithPrimaryTrackBinding(t *testing.T) {
	service := newResourceTestService(t)
	service.localResourceStorage = true
	tracks := make([]interface{}, 0, 2)
	for _, clipID := range []string{"song-a", "song-b"} {
		tracks = append(tracks, map[string]interface{}{"clipId": clipID, "dataUrl": dataURL("audio/mpeg", append([]byte("ID3"+clipID), make([]byte, 64)...)), "mimeType": "audio/mpeg"})
	}
	stored, err := service.persistGeneratedMediaResult("user-1", map[string]interface{}{"mode": "audio", "audio": tracks[0], "audios": tracks})
	if err != nil {
		t.Fatal(err)
	}
	resources, err := service.repo.Resources("user-1", 10)
	if err != nil || len(resources) != 2 {
		t.Fatalf("stored %d resources for two songs: %v", len(resources), err)
	}
	clips := stored["audios"].([]interface{})
	if stringField(stored["audio"].(map[string]interface{}), "storageKey") != stringField(clips[0].(map[string]interface{}), "storageKey") {
		t.Fatal("primary audio is not the first selectable track")
	}
	for index, item := range clips {
		clip := item.(map[string]interface{})
		resource, err := service.repo.ResourceForUser("user-1", strings.TrimPrefix(stringField(clip, "storageKey"), "resource:"))
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
		if err != nil || !bytes.Equal(data, append([]byte("ID3"+[]string{"song-a", "song-b"}[index]), make([]byte, 64)...)) {
			t.Fatalf("song bytes changed: %v", err)
		}
	}
}
