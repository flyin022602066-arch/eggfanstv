package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
)

func TestProtocolNativeFaceMapsTaskConfigToSD2Only(t *testing.T) {
	for _, test := range []struct {
		name, mode, iface, value, model string
		want                            bool
	}{
		{"enabled A", "video", "eggfans-sd2-video", "true", "sd-2.5-A", true},
		{"enabled C", "video", "eggfans-sd2-video", "true", "sd-2.5-C", true},
		{"enabled B", "video", "eggfans-sd2-video", "true", "sd-2.5-B", true},
		{"enabled D", "video", "eggfans-sd2-video", "true", "sd-2.5-D", true},
		{"enabled E", "video", "eggfans-sd2-video", "true", "sd-2.5-E", true},
		{"disabled D", "video", "eggfans-sd2-video", "false", "sd-2.5-D", false},
		{"absent D", "video", "eggfans-sd2-video", "", "sd-2.5-D", false},
		{"disabled", "video", "eggfans-sd2-video", "false", "sd-2.5-C", false},
		{"absent", "video", "eggfans-sd2-video", "", "sd-2.5-C", false},
		{"seedance isolated", "video", "eggfans-seedance-video", "true", "sd-2.5-C", false},
		{"other video isolated", "video", "xai-video", "true", "sd-2.5-C", false},
		{"image isolated", "image", "eggfans-sd2-video", "true", "sd-2.5-C", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(map[string]any{"mode": test.mode, "config": map[string]any{"model": test.model, "interfaceType": test.iface, "videoNativeFace": test.value}, "referenceImages": []providerMedia{{URL: "https://cdn.example/reference.png"}}})
			if err != nil {
				t.Fatal(err)
			}
			var input canvasGenerationInput
			if err := json.Unmarshal(data, &input); err != nil {
				t.Fatal(err)
			}
			request := protocolRequestFromInput(input)
			if request.NativeFace != test.want {
				t.Fatalf("NativeFace = %v, want %v", request.NativeFace, test.want)
			}
			if test.iface != "eggfans-sd2-video" || test.mode != "video" {
				return
			}
			adapter := officialSourceProviderAdapter(t, "eggfans-sd2-video", "eggfans-sd2-video")
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := marshalProtocolBody(t, spec.Body)
			value, exists := body["native_face"]
			if exists != test.want || (exists && value != true) {
				t.Fatalf("native_face = %#v, exists = %v, want enabled = %v", value, exists, test.want)
			}
		})
	}
}

func TestProtocolNativeFacePackagedRuntimeSupportsEverySD2Model(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	adapter, ok := center.registrySnapshot().Resolve("eggfans-sd2-video")
	if !ok {
		t.Fatal("packaged SD2 provider missing")
	}
	for _, modelName := range []string{"sd-2.5-A", "sd-2.5-B", "sd-2.5-C", "sd-2.5-D", "sd-2.5-E"} {
		for _, enabled := range []bool{true, false} {
			request := protocol.GenerationRequest{Capability: protocol.Capability("video"), Model: modelName, Prompt: "fixture", NativeFace: enabled, Images: []protocol.MediaReference{{URL: "https://cdn.example/reference.png", Role: "reference_image"}}}
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := marshalProtocolBody(t, spec.Body)
			value, exists := body["native_face"]
			if exists != enabled || (exists && value != true) {
				t.Fatalf("%s: native_face = %#v, exists = %v, want enabled = %v", modelName, value, exists, enabled)
			}
		}
	}
}

func TestProtocolNativeFaceBooleanSurvivesGenerationConfig(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		var config generation.Config
		data, err := json.Marshal(map[string]any{"interfaceType": "eggfans-sd2-video", "face": enabled})
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, &config); err != nil {
			t.Fatal(err)
		}
		data, err = json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		var provider providerConfig
		if err := json.Unmarshal(data, &provider); err != nil {
			t.Fatal(err)
		}
		if provider.Face == nil || *provider.Face != enabled {
			t.Fatal("Boolean face was lost at generation boundary")
		}
	}
	for _, invalid := range []string{`{"face":"true"}`, `{"face":1}`, `{"face":{"enabled":true}}`} {
		var config generation.Config
		if json.Unmarshal([]byte(invalid), &config) == nil {
			t.Fatal("Non-boolean face was accepted")
		}
	}
}

