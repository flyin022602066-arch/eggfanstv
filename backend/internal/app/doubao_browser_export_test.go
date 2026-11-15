package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestDoubaoBrowserArchiveProjectEpisodeAndLocalRecovery(t *testing.T) {
	root := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), root)
	defer svc.Close()
	output := filepath.Join(root, "output")
	svc.SetDoubaoBrowserOutputDir(output)
	for _, row := range []any{&model.Project{ID: "project-1", UserID: "owner", Name: "黄金/青石巷"}, &model.ProjectUnit{ID: "episode-1", ProjectID: "project-1", Title: "第01集：相遇"}, &model.Shot{ID: "shot-1", ProjectID: "project-1", UnitID: "episode-1", Title: "镜头01"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	task := model.Task{ID: "archive-task", UserID: "owner", ProjectID: "project-1", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", InputJSON: `{"config":{"interfaceType":"doubao-browser-video"},"metadata":{"domainProjectId":"project-1","shotId":"shot-1"}}`}
	// A blocked output directory must retain the downloaded original for local-only retry.
	if err := os.WriteFile(output, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	original := []byte("downloaded original video bytes")
	_, err = svc.persistTaskGeneratedMediaResult(task, map[string]any{"mode": "video", "video": map[string]any{"dataUrl": "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(original)}})
	if err == nil {
		t.Fatal("archive failure was hidden")
	}
	marker := filepath.Join(root, "doubao-browser", fmt.Sprintf("%x", sha256.Sum256([]byte(task.UserID))), "deliveries", task.ID+".json")
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("undelivered video environment was released")
	}
	if err := os.Remove(output); err != nil {
		t.Fatal(err)
	}
	result, recovered, err := svc.recoverDoubaoBrowserArchive(task)
	if err != nil || !recovered {
		t.Fatalf("local recovery failed: %v %v", recovered, err)
	}
	markerBody, err := os.ReadFile(marker)
	if err != nil {
		t.Fatalf("delivered video has no environment release marker: %v", err)
	}
	var delivered map[string]any
	if json.Unmarshal(markerBody, &delivered) != nil || delivered["taskId"] != task.ID || delivered["delivered"] != true {
		t.Fatal("invalid local delivery marker")
	}
	video := result["video"].(map[string]any)
	export := result["localExport"].(map[string]any)
	relative := export["relativePath"].(string)
	if !strings.Contains(relative, "黄金_青石巷") || !strings.Contains(relative, "第01集：相遇") || strings.Contains(relative, "..") {
		t.Fatalf("wrong classification: %s", relative)
	}
	file := filepath.Join(output, filepath.FromSlash(relative))
	data, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(data, original) {
		t.Fatalf("original archive: %v", err)
	}
	if !strings.HasPrefix(video["url"].(string), "/api/resources/") {
		t.Fatal("playback resource changed")
	}
	if _, _, err := svc.recoverDoubaoBrowserArchive(task); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Project{}).Where("id = ?", "project-1").Update("name", "重命名后项目").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.archiveDoubaoBrowserResult(task, result); err != nil {
		t.Fatal(err)
	}
	if result["localExport"].(map[string]any)["relativePath"] != relative {
		t.Fatal("replay changed the committed archive directory")
	}
	files := 0
	_ = filepath.WalkDir(output, func(_ string, item os.DirEntry, err error) error {
		if err == nil && !item.IsDir() {
			files++
		}
		return err
	})
	if files != 1 {
		t.Fatalf("duplicate archive: %d", files)
	}
	foreign := task
	foreign.UserID = "foreign"
	if _, recovered, _ := svc.recoverDoubaoBrowserArchive(foreign); recovered {
		t.Fatal("foreign owner recovered archive")
	}
	if err := svc.archiveDoubaoBrowserResult(foreign, result); err == nil {
		t.Fatal("foreign owner archived another project")
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), root) {
		t.Fatal("absolute path exposed")
	}
	if err := os.WriteFile(file, bytes.Repeat([]byte{'x'}, len(original)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.recoverDoubaoBrowserArchive(task); err == nil {
		t.Fatal("different existing content was overwritten")
	}
	if data, err := os.ReadFile(file); err != nil || !bytes.Equal(data, bytes.Repeat([]byte{'x'}, len(original))) {
		t.Fatal("existing file changed")
	}
}

func TestDoubaoBrowserArchiveClassificationFailureRecoversWithoutProvider(t *testing.T) {
	root := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), root)
	defer svc.Close()
	svc.SetDoubaoBrowserOutputDir(filepath.Join(root, "output"))
	task := model.Task{ID: "classification-task", UserID: "owner", ProjectID: "later-project", Type: "canvas_video", Model: "doubao-browser::seedance_v2.0", InputJSON: `{"metadata":{"chapterId":"later-episode"}}`}
	original := []byte("downloaded original")
	_, err = svc.persistTaskGeneratedMediaResult(task, map[string]any{"mode": "video", "video": map[string]any{"dataUrl": "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(original)}})
	if err == nil {
		t.Fatal("invalid project was accepted")
	}
	if _, err := os.Stat(svc.doubaoArchiveFile(task)); err != nil {
		t.Fatal("downloaded original has no recovery checkpoint")
	}
	for _, row := range []any{&model.Project{ID: "later-project", UserID: "owner", Name: "恢复项目"}, &model.ProjectUnit{ID: "later-episode", ProjectID: "later-project", Title: "第02集"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, _, err := svc.processTask(context.Background(), task)
	if err != nil {
		t.Fatal(err)
	}
	relative := result["localExport"].(map[string]any)["relativePath"].(string)
	if !strings.Contains(relative, "恢复项目") || !strings.Contains(relative, "第02集") {
		t.Fatal("classification was not restored")
	}
	data, err := os.ReadFile(filepath.Join(root, "output", filepath.FromSlash(relative)))
	if err != nil || !bytes.Equal(data, original) {
		t.Fatal("recovered bytes changed")
	}
}

func TestDoubaoBrowserArchiveSafeNames(t *testing.T) {
	for _, input := range []string{"../CON", "NUL", "a/b\\c:d*e?", ".", "..", "COM1", strings.Repeat("长", 200)} {
		name := doubaoArchiveName(input, "stable-id")
		if strings.ContainsAny(name, "/\\:*?\"<>|") || strings.HasSuffix(name, ".") || len([]rune(name)) > 65 || name == "." || name == ".." {
			t.Fatalf("unsafe name: %q", name)
		}
	}
}

func TestDoubaoBrowserArchiveCanvasClassification(t *testing.T) {
	root := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), root)
	defer svc.Close()
	for _, row := range []any{
		&model.Project{ID: "project", UserID: "owner", Name: "剧集项目"},
		&model.ProjectUnit{ID: "episode-a", ProjectID: "project", Title: "第01集"},
		&model.ProjectUnit{ID: "episode-b", ProjectID: "project", Title: "第02集"},
		&model.CanvasProject{ID: "standalone", UserID: "owner", Title: "独立画布", PayloadJSON: `{"nodes":[]}`},
		&model.CanvasProject{ID: "single", UserID: "owner", ProjectID: "project", Title: "单集画布", PayloadJSON: `{"nodes":[]}`},
		&model.CanvasProject{ID: "multi", UserID: "owner", ProjectID: "project", Title: "多集画布", PayloadJSON: `{"nodes":[{"id":"node-b","metadata":{"chapterId":"episode-b"}}]}`},
		&model.CanvasUnitLink{ID: "single-a", ProjectID: "project", CanvasID: "single", UnitID: "episode-a"},
		&model.CanvasUnitLink{ID: "multi-a", ProjectID: "project", CanvasID: "multi", UnitID: "episode-a"},
		&model.CanvasUnitLink{ID: "multi-b", ProjectID: "project", CanvasID: "multi", UnitID: "episode-b"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ canvas, input, project, episode string }{
		{"standalone", `{}`, "独立画布", "未分集"},
		{"single", `{}`, "剧集项目", "第01集"},
		{"multi", `{}`, "剧集项目", "未分集"},
		{"multi", `{"metadata":{"sourceNodeId":"node-b"}}`, "剧集项目", "第02集"},
		{"multi", `{"metadata":{"chapterId":"episode-a"}}`, "剧集项目", "第01集"},
	} {
		got, err := svc.doubaoArchiveDirectory(model.Task{UserID: "owner", ProjectID: tc.canvas, InputJSON: tc.input})
		if err != nil || !strings.Contains(got, tc.project) || !strings.Contains(got, tc.episode) {
			t.Fatalf("%s: %s %v", tc.canvas, got, err)
		}
	}
}
