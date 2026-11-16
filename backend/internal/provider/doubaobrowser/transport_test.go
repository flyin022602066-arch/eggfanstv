package doubaobrowser

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type captureWriter struct{ packets chan []byte }

func (writer *captureWriter) Write(body []byte) (int, error) {
	writer.packets <- append([]byte(nil), body...)
	return len(body), nil
}
func (writer *captureWriter) Close() error { return nil }

func TestCancelledSubmissionKeepsStagedImagesUntilWorkerAcknowledges(t *testing.T) {
	service := New(t.TempDir())
	writer := &captureWriter{packets: make(chan []byte, 1)}
	current := &worker{in: writer, pending: map[int64]chan reply{}, done: make(chan struct{})}
	service.workers["owner"] = current
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := service.Submit(ctx, "owner", Request{TaskID: "fixture", Model: "seedance_v2.0", Prompt: "fixture", Duration: 5, Ratio: "16:9", Images: []string{"data:image/png;base64,aW1hZ2U="}})
		finished <- err
	}()
	var packet struct {
		ID     int64            `json:"id"`
		Params stagedSubmission `json:"params"`
	}
	select {
	case body := <-writer.packets:
		if err := json.Unmarshal(body, &packet); err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not receive request")
	}
	file := filepath.Join(service.ownerDirectory("owner"), filepath.FromSlash(packet.Params.Images[0].File))
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation blocked")
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("cancel deleted a live worker input: %v", err)
	}
	current.mu.Lock()
	pending := current.pending[packet.ID]
	current.mu.Unlock()
	if pending == nil {
		t.Fatal("worker completion abandoned")
	}
	pending <- reply{ID: packet.ID}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(file); os.IsNotExist(err) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("completed worker left staging files behind")
}

func TestSubmissionStagesOriginalImagesOutsideWorkerJSON(t *testing.T) {
	service := New(t.TempDir())
	data := strings.Repeat("original image", 1024)
	input := Request{TaskID: "fixture", Model: "seedance_v2.0", Prompt: "{{ref:1}} fixture", Duration: 5, Ratio: "16:9", Images: []string{"data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(data))}}
	wire, cleanup, err := service.prepareSubmission("owner-one", input)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) > 2048 || strings.Contains(string(body), "base64") {
		t.Fatalf("worker request contains image bodies: %d bytes", len(body))
	}
	file := filepath.Join(service.ownerDirectory("owner-one"), filepath.FromSlash(wire.Images[0].File))
	actual, err := os.ReadFile(file)
	if err != nil || string(actual) != data {
		t.Fatalf("original bytes changed: %v", err)
	}
	if strings.Contains(file, service.ownerDirectory("owner-two")) {
		t.Fatal("owner isolation lost")
	}
	cleanup()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("staged input not removed")
	}
}

func TestWorkerDiagnosticsExposeOnlySafeFailureCategory(t *testing.T) {
	log := &workerDiagnostics{}
	_, _ = log.Write([]byte("secret-key https://private.invalid/?token=secret\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"))
	reason := log.reason()
	if !strings.Contains(reason, "内存") || strings.Contains(reason, "secret") || strings.Contains(reason, "private") {
		t.Fatalf("unsafe or missing worker diagnostic: %q", reason)
	}
}
