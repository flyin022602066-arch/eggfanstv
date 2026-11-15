package doubaobrowser

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRequestJSONAndValidation(t *testing.T) {
	request := Request{TaskID: "fixture", Model: "seedance_v2.0_std", Prompt: "fixture", Duration: 12, Ratio: "9:16", Images: []string{}}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var packet map[string]any
	_ = json.Unmarshal(body, &packet)
	if packet["taskId"] != "fixture" || packet["model"] != request.Model || packet["duration"] != float64(12) {
		t.Fatalf("invalid request JSON: %s", body)
	}
	if err := Validate(request); err != nil {
		t.Fatal(err)
	}
	request.Duration = 30
	if Validate(request) == nil {
		t.Fatal("2.0 must reject duration 30")
	}
	request.Model = "seedance_v2.5"
	if err := Validate(request); err != nil {
		t.Fatal(err)
	}
}

func TestPromptCharacterBoundary(t *testing.T) {
	for _, name := range []string{"seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini"} {
		request := Request{TaskID: "fixture", Model: name, Prompt: strings.Repeat("镜\U0001F3AC", 4000), Duration: 15, Ratio: "16:9", Images: []string{}}
		if err := Validate(request); err != nil {
			t.Fatalf("8000 characters rejected for %s: %v", name, err)
		}
		request.Prompt += "镜"
		if err := Validate(request); err == nil || !strings.Contains(err.Error(), "8000") {
			t.Fatalf("8001-character validation incorrect for %s: %v", name, err)
		}
	}
}

func TestStatusWorkerDoesNotLaunchBrowserAndIsolatesOwners(t *testing.T) {
	root := t.TempDir()
	service := New(root)
	defer service.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, user := range []string{"fixture-one", "fixture-two"} {
		status, err := service.Control(ctx, user, "status", nil)
		if err != nil {
			t.Fatal(err)
		}
		if status["enabled"] != false || status["total"] != float64(0) {
			t.Fatalf("unexpected initial status: %v", status)
		}
	}
	if _, err := service.Control(ctx, "", "status", nil); err == nil {
		t.Fatal("empty owner must fail")
	}
	entries, err := os.ReadDir(filepath.Join(root, "doubao-browser"))
	if err != nil || len(entries) != 2 {
		t.Fatalf("owners not isolated: %v %v", entries, err)
	}
	for _, entry := range entries {
		if _, err := os.Stat(filepath.Join(root, "doubao-browser", entry.Name(), "profiles")); !os.IsNotExist(err) {
			t.Fatal("read-only status created a browser profile")
		}
	}
	_, err = service.Submit(ctx, "fixture-one", Request{TaskID: "fixture", Model: "seedance_v2.0_std", Prompt: "fixture", Duration: 5, Ratio: "16:9", Images: []string{}})
	var before BeforeSubmitError
	if !errors.As(err, &before) {
		t.Fatalf("disabled pool must report a confirmed pre-generation failure: %v", err)
	}
}
