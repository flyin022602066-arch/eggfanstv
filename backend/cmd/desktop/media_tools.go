package main

import (
	"os"
	"path/filepath"
	"strings"
)

func configureDesktopMediaTools(executable string) error {
	executable, err := filepath.Abs(executable)
	if err != nil {
		return err
	}
	for directory, count := filepath.Dir(executable), 0; count < 7; directory, count = filepath.Dir(directory), count+1 {
		toolDirectory := filepath.Join(directory, ".local", "tools", "ffmpeg")
		if info, err := os.Stat(toolDirectory); err != nil || !info.IsDir() {
			continue
		}
		complete := true
		for _, name := range []string{"ffmpeg.exe", "ffprobe.exe"} {
			info, err := os.Stat(filepath.Join(toolDirectory, name))
			if err != nil || info.IsDir() || info.Size() == 0 {
				complete = false
				break
			}
		}
		if !complete {
			return nil
		}
		currentPath := os.Getenv("PATH")
		for _, entry := range filepath.SplitList(currentPath) {
			if strings.EqualFold(filepath.Clean(entry), toolDirectory) {
				return nil
			}
		}
		if currentPath != "" {
			toolDirectory += string(os.PathListSeparator) + currentPath
		}
		return os.Setenv("PATH", toolDirectory)
	}
	return nil
}
