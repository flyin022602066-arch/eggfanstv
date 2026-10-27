package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopMediaToolsUseExecutableDirectory(t *testing.T) {
	root := t.TempDir()
	toolDirectory := filepath.Join(root, ".local", "tools", "ffmpeg")
	if err := os.MkdirAll(toolDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ffmpeg.exe", "ffprobe.exe"} {
		if err := os.WriteFile(filepath.Join(toolDirectory, name), []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	originalPath := filepath.Join(t.TempDir(), "other-tools")
	t.Setenv("PATH", originalPath)
	t.Chdir(t.TempDir())
	for _, executable := range []string{
		filepath.Join(root, "EggfansTV.exe"),
		filepath.Join(root, "release", "EggfansTV.exe"),
	} {
		if err := configureDesktopMediaTools(executable); err != nil {
			t.Fatal(err)
		}
		entries := filepath.SplitList(os.Getenv("PATH"))
		if len(entries) != 2 || entries[0] != toolDirectory || entries[1] != originalPath {
			t.Fatalf("media tools were not resolved from executable: %q", entries)
		}
	}
}

func TestDesktopMediaToolsIgnoreIncompleteBundle(t *testing.T) {
	root := t.TempDir()
	toolDirectory := filepath.Join(root, ".local", "tools", "ffmpeg")
	if err := os.MkdirAll(toolDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(toolDirectory, "ffmpeg.exe"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	originalPath := filepath.Join(t.TempDir(), "other-tools")
	t.Setenv("PATH", originalPath)
	if err := configureDesktopMediaTools(filepath.Join(root, "EggfansTV.exe")); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("PATH"); got != originalPath {
		t.Fatalf("incomplete bundle changed PATH: %q", got)
	}
}
