package doubaobrowser

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type disconnectedWriter struct {
	closed bool
	writes int
}

func (writer *disconnectedWriter) Write(body []byte) (int, error) {
	writer.writes++
	return len(body) / 2, io.ErrClosedPipe
}
func (writer *disconnectedWriter) Close() error { writer.closed = true; return nil }

func TestDisconnectedWorkerIsRetiredWithoutResubmitting(t *testing.T) {
	service := New(t.TempDir())
	writer := &disconnectedWriter{}
	current := &worker{in: writer, pending: map[int64]chan reply{}, done: make(chan struct{})}
	service.workers["owner"] = current
	_, err := service.Submit(context.Background(), "owner", Request{TaskID: "original", Model: "seedance_v2.0", Prompt: "fixture", Duration: 5, Ratio: "16:9", Images: []string{}})
	var before BeforeSubmitError
	if err == nil || errors.As(err, &before) || writer.writes != 1 || !writer.closed || service.workers["owner"] != nil || len(current.pending) != 0 {
		t.Fatalf("unsafe disconnect handling: %v, %#v", err, writer)
	}
}

func TestClosedWorkerLayerReportsConfirmedBeforeSubmission(t *testing.T) {
	service := New(t.TempDir())
	service.Close()
	_, err := service.Submit(context.Background(), "owner", Request{TaskID: "unsubmitted"})
	var before BeforeSubmitError
	if !errors.As(err, &before) {
		t.Fatalf("expected before-submit failure, got %v", err)
	}
}

func TestLookupReadsPersistedReceiptWithoutStartingWorker(t *testing.T) {
	service := New(t.TempDir())
	directory := filepath.Join(service.directory, fmt.Sprintf("%x", sha256.Sum256([]byte("owner"))))
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	body := `{"jobs":{"original":{"receipt":{"taskId":"original","profileId":"550e8400-e29b-41d4-a716-446655440000"}}}}`
	if err := os.WriteFile(filepath.Join(directory, "pool.json"), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	receipt, err := service.Lookup(context.Background(), "owner", "original")
	if err != nil || receipt.TaskID != "original" || len(service.workers) != 0 {
		t.Fatalf("lookup started worker or lost receipt: %+v %v", receipt, err)
	}
	_, err = service.Lookup(context.Background(), "owner", "missing")
	var missing ReceiptNotFoundError
	if !errors.As(err, &missing) || len(service.workers) != 0 {
		t.Fatalf("missing receipt did not return truthful local evidence: %v", err)
	}
}
