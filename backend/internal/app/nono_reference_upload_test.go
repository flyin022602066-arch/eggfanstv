package app

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/repository"
)

type nonoReferenceUploadHost struct {
	original    []byte
	uploads     int
	invalidated string
}

func (host *nonoReferenceUploadHost) URLAvailable(context.Context, string) (bool, error) {
	return false, nil
}

func (host *nonoReferenceUploadHost) InvalidateURL(address string) {
	host.invalidated = address
}

func (host *nonoReferenceUploadHost) Upload(_ context.Context, _ string, data []byte) (outbound.TemporaryImageURL, error) {
	if !bytes.Equal(data, host.original) {
		return outbound.TemporaryImageURL{}, os.ErrInvalid
	}
	host.uploads++
	now := time.Now()
	return outbound.TemporaryImageURL{URL: "https://h.uguu.se/nono-original.png", UploadedAt: now, ExpiresAt: now.Add(time.Hour)}, nil
}

func TestNonoLocalReferenceAdmissionAndUguuRefresh(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "nono.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = service.Close() })
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	resourcePath := filepath.Join(service.dataDir, "resources", "nono-original.png")
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "nono-image", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "nono-original.png", MimeType: "image/png", Size: int64(encoded.Len()), Width: 512, Height: 512}
	if err := service.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	host := &nonoReferenceUploadHost{original: encoded.Bytes()}
	service.temporaryImages = host
	now := time.Now()
	if err := service.repo.SaveResourceTemporaryImageURL("owner", resource.ID, "https://h.uguu.se/deleted.png", now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, modelName := range []string{"按条特惠seedance-2.5-720P 满血", "按条福利seedance-2.5-720P", "按条seedance-2.5-720P 只支持参考图"} {
		for _, media := range []map[string]any{{"storageKey": "resource:nono-image", "name": "角色原图"}, {"dataUrl": generation.DataURL("image/png", encoded.Bytes()), "name": "本地图片"}} {
			input := map[string]any{
				"mode": "video", "prompt": "edited final prompt",
				"config":          map[string]any{"interfaceType": "nono-video", "baseUrl": "https://sub-tz.top/prod-api/v1", "apiKey": "synthetic-key", "model": modelName, "videoSeconds": "30", "size": "9:16", "vquality": "720p"},
				"referenceImages": []any{media},
			}
			if err := (taskMediaAdapter{s: service}).ValidateTransport("owner", input); err != nil {
				t.Fatalf("local nono image rejected before automatic upload for %s: %v", modelName, err)
			}
			if host.uploads != 0 {
				t.Fatal("admission uploaded media or dispatched generation")
			}
		}
	}
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "nono-video", Model: "按条seedance-2.5-720P 只支持参考图"}, ReferenceImages: []providerMedia{{StorageKey: "resource:nono-image", Name: "角色原图", URL: "https://h.uguu.se/deleted.png"}}}
	if err := service.hydrateGenerationMediaWithContext(context.Background(), "owner", &input, providerMediaHydrationPolicyFor(context.Background(), input)); err != nil {
		t.Fatal(err)
	}
	if host.uploads != 1 || host.invalidated != "https://h.uguu.se/deleted.png" || input.ReferenceImages[0].URL != "https://h.uguu.se/nono-original.png" || input.ReferenceImages[0].DataURL != "" || input.ReferenceImages[0].Name != "角色原图" {
		t.Fatalf("original image did not become a fresh Uguu URL: %+v uploads=%d", input.ReferenceImages, host.uploads)
	}
	foreign := providerMedia{StorageKey: "resource:nono-image"}
	if err := (appReferencePreparationPort{service: service}).Upload(context.Background(), "other-owner", &foreign); err == nil {
		t.Fatal("foreign original image was uploaded")
	}
}
