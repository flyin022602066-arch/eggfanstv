package app

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"reflect"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestEggfansImageGenerationFormat(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "openai-images", "openai-image")
	for _, baseURL := range []string{"https://api.eggfans.com", "https://api.eggfans.org/v1/"} {
		for _, modelName := range []string{"gpt-image-2", "gpt-image-2-c", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst-c"} {
			t.Run(baseURL+"/"+modelName, func(t *testing.T) {
				config := providerConfig{BaseURL: baseURL, InterfaceType: "openai-image", Model: modelName, Size: "3840x2160", Quality: "high"}
				spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{BaseURL: baseURL, Request: protocolRequestFromInput(canvasGenerationInput{Mode: "image", Prompt: "fixture", Config: config})})
				if err != nil {
					t.Fatal(err)
				}
				original := marshalProtocolBody(t, spec.Body)
				reader, contentType, err := protocolRequestBody(context.Background(), config, spec)
				if err != nil || contentType != "application/json" {
					t.Fatalf("contentType=%q err=%v", contentType, err)
				}
				var body map[string]any
				if err := json.NewDecoder(reader).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body["format"] != "png" || body["output_format"] != nil {
					t.Fatalf("unexpected generation format: %#v", body)
				}
				if body["moderation"] != "low" {
					t.Fatalf("missing low moderation default: %#v", body)
				}
				if body["size"] != "3840x2160" || body["quality"] != "high" || body["model"] != modelName {
					t.Fatalf("generation parameters changed: %#v", body)
				}
				if !reflect.DeepEqual(original, marshalProtocolBody(t, spec.Body)) {
					t.Fatal("adapter body was mutated")
				}
			})
		}
	}
}

func TestEggfansImageFormatIsolation(t *testing.T) {
	for _, fixture := range []struct {
		baseURL, modelName, iface, path, method string
	}{
		{"https://api.openai.com", "gpt-image-2", "openai-image", "/v1/images/generations", "POST"},
		{"https://api.eggfans.com.example.org", "gpt-image-2", "openai-image", "/v1/images/generations", "POST"},
		{"https://api.eggfans.com", "gpt-image-1", "openai-image", "/v1/images/generations", "POST"},
		{"https://api.eggfans.com", "gpt-image-20", "openai-image", "/v1/images/generations", "POST"},
		{"https://api.eggfans.com", "gpt-image-2", "grok-image", "/v1/images/generations", "POST"},
		{"https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/images/edits", "POST"},
		{"https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/videos", "POST"},
		{"https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/images/generations", "GET"},
	} {
		config := providerConfig{BaseURL: fixture.baseURL, Model: fixture.modelName, InterfaceType: fixture.iface}
		spec := protocol.RequestSpec{Method: fixture.method, Path: fixture.path, ContentType: "application/json", Body: map[string]any{"output_format": "webp", "size": "3840x2160"}}
		reader, _, err := protocolRequestBody(context.Background(), config, spec)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.NewDecoder(reader).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["output_format"] != "webp" || body["format"] != nil {
			t.Fatalf("unrelated request changed for %+v: %#v", fixture, body)
		}
	}
}

func TestEggfansImageEditPreservesMultipart(t *testing.T) {
	adapter := officialSourceProviderAdapter(t, "openai-images", "openai-image")
	request := protocol.GenerationRequest{Capability: protocol.CapabilityImage, Model: "gpt-image-2", Prompt: "fixture", AspectRatio: "3840x2160", Quality: "high", Images: []protocol.MediaReference{
		{DataURL: "data:image/png;base64,aW1hZ2U=", Role: "reference_image"},
		{DataURL: "data:image/png;base64,bWFzaw==", Role: "mask"},
	}}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/images/edits" || spec.ContentType != "multipart/form-data" || len(spec.Files) != 2 {
		t.Fatalf("invalid edit contract: %+v", spec)
	}
	reader, contentType, err := protocolRequestBody(context.Background(), providerConfig{BaseURL: "https://api.eggfans.com", Model: request.Model, InterfaceType: "openai-image"}, spec)
	if err != nil {
		t.Fatal(err)
	}
	mediaType, parameters, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" {
		t.Fatalf("invalid edit encoding %q: %v", contentType, err)
	}
	form, err := multipart.NewReader(reader, parameters["boundary"]).ReadForm(1024 * 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer form.RemoveAll()
	if !reflect.DeepEqual(form.Value["moderation"], []string{"low"}) {
		t.Fatalf("missing low moderation default in edit: %#v", form.Value)
	}
	if !reflect.DeepEqual(form.Value["size"], []string{"3840x2160"}) || !reflect.DeepEqual(form.Value["quality"], []string{"high"}) {
		t.Fatalf("edit size or quality changed: %#v", form.Value)
	}
	for field, want := range map[string]string{"image": "image", "mask": "mask"} {
		if len(form.File[field]) != 1 {
			t.Fatalf("missing %s file", field)
		}
		file, err := form.File[field][0].Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(file)
		file.Close()
		if readErr != nil || string(data) != want {
			t.Fatalf("%s bytes changed: %q, %v", field, data, readErr)
		}
	}
}