func TestProtocolNativeFaceMockedPOST(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/videos" {
			t.Errorf("unexpected route: %s %s", request.Method, request.URL.Path)
		}
		received = nil
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"mock-sd2-task","status":"queued"}`))
	}))
	defer server.Close()
	for _, hasImage := range []bool{true, false} {
		var input canvasGenerationInput
		if err := json.Unmarshal([]byte(`{"mode":"video","config":{"interfaceType":"eggfans-sd2-video","model":"sd-2.5-D","videoSeconds":"6","face":true}}`), &input); err != nil {
			t.Fatal(err)
		}
		input.Config.BaseURL = server.URL
		input.Config.APIKey = "synthetic-key"
		if hasImage {
			input.ReferenceImages = []providerMedia{{URL: "https://cdn.example/reference.png"}}
		}
		adapter := officialSourceProviderAdapter(t, "eggfans-sd2-video", "eggfans-sd2-video")
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := executeProtocolRequest(context.Background(), input.Config, spec); err != nil {
			t.Fatal(err)
		}
		value, exists := received["native_face"]
		if exists != hasImage || (exists && value != true) {
			t.Fatalf("POST native_face = %#v, exists %v, want %v", value, exists, hasImage)
		}
		if _, exists := received["face"]; exists {
			t.Fatal("Internal face leaked into POST body")
		}
	}
}

func TestProtocolNativeFaceRequiresVisualReferences(t *testing.T) {
	for _, test := range []struct {
		name, mode, iface      string
		config                 map[string]any
		images, videos, audios []providerMedia
		metadata               map[string]any
		want                   bool
	}{
		{name: "image", config: map[string]any{"face": true}, images: []providerMedia{{ID: "image", URL: "https://cdn.example/image.png"}}, want: true},
		{name: "video", config: map[string]any{"face": true}, videos: []providerMedia{{URL: "https://cdn.example/video.mp4"}}, want: true},
		{name: "first frame", config: map[string]any{"face": true}, images: []providerMedia{{ID: "first", URL: "https://cdn.example/first.png"}}, metadata: map[string]any{"videoStartFrameNodeId": "first"}, want: true},
		{name: "last frame only", config: map[string]any{"face": true}, images: []providerMedia{{ID: "last", URL: "https://cdn.example/last.png"}}, metadata: map[string]any{"videoEndFrameNodeId": "last"}},
		{name: "text only", config: map[string]any{"face": true}},
		{name: "audio only", config: map[string]any{"face": true}, audios: []providerMedia{{URL: "https://cdn.example/audio.mp3"}}},
		{name: "empty image", config: map[string]any{"face": true}, images: []providerMedia{{ID: "image"}}},
		{name: "empty video", config: map[string]any{"face": true}, videos: []providerMedia{{}}},
		{name: "off overrides legacy", config: map[string]any{"face": false, "videoNativeFace": "true"}, images: []providerMedia{{URL: "https://cdn.example/image.png"}}},
		{name: "legacy image task", config: map[string]any{"videoNativeFace": "true"}, images: []providerMedia{{URL: "https://cdn.example/image.png"}}, want: true},
		{name: "legacy text task", config: map[string]any{"videoNativeFace": "true"}},
		{name: "jiasu isolated", iface: "jiasu-video", config: map[string]any{"face": true}, images: []providerMedia{{URL: "https://cdn.example/image.png"}}},
		{name: "seedance isolated", iface: "eggfans-seedance-video", config: map[string]any{"face": true}, images: []providerMedia{{URL: "https://cdn.example/image.png"}}},
		{name: "image mode isolated", mode: "image", config: map[string]any{"face": true}, images: []providerMedia{{URL: "https://cdn.example/image.png"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			mode, iface := test.mode, test.iface
			if mode == "" {
				mode = "video"
			}
			if iface == "" {
				iface = "eggfans-sd2-video"
			}
			test.config["interfaceType"] = iface
			test.config["model"] = "sd-2.5-D"
			data, err := json.Marshal(map[string]any{"mode": mode, "config": test.config, "referenceImages": test.images, "referenceVideos": test.videos, "referenceAudios": test.audios, "metadata": test.metadata})
			if err != nil {
				t.Fatal(err)
			}
			var input canvasGenerationInput
			if err := json.Unmarshal(data, &input); err != nil {
				t.Fatal(err)
			}
			request := protocolRequestFromInput(input)
			if request.NativeFace != test.want {
				t.Fatalf("NativeFace = %v, want %v", request.NativeFace, test.want)
			}
			if mode != "video" || iface != "eggfans-sd2-video" {
				return
			}
			adapter := officialSourceProviderAdapter(t, "eggfans-sd2-video", "eggfans-sd2-video")
			spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := marshalProtocolBody(t, spec.Body)
			value, exists := body["native_face"]
			if exists != test.want || (exists && value != true) {
				t.Fatalf("native_face = %#v, exists = %v, want %v", value, exists, test.want)
			}
			if _, exists := body["face"]; exists {
				t.Fatal("Internal face field leaked upstream")
			}
		})
	}
}
