package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) SetGeneratedVideoOutputDir(directory string) {
	s.generatedVideoOutputDir = strings.TrimSpace(directory)
}

func (s *Service) exportGeneratedVideo(resource *model.Resource) error {
	if !s.IsLocalMode() || s.generatedVideoOutputDir == "" || resource == nil || resource.Kind != "video" || resource.Provider != "local" {
		return nil
	}
	if resource.ID == "" || strings.ContainsAny(resource.ID, "/\\:") || strings.Contains(resource.ID, "..") {
		return fmt.Errorf("无效的视频资源 ID")
	}
	source, err := localasset.NewFileStore(s.dataDir).Open(resource.ObjectKey)
	if err != nil {
		return err
	}
	defer source.Close()
	if err := os.MkdirAll(s.generatedVideoOutputDir, 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(s.generatedVideoOutputDir, ".eggfans-video-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
	}()
	written, err := io.Copy(temporary, source)
	if err != nil {
		return err
	}
	if written != resource.Size {
		return fmt.Errorf("视频原件不完整：预期 %d 字节，读取 %d 字节", resource.Size, written)
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	fileName := "video-" + resource.ID + resourceFileExtension(resource.ObjectKey, resource.MimeType, "video")
	return os.Rename(temporaryPath, filepath.Join(s.generatedVideoOutputDir, fileName))
}
