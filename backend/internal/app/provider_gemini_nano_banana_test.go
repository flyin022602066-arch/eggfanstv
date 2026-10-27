package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/protocol"
)

func TestNanoBananaPackagedImageRequest(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	adapter, ok := center.registrySnapshot().Resolve("gemini-image")
	if !ok {
		t.Fatal("packaged Gemini image provider missing")
	}
	for _, level := range []string{"", "minimal", "high"} {
		input := canvasGenerationInput{Mode: "image", Prompt: "edit fixture", Config: providerConfig{InterfaceType: "gemini-image", Model: "gemini-nano-banana-2.1", Size: "1:8", Quality: "4k", ImageThinkingLevel: level}, ReferenceImages: []providerMedia{{DataURL: "data:image/png;base64,aW1hZ2Ux"}, {DataURL: "data:image/webp;base64,aW1hZ2Uy"}}}
		encoded, err := json.Marshal(input.Config)
		if err != nil {
			t.Fatal(err)
		}
		var taskConfig generation.Config
		if err := json.Unmarshal(encoded, &taskConfig); err != nil {
			t.Fatal(err)
		}
		encoded, err = json.Marshal(taskConfig)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &input.Config); err != nil {
			t.Fatal(err)
		}
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		reader, _, err := protocolRequestBody(context.Background(), input.Config, spec)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		config := body["generationConfig"].(map[string]any)
		image := config["imageConfig"].(map[string]any)
		if image["imageSize"] != "4K" || image["aspectRatio"] != "1:8" {
			t.Fatalf("invalid imageConfig: %#v", image)
		}
		thinking, exists := config["thinkingConfig"]
		if exists != (level != "") || (exists && thinking.(map[string]any)["thinkingLevel"] != level) {
			t.Fatalf("invalid thinkingConfig: %#v", thinking)
		}
		for _, forbidden := range []string{"thinkingBudget", "negativePrompt", "output_format", "candidateCount"} {
			if strings.Contains(string(raw), forbidden) {
				t.Fatalf("unexpected field %s", forbidden)
			}
		}
		parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		if len(parts) != 3 || parts[0].(map[string]any)["text"] != "edit fixture" || parts[1].(map[string]any)["inlineData"].(map[string]any)["data"] != "aW1hZ2Ux" || parts[2].(map[string]any)["inlineData"].(map[string]any)["mimeType"] != "image/webp" {
			t.Fatalf("invalid reference image parts: %#v", parts)
		}
		for _, baseURL := range []string{"https://api.eggfans.com", "https://api.eggfans.com/v1", "https://api.eggfans.org/v1beta/"} {
			config := input.Config
			config.BaseURL, config.APIKey = baseURL, "synthetic-test-key"
			address, err := protocolRequestURL(config.BaseURL, spec)
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequest(http.MethodPost, address, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := applyProtocolAuth(request, config, spec.Auth); err != nil {
				t.Fatal(err)
			}
			if request.URL.Path != "/v1beta/models/gemini-nano-banana-2.1:generateContent" || request.Header.Get("Authorization") != "Bearer synthetic-test-key" {
				t.Fatalf("wrong path or authentication for %s", baseURL)
			}
		}
	}
}

func TestNanoBananaCapabilityAndIsolation(t *testing.T) {
	profile := DefaultImageCapabilityConfig("gemini-image", "gemini-nano-banana-2.1")
	if len(profile.Size.Values) != 15 || profile.References.MaskSupported || strings.Join(profile.Quality.Values, ",") != "1k,2k,4k" {
		t.Fatalf("incorrect Nano Banana capabilities: %#v", profile)
	}
	for _, ratio := range profile.Size.Values {
		input := canvasGenerationInput{Mode: "image", Config: providerConfig{Model: "gemini-nano-banana-2.1", InterfaceType: "gemini-image", Size: ratio, Quality: "4k"}}
		if err := validateImageTask(profile, input); err != nil {
			t.Fatalf("documented ratio %s rejected: %v", ratio, err)
		}
	}
	for _, name := range []string{"gemini-3.8-flash", "gpt-image-2", "gemini-nano-banana-2.10"} {
		if geminiNanoBananaThinkingConfig(providerConfig{Model: name, ImageThinkingLevel: "high"}) != nil {
			t.Fatalf("Nano Banana options leaked into %s", name)
		}
	}
	for _, name := range []string{"gemini-nano-banana-2.1-thinking", "gemini-nano-banana-2.1-nothinking"} {
		if !isGeminiNanoBananaModel(name) {
			t.Fatalf("documented suffix not recognized: %s", name)
		}
	}
	request, err := http.NewRequest(http.MethodPost, "https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyProtocolAuth(request, providerConfig{InterfaceType: "gemini-image", Model: "gemini-nano-banana-2.1", BaseURL: "https://generativelanguage.googleapis.com", APIKey: "synthetic-key"}, protocol.ManifestAuth{Type: "google-api-key", Field: "apiKey"}); err != nil {
		t.Fatal(err)
	}
	if request.Header.Get("x-goog-api-key") != "synthetic-key" || request.Header.Get("Authorization") != "" {
		t.Fatal("Eggfans authentication changed Google direct requests")
	}
}
