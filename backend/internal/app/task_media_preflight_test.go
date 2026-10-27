package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/repository"
)

type transportRefreshTestUploader struct {
	upload      func(context.Context, string, []byte) (string, error)
	invalidated string
	available   bool
	checks      int
}

func (u *transportRefreshTestUploader) URLAvailable(ctx context.Context, _ string) (bool, error) {
	u.checks++
	return u.available, ctx.Err()
}

func (u *transportRefreshTestUploader) InvalidateURL(value string) { u.invalidated = value }

func TestExpiredTemporaryURLWithoutOriginalStopsSubmission(t *testing.T) {
	uploader := &transportRefreshTestUploader{}
	svc := &Service{temporaryImages: uploader}
	media := generation.Media{URL: "https://h.uguu.se/deleted.png", MimeType: "image/png"}
	err := (appReferencePreparationPort{service: svc}).Upload(context.Background(), "user-1", &media)
	if err == nil || uploader.invalidated != media.URL {
		t.Fatalf("expired URL without a local source was allowed through: media=%#v err=%v", media, err)
	}
}

func TestPublicReferenceAvailabilityPreservesValidLinks(t *testing.T) {
	for _, test := range []struct {
		name      string
		url       string
		available bool
		checks    int
	}{
		{name: "valid Uguu", url: "https://h.uguu.se/available.png", available: true, checks: 1},
		{name: "other public host", url: "https://cdn.example/reference.png", checks: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			uploader := &transportRefreshTestUploader{available: test.available}
			svc := &Service{temporaryImages: uploader}
			media := generation.Media{URL: test.url, Name: "scene", MimeType: "image/png"}
			err := (appReferencePreparationPort{service: svc}).Upload(context.Background(), "user-1", &media)
			if err != nil || media.URL != test.url || media.Name != "scene" || uploader.invalidated != "" || uploader.checks != test.checks {
				t.Fatalf("valid public reference changed: media=%#v checks=%d err=%v", media, uploader.checks, err)
			}
		})
	}
}

func (u *transportRefreshTestUploader) Upload(ctx context.Context, owner string, data []byte) (outbound.TemporaryImageURL, error) {
	value, err := u.upload(ctx, owner, data)
	now := time.Now().UTC()
	return outbound.TemporaryImageURL{URL: value, UploadedAt: now, ExpiresAt: now.Add(3 * time.Hour)}, err
}

func TestLocalVideoTaskAdmissionPreservesAutomaticReferenceRefresh(t *testing.T) {
	for _, protocol := range []string{"jiasu-video", "eggfans-sd2-video"} {
		t.Run(protocol, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "refresh.db")), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(database.LocalModels()...); err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = sqlDB.Close() })
			svc := NewLocal(repository.New(db), t.TempDir())
			t.Cleanup(func() { _ = svc.Close() })
			t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
				t.Fatal(err)
			}
			original := encoded.Bytes()
			resourcePath := filepath.Join(svc.dataDir, "resources", "reference.png")
			if err := os.MkdirAll(filepath.Dir(resourcePath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(resourcePath, original, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := svc.repo.CreateResource(&model.Resource{ID: "local-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "reference.png", MimeType: "image/png", Size: int64(len(original)), Width: 512, Height: 512}); err != nil {
				t.Fatal(err)
			}
			uploads := 0
			uploader := &transportRefreshTestUploader{upload: func(_ context.Context, userID string, data []byte) (string, error) {
				uploads++
				if userID != "user-1" || string(data) != string(original) {
					t.Fatal("reference refresh changed the owner or original image")
				}
				return "https://h.uguu.se/refreshed.png", nil
			}}
			svc.temporaryImages = uploader
			now := time.Now().UTC()
			if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/deleted.png", now, now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			request := CreateTaskRequest{Type: "canvas_video", Prompt: "move", Input: map[string]any{
				"mode": "video", "prompt": "move",
				"config":          map[string]any{"interfaceType": protocol, "model": "sd-2.5-j2-V", "baseUrl": "https://provider.example", "apiKey": "synthetic-key", "videoSeconds": "30", "size": "16:9", "vquality": "720p"},
				"referenceImages": []any{map[string]any{"storageKey": "resource:local-image", "url": "https://h.uguu.se/deleted.png", "name": "scene"}},
			}}
			task, err := svc.CreateTask("user-1", request)
			if err != nil || task.Status != model.TaskStatusQueued {
				t.Fatalf("local reference rejected before automatic upload: task=%#v err=%v", task, err)
			}
			if uploads != 0 {
				t.Fatal("admission must not upload or contact the upstream")
			}
			input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: protocol, Model: "sd-2.5-j2-V"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image", URL: "https://h.uguu.se/deleted.png", Name: "scene"}}}
			if err := svc.hydrateGenerationMediaWithContext(context.Background(), "user-1", &input, providerMediaHydrationPolicyFor(context.Background(), input)); err != nil {
				t.Fatal(err)
			}
			if uploads != 1 || input.ReferenceImages[0].URL != "https://h.uguu.se/refreshed.png" || input.ReferenceImages[0].Name != "scene" || uploader.invalidated != "https://h.uguu.se/deleted.png" {
				t.Fatalf("generation did not use refreshed reference URL: %#v uploads=%d", input.ReferenceImages, uploads)
			}
			saved, err := svc.Resource("user-1", "local-image")
			if err != nil || saved.TemporaryImageURL != input.ReferenceImages[0].URL {
				t.Fatalf("refreshed URL not persisted: %#v %v", saved, err)
			}
		})
	}
}

func TestCreateTaskMediaTransportAdmission(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "preflight.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	svc := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	request := CreateTaskRequest{Type: "canvas_video", Prompt: "move", Input: map[string]any{
		"mode": "video", "prompt": "move",
		"config":          map[string]any{"interfaceType": "newapi-channel-2", "model": "custom-video", "baseUrl": "https://custom.example/v1", "apiKey": "synthetic-key", "videoGenerateAudio": false},
		"referenceImages": []any{map[string]any{"storageKey": "resource:local-image"}},
	}}
	_, err = svc.CreateTask("user", request)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Reason != "reference_media_requires_url" {
		t.Fatalf("wrong admission error: %v", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected task persisted: %d %v", count, err)
	}
	request.Input["referenceImages"] = []any{map[string]any{"url": "https://cdn.example/image.png"}}
	request.Input["mask"] = map[string]any{"storageKey": "resource:local-mask"}
	if _, err := svc.CreateTask("user", request); !errors.As(err, &appErr) || appErr.Reason != "reference_media_requires_url" {
		t.Fatalf("mask-only rejection missing: %v", err)
	}
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("mask rejection persisted: %d %v", count, err)
	}
	request.Input["mask"] = map[string]any{"url": "https://cdn.example/mask.png"}
	task, err := svc.CreateTask("user", request)
	if err != nil || task.Status != model.TaskStatusQueued {
		t.Fatalf("HTTPS task not accepted: %v", err)
	}
}

func TestTaskCapabilityInvalidConfigDoesNotSkipValidation(t *testing.T) {
	svc := &Service{}
	if err := svc.ValidateTaskCapability(map[string]any{"mode": "video", "config": map[string]any{"videoGenerateAudio": map[string]any{"bad": true}}}); err == nil {
		t.Fatal("malformed configuration skipped validation")
	}
}
