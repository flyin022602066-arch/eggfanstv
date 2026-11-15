package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNonoAcceptedVideoKeepsPollingAfterLocalWaitTimeout(t *testing.T) {
	service := &Service{}
	started := time.Now().Add(-65 * time.Minute)
	task := model.Task{ID: "local-nono", Type: "canvas_video", ProviderRequestID: "original-nono", StartedAt: &started}
	input, err := json.Marshal(canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: "https://example.com", InterfaceType: "nono-video", Model: "按条福利seedance-2.5-720P"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, failure := range []error{context.DeadlineExceeded, videoDownloadError{TaskID: task.ProviderRequestID, Cause: io.ErrUnexpectedEOF}} {
		if !service.shouldDeferVideoProviderTask(task, string(input), failure) {
			t.Fatalf("accepted nono task abandoned after local interruption: %v", failure)
		}
	}
	for _, failure := range []error{context.Canceled, errors.New("upstream generation failed"), providerHTTPError{StatusCode: 400, Body: `{"error":"invalid_params"}`}} {
		if service.shouldDeferVideoProviderTask(task, string(input), failure) {
			t.Fatalf("terminal nono failure incorrectly resumed: %v", failure)
		}
	}
	task.ProviderRequestID = ""
	if service.shouldDeferVideoProviderTask(task, string(input), context.DeadlineExceeded) {
		t.Fatal("missing receipt must not resume or submit")
	}
	task.ProviderRequestID = "original-nono"
	started = time.Now().Add(-25 * time.Hour)
	if service.shouldDeferVideoProviderTask(task, string(input), context.DeadlineExceeded) {
		t.Fatal("automatic recovery must retain the existing safety bound")
	}
}

func TestNonoManualRecoveryClearsObsoleteFailureAndBindsOriginalShot(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "recovery.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), t.TempDir())
	requests := []string{}
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.Method+" "+request.URL.Path)
		if request.Method != http.MethodGet {
			http.Error(writer, "must not resubmit", http.StatusBadRequest)
			return
		}
		switch request.URL.Path {
		case "/prod-api/v1/videos/original-nono":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"original-nono","status":"succeeded","results":[{"url":"` + upstream.URL + `/original.mp4"}]}`))
		case "/original.mp4":
			writer.Header().Set("Content-Type", "video/mp4")
			_, _ = writer.Write([]byte("recovered-video"))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer upstream.Close()
	project := model.Project{ID: "project-nono", UserID: "owner", Status: model.ProjectStatusActive, Revision: 1}
	unit := model.ProjectUnit{ID: "chapter-nono", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Status: model.ProjectUnitStatusDraft}
	shot := model.Shot{ID: "shot-nono", ProjectID: project.ID, UnitID: unit.ID, Status: "active"}
	for _, item := range []any{&project, &unit, &shot} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow(project.UserID, project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	var stepID string
	for _, step := range workflow.Steps {
		if step.StepKey == "video" {
			stepID = step.ID
		}
	}
	if stepID == "" {
		t.Fatal("video workflow step missing")
	}
	input := map[string]any{"mode": "video", "config": providerConfig{BaseURL: upstream.URL + "/prod-api/v1", APIKey: "synthetic-test-key", Model: "按条福利seedance-2.5-720P", InterfaceType: "nono-video"}, "metadata": map[string]any{"workflowStepId": stepID, "domainProjectId": project.ID, "unitId": unit.ID, "shotId": shot.ID, "artifactType": "video", "role": "output"}}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "local-nono-recovery", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusFailed, InputJSON: string(encoded), ProviderRequestID: "original-nono", Error: "local wait timeout", FailureDiagnostics: &model.TaskFailureDiagnostics{Summary: "local wait timeout", Source: "unknown", ExecutionResult: "failed", Requests: []model.TaskRequestEvidence{{Operation: "submit", Method: "POST", HTTPStatus: http.StatusAccepted}}}}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.QueryFailedVideoTask(context.Background(), "other-user", task.ID); err == nil {
		t.Fatal("foreign task query allowed")
	}
	recovered, err := service.QueryFailedVideoTask(context.Background(), task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered.Recovered || recovered.Task.Status != model.TaskStatusSucceeded || recovered.Task.Error != "" {
		t.Fatalf("recovery result: %#v", recovered)
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if diagnostic := stored.FailureDiagnostics; diagnostic == nil || diagnostic.ExecutionResult != "completed" || diagnostic.Summary != "" || len(diagnostic.Requests) < 3 {
		t.Errorf("recovered task retains stale failure or loses request evidence: %#v", diagnostic)
	}
	var artifact model.ShotArtifact
	if err := db.First(&artifact, "task_id = ?", task.ID).Error; err != nil || artifact.ShotID != shot.ID || artifact.Status != "ready" || !artifact.Selected {
		t.Fatalf("original shot output missing: %#v, %v", artifact, err)
	}
	var resource model.Resource
	if err := db.First(&resource, "id = ?", artifact.ResourceID).Error; err != nil || resource.Status != model.ResourceStatusReady || resource.Size != int64(len("recovered-video")) {
		t.Fatalf("video resource missing: %#v, %v", resource, err)
	}
	_, body, err := service.OpenResource(project.UserID, resource.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	content, err := io.ReadAll(body)
	if err != nil || string(content) != "recovered-video" {
		t.Fatalf("local video missing or corrupted: %q, %v", content, err)
	}
	if !reflect.DeepEqual(requests, []string{"GET /prod-api/v1/videos/original-nono", "GET /original.mp4"}) {
		t.Fatalf("unexpected requests: %v", requests)
	}
}
