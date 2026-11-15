package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectWorkspaceDataDirUsesLauncherRoot(t *testing.T) {
	projectDir := filepath.Join(t.TempDir(), "Eggfans TV project")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "run-eggfans-tv.cmd"), []byte("@echo off\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(projectDir, ".local", "EggfansTV")
	for _, executable := range []string{
		filepath.Join(projectDir, "backend", "cmd", "desktop", "build", "bin", "EggfansTV.exe"),
		filepath.Join(projectDir, "installed", "EggfansTV-v1.6.7-windows-amd64", "EggfansTV.exe"),
	} {
		if got := projectWorkspaceDataDir(executable); got != want {
			t.Fatalf("project workspace for %q = %q, want %q", executable, got, want)
		}
	}
}

func TestProjectWorkspaceDataDirDoesNotUseWorkingDirectory(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectDir, "run-eggfans-tv.cmd"), []byte("@echo off\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(projectDir)
	executable := filepath.Join(t.TempDir(), "standalone", "EggfansTV.exe")
	if got := projectWorkspaceDataDir(executable); got != "" {
		t.Fatalf("standalone executable used working directory: %q", got)
	}
}

func TestDesktopDoubaoOutputRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "run-eggfans-tv.cmd"), []byte("@echo off"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := desktopDoubaoOutputDir(filepath.Join(root, "backend", "cmd", "desktop", "build", "bin", "EggfansTV.exe")); got != filepath.Join(root, "output") {
		t.Fatalf("project output: %s", got)
	}
	installed := filepath.Join(t.TempDir(), "installed eggfansTV", "EggfansTV.exe")
	if got := desktopDoubaoOutputDir(installed); got != filepath.Join(filepath.Dir(installed), "output") {
		t.Fatalf("installed output: %s", got)
	}
}

func TestWebviewUserDataDirIsOutsideExecutablePath(t *testing.T) {
	dataDir := filepath.Join(`S:\project\eggfans beeftv`, ".local", "EggfansTV")
	got := filepath.Join(dataDir, "webview2")
	if got == filepath.Join(`S:\project\eggfans beeftv`, "backend", "cmd", "desktop", "build", "bin", "EggfansTV.exe", "EBWebView") {
		t.Fatalf("WebView2 data directory must not be nested under executable: %q", got)
	}
	if filepath.Ext(got) != "" {
		t.Fatalf("WebView2 data directory unexpectedly has a file extension: %q", got)
	}
}
