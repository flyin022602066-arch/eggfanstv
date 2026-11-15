package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Opt-in acceptance uses an already completed task in an isolated workspace.
// It never starts a worker or contacts a video provider.
func TestDoubaoBrowserArchiveCompletedVideoAcceptance(t *testing.T) {
	root := os.Getenv("EGGFANSTV_DOUBAO_ARCHIVE_ACCEPTANCE_ROOT")
	if root == "" {
		t.Skip("requires an isolated completed-video acceptance workspace")
	}
	directory := filepath.Join(root, ".local/project-workbench-debug/doubao-browser-task-fixed-20261113")
	manifestBytes, err := os.ReadFile(filepath.Join(directory, "acceptance-task.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		TaskID string `json:"taskId"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil || manifest.TaskID == "" {
		t.Fatal("missing acceptance task identity")
	}
	metadataBytes, err := os.ReadFile(filepath.Join(root, ".local/cache/doubao-source-project-metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Project struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"project"`
		Units []struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Position int    `json:"position"`
		} `json:"units"`
	}
	if err := json.Unmarshal(metadataBytes, &metadata); err != nil || metadata.Project.ID == "" || len(metadata.Units) == 0 {
		t.Fatal("missing source project metadata")
	}
	db, err := database.Open(database.Config{DataDir: directory})
	if err != nil {
		t.Fatal(err)
	}
	db.Logger = logger.Default.LogMode(logger.Silent)
	connection, _ := db.DB()
	defer connection.Close()
	svc := NewLocal(repository.New(db), directory)
	defer svc.Close()
	svc.SetDoubaoBrowserOutputDir(filepath.Join(root, "output"))
	task, err := svc.repo.Task(manifest.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusSucceeded || task.Model != "doubao-browser::seedance_v2.0" {
		t.Fatal("expected the original completed native Fast task")
	}
	project := model.Project{ID: metadata.Project.ID, UserID: task.UserID, Name: metadata.Project.Name}
	unit := model.ProjectUnit{ID: metadata.Units[0].ID, ProjectID: project.ID, Title: metadata.Units[0].Title, Position: metadata.Units[0].Position}
	for _, row := range []any{&project, &unit} {
		if err := db.FirstOrCreate(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var input map[string]any
	body, err := svc.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(body), &input); err != nil {
		t.Fatal(err)
	}
	input["metadata"] = map[string]any{"domainProjectId": project.ID, "chapterId": unit.ID, "source": "completed-video-archive-acceptance"}
	inputBytes, _ := json.Marshal(input)
	task.ProjectID, task.InputJSON = project.ID, string(inputBytes)
	var result map[string]any
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	result, err = svc.persistTaskGeneratedMediaResult(*task, result)
	if err != nil {
		t.Fatal(err)
	}
	export := result["localExport"].(map[string]any)
	archive := filepath.Join(root, "output", filepath.FromSlash(export["relativePath"].(string)))
	copied, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(filepath.Join(root, ".local/cache/eggfansTV-doubao-task-portrait.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	if len(copied) == 0 || !bytes.Equal(copied, original) {
		t.Fatal("archive differs from the real generated original")
	}
	if err := svc.archiveDoubaoBrowserResult(*task, result); err != nil {
		t.Fatal(err)
	}
	resultBytes, _ := json.Marshal(result)
	if err := db.Model(&model.Task{}).Where("id = ? AND user_id = ?", task.ID, task.UserID).Updates(map[string]any{"project_id": task.ProjectID, "input_json": task.InputJSON, "result_json": string(resultBytes)}).Error; err != nil {
		t.Fatal(err)
	}
	t.Logf("original task=%s bytes=%d sha256=%x archive=%s", task.ID, len(copied), sha256.Sum256(copied), archive)
}
