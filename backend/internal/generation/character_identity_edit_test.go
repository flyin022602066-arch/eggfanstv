package generation

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCharacterIdentityReferenceUsesImageEditWithOriginalBytes(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	original := []byte("base-character-image-original-bytes")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if request.Method != http.MethodPost || request.URL.Path != "/v1/images/edits" {
			t.Errorf("not an image edit: %s %s", request.Method, request.URL.Path)
		}
		if err := request.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			writer.WriteHeader(400)
			return
		}
		defer request.MultipartForm.RemoveAll()
		if request.FormValue("model") != "gpt-image-2" || request.FormValue("prompt") != "保留基础版五官，编辑为战斗服装" {
			t.Error("model or prompt changed")
		}
		files := request.MultipartForm.File["image"]
		if len(files) != 1 {
			t.Errorf("identity images = %d, want 1", len(files))
			writer.WriteHeader(400)
			return
		}
		file, err := files[0].Open()
		if err != nil {
			t.Error(err)
			writer.WriteHeader(400)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil || string(data) != string(original) {
			t.Error("base image bytes not preserved", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"data":[{"b64_json":"YQ=="}]}`)
	}))
	defer server.Close()
	result, err := RunImageTask(context.Background(), Input{Mode: "image", Prompt: "保留基础版五官，编辑为战斗服装", Config: Config{InterfaceType: "openai-image", Model: "gpt-image-2", BaseURL: server.URL + "/v1", APIKey: "fixture-only"}, ReferenceImages: []Media{{ID: "base", Name: "base.png", DataURL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(original)}}})
	if err != nil || result == nil || calls != 1 {
		t.Fatalf("calls=%d result=%v err=%v", calls, result, err)
	}
}