func TestEggfansImageModerationDefaultsAndIsolation(t *testing.T) {
	for _, fixture := range []struct {
		name, baseURL, modelName, iface, path, method, configured, want string
	}{
		{"generation", "https://api.eggfans.com", "gpt-image-2", "openai-image", "/images/generations", "POST", "", "low"},
		{"edit", "https://api.eggfans.org/v1/", "gpt-image-2-all", "openai-image", "/v1/images/edits", "POST", "", "low"},
		{"2.5", "https://api.eggfans.com", "gpt-image-2.5-flare", "openai-image", "/v1/images/generations", "POST", "", "low"},
		{"explicit", "https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/images/generations", "POST", "auto", "auto"},
		{"other host", "https://api.openai.com", "gpt-image-2", "openai-image", "/v1/images/generations", "POST", "", ""},
		{"similar host", "https://api.eggfans.com.example.org", "gpt-image-2", "openai-image", "/v1/images/generations", "POST", "", ""},
		{"other model", "https://api.eggfans.com", "gpt-image-1", "openai-image", "/v1/images/generations", "POST", "", ""},
		{"similar model", "https://api.eggfans.com", "gpt-image-20", "openai-image", "/v1/images/generations", "POST", "", ""},
		{"other protocol", "https://api.eggfans.com", "gpt-image-2", "grok-image", "/v1/images/generations", "POST", "", ""},
		{"video", "https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/videos", "POST", "", ""},
		{"query", "https://api.eggfans.com", "gpt-image-2", "openai-image", "/v1/images/generations", "GET", "", ""},
	} {
		for _, encoding := range []string{"application/json", "multipart/form-data"} {
			t.Run(fixture.name+"/"+encoding, func(t *testing.T) {
				body := map[string]any{"size": "3840x2160", "quality": "high"}
				if fixture.configured != "" {
					body["moderation"] = fixture.configured
				}
				original := marshalProtocolBody(t, body)
				spec := protocol.RequestSpec{Method: fixture.method, Path: fixture.path, ContentType: encoding, Body: body}
				config := providerConfig{BaseURL: fixture.baseURL, Model: fixture.modelName, InterfaceType: fixture.iface}
				reader, contentType, err := protocolRequestBody(context.Background(), config, spec)
				if err != nil {
					t.Fatal(err)
				}
				got := ""
				if encoding == "application/json" {
					var payload map[string]any
					if err := json.NewDecoder(reader).Decode(&payload); err != nil {
						t.Fatal(err)
					}
					got, _ = payload["moderation"].(string)
				} else {
					_, parameters, err := mime.ParseMediaType(contentType)
					if err != nil {
						t.Fatal(err)
					}
					form, err := multipart.NewReader(reader, parameters["boundary"]).ReadForm(1024 * 1024)
					if err != nil {
						t.Fatal(err)
					}
					defer form.RemoveAll()
					if values := form.Value["moderation"]; len(values) > 0 {
						got = values[0]
					}
				}
				if got != fixture.want {
					t.Fatalf("moderation=%q, want %q", got, fixture.want)
				}
				if !reflect.DeepEqual(original, marshalProtocolBody(t, spec.Body)) {
					t.Fatal("adapter body was mutated")
				}
			})
		}
	}
}
