package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func artifactStreamApp(t *testing.T) (*DesktopApp, string) {
	t.Helper()
	directory := t.TempDir()
	destination := filepath.Join(directory, "工作流资产.zip")
	app := newDesktopApp(directory)
	app.wailsCtx = context.Background()
	app.chooseSavePath = func(context.Context, string) (string, error) { return destination, nil }
	t.Cleanup(app.closeArtifactStreams)
	return app, destination
}

func TestOwnedArtifactStreamSavesBeyond32MB(t *testing.T) {
	app, destination := artifactStreamApp(t)
	chunk := bytes.Repeat([]byte{41}, maxArtifactChunkBytes)
	size := int64(len(chunk)) * 33
	id, err := app.BeginOwnedArtifact("资产.zip", size)
	if err != nil {
		t.Fatal(err)
	}
	for index := int64(0); index < 33; index++ {
		done, err := app.AppendOwnedArtifact(id, index*int64(len(chunk)), chunk)
		if err != nil || done != (index == 32) {
			t.Fatalf("chunk %d: done=%v error=%v", index, done, err)
		}
	}
	body, err := os.ReadFile(destination)
	if err != nil || int64(len(body)) != size || !bytes.Equal(body[len(body)-len(chunk):], chunk) {
		t.Fatalf("incomplete export: %v", err)
	}
}

func TestOwnedArtifactStreamKeepsExistingFileOnInvalidChunk(t *testing.T) {
	app, destination := artifactStreamApp(t)
	if err := os.WriteFile(destination, []byte("previous"), 0600); err != nil {
		t.Fatal(err)
	}
	id, err := app.BeginOwnedArtifact("资产.zip", 8)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.AppendOwnedArtifact(id, 1, []byte("partial")); err == nil {
		t.Fatal("accepted missing chunk")
	}
	body, _ := os.ReadFile(destination)
	if string(body) != "previous" {
		t.Fatal("existing export was overwritten")
	}
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(destination), ".eggfans-export-*"))
	if len(matches) != 0 {
		t.Fatal("partial export was not removed")
	}
}

func TestOwnedArtifactStreamCancelAndShutdownCleanFiles(t *testing.T) {
	app, destination := artifactStreamApp(t)
	app.chooseSavePath = func(context.Context, string) (string, error) { return "", nil }
	if id, err := app.BeginOwnedArtifact("资产.zip", 8); id != "" || err != nil {
		t.Fatalf("cancel: %s %v", id, err)
	}
	app.chooseSavePath = func(context.Context, string) (string, error) { return destination, nil }
	id, err := app.BeginOwnedArtifact("资产.zip", 8)
	if err != nil {
		t.Fatal(err)
	}
	app.AbortOwnedArtifact(id)
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("cancel created final file")
	}
	if _, err := app.BeginOwnedArtifact("资产.zip", 8); err != nil {
		t.Fatal(err)
	}
	app.shutdown(context.Background())
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(destination), ".eggfans-export-*"))
	if len(matches) != 0 {
		t.Fatal("shutdown left partial export")
	}
}

func TestOwnedArtifactStreamRejectsOversizedAndForeignSessions(t *testing.T) {
	app, _ := artifactStreamApp(t)
	if _, err := app.BeginOwnedArtifact("资产.zip", maxArtifactStreamBytes+1); err == nil {
		t.Fatal("accepted oversized export")
	}
	id, err := app.BeginOwnedArtifact("资产.zip", 4)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := artifactStreamApp(t)
	if _, err := other.AppendOwnedArtifact(id, 0, []byte("data")); err == nil {
		t.Fatal("accepted a foreign export session")
	}
	if done, err := app.AppendOwnedArtifact(id, 0, []byte("data")); !done || err != nil {
		t.Fatalf("owner could not finish export: %v", err)
	}
}
