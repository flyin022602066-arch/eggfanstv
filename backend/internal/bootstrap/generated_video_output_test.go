package bootstrap

import (
	"path/filepath"
	"testing"
)

func TestGeneratedVideoOutputDirectoryDefaults(t *testing.T) {
	root := t.TempDir()
	for _, scenario := range []struct {
		name       string
		dataDir    string
		configured string
		want       string
	}{
		{"desktop", filepath.Join(root, ".local", "EggfansTV"), "", filepath.Join(root, "output", "videos")},
		{"development", filepath.Join(root, ".local", "project-workbench-debug"), "", filepath.Join(root, "output", "videos")},
		{"isolated", filepath.Join(root, ".local", "cache", "隔离测试"), "", filepath.Join(root, ".local", "cache", "隔离测试", "output", "videos")},
		{"explicit", filepath.Join(root, ".local", "EggfansTV"), filepath.Join(root, "custom", "videos"), filepath.Join(root, "custom", "videos")},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := Config{DataDir: scenario.dataDir, GeneratedVideoOutputDir: scenario.configured}.withDefaults()
			if cfg.GeneratedVideoOutputDir != scenario.want {
				t.Fatalf("output = %q, want %q", cfg.GeneratedVideoOutputDir, scenario.want)
			}
		})
	}
}
