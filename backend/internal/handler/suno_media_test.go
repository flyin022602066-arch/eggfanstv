package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestDesktopSunoMediaRecoveryStoresPlayableResourceWithoutHostedImport(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	dataDir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dataDir, "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	service := app.NewLocal(repository.New(db), dataDir)
	owner, err := service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	audio := "RIFF0000WAVEfmt original completed song"
	remote := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if request.Header.Get("Authorization") != "" || request.Header.Get("X-Desktop-Token") != "" {
			t.Error("media fetch forwarded credentials")
		}
		writer.Header().Set("Content-Type", "audio/wav")
		_, _ = writer.Write([]byte(audio))
	}))
	defer remote.Close()
	router := gin.New()
	router.Use(RuntimeDependenciesMiddleware(RuntimeDependencies{RequestCoordinator: &stubRequestCoordinator{allowed: true}, Assets: service.ResourceService()}))
	RegisterUserDataRoutes(router.Group("/api"), service)
	body, _ := json.Marshal(map[string]any{"clipId": "original-clip", "url": remote.URL + "/completed.wav", "kind": "audio", "durationMs": 247000})
	var resourceID string
	for index := 0; index < 2; index++ {
		request := httptest.NewRequest(http.MethodPost, "/api/resources/suno-media", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Idempotency-Key", "suno:fixture-job:original-clip")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		var reply struct {
			Code int `json:"code"`
			Data struct {
				Resource model.Resource `json:"resource"`
			} `json:"data"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &reply) != nil || reply.Code != 0 || reply.Data.Resource.UserID != owner.ID {
			t.Fatalf("media recovery=%d %s", response.Code, response.Body.String())
		}
		if index == 1 && resourceID != reply.Data.Resource.ID {
			t.Fatal("idempotent media recovery created duplicates")
		}
		resourceID = reply.Data.Resource.ID
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/resources/"+resourceID+"/file?proxy=1", nil))
	if response.Code != http.StatusOK || response.Body.String() != audio || calls != 1 {
		t.Fatalf("playable bytes=%d calls=%d", response.Code, calls)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/resources/import", strings.NewReader(string(body))))
	if response.Code != http.StatusNotFound {
		t.Fatalf("obsolete hosted import returned %d", response.Code)
	}
}
