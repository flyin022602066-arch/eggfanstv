package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/bootstrap"
)

const maxArtifactStreamBytes int64 = 8 << 30
const maxArtifactChunkBytes = 1 << 20

type artifactStream struct {
	file        *os.File
	destination string
	size        int64
	written     int64
}

var artifactStreams = struct {
	sync.Mutex
	byApp map[*DesktopApp]map[string]*artifactStream
}{byApp: make(map[*DesktopApp]map[string]*artifactStream)}

func (a *DesktopApp) BeginOwnedArtifact(fileName string, size int64) (string, error) {
	if size <= 0 || size > maxArtifactStreamBytes {
		return "", errors.New("导出文件大小无效，单包最大支持 8GB")
	}
	ctx, err := a.dialogContext()
	if err != nil {
		return "", err
	}
	destination, err := a.promptSavePath(ctx, bootstrap.SanitizeSaveFileName(fileName))
	if err != nil || strings.TrimSpace(destination) == "" {
		return "", err
	}
	if ctx.Err() != nil {
		return "", errors.New("应用已关闭，无法保存文件")
	}
	artifactStreams.Lock()
	defer artifactStreams.Unlock()
	if _, err := a.dialogContext(); err != nil {
		return "", err
	}
	if len(artifactStreams.byApp[a]) > 0 {
		return "", errors.New("已有文件正在保存，请稍后再试")
	}
	identifier := make([]byte, 24)
	if _, err := rand.Read(identifier); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(filepath.Dir(destination), ".eggfans-export-*")
	if err != nil {
		return "", errors.New("无法写入所选位置")
	}
	id := hex.EncodeToString(identifier)
	artifactStreams.byApp[a] = map[string]*artifactStream{id: {file: file, destination: destination, size: size}}
	return id, nil
}

func (a *DesktopApp) AppendOwnedArtifact(id string, offset int64, data []byte) (bool, error) {
	if _, err := a.dialogContext(); err != nil {
		a.AbortOwnedArtifact(id)
		return false, err
	}
	artifactStreams.Lock()
	defer artifactStreams.Unlock()
	stream := artifactStreams.byApp[a][id]
	if stream == nil {
		return false, errors.New("导出会话已结束，请重新导出")
	}
	fail := func(err error) (bool, error) { removeArtifactStream(a, id); return false, err }
	if offset != stream.written || len(data) == 0 || len(data) > maxArtifactChunkBytes || int64(len(data)) > stream.size-stream.written {
		return fail(errors.New("导出数据分块不完整，请重新导出"))
	}
	written, err := stream.file.Write(data)
	if err != nil || written != len(data) {
		return fail(errors.New("无法写出文件，请检查磁盘空间"))
	}
	stream.written += int64(written)
	if stream.written != stream.size {
		return false, nil
	}
	if err := stream.file.Sync(); err != nil {
		return fail(err)
	}
	if err := stream.file.Close(); err != nil {
		return fail(err)
	}
	if err := os.Rename(stream.file.Name(), stream.destination); err != nil {
		return fail(errors.New("无法保存到所选位置"))
	}
	delete(artifactStreams.byApp[a], id)
	if len(artifactStreams.byApp[a]) == 0 {
		delete(artifactStreams.byApp, a)
	}
	return true, nil
}

func (a *DesktopApp) AbortOwnedArtifact(id string) {
	artifactStreams.Lock()
	defer artifactStreams.Unlock()
	removeArtifactStream(a, id)
}

func removeArtifactStream(app *DesktopApp, id string) {
	if stream := artifactStreams.byApp[app][id]; stream != nil {
		_ = stream.file.Close()
		_ = os.Remove(stream.file.Name())
		delete(artifactStreams.byApp[app], id)
	}
	if len(artifactStreams.byApp[app]) == 0 {
		delete(artifactStreams.byApp, app)
	}
}

func (a *DesktopApp) closeArtifactStreams() {
	artifactStreams.Lock()
	defer artifactStreams.Unlock()
	for id := range artifactStreams.byApp[a] {
		removeArtifactStream(a, id)
	}
}
