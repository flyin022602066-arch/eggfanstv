package app

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sync"
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

type nonoFailoverTestHost struct {
	mu      sync.Mutex
	address string
	err     error
	calls   int
	data    []byte
}

func (host *nonoFailoverTestHost) Upload(ctx context.Context, _ string, data []byte) (outbound.TemporaryImageURL, error) {
	host.mu.Lock()
	defer host.mu.Unlock()
	host.calls++
	host.data = append([]byte(nil), data...)
	if err := ctx.Err(); err != nil {
		return outbound.TemporaryImageURL{}, err
	}
	now := time.Now().UTC()
	return outbound.TemporaryImageURL{URL: host.address, UploadedAt: now, ExpiresAt: now.Add(24 * time.Hour)}, host.err
}

func (host *nonoFailoverTestHost) URLAvailable(ctx context.Context, _ string) (bool, error) {
	return true, ctx.Err()
}

func (host *nonoFailoverTestHost) InvalidateURL(string) {}

func nonoFailoverFixture(t *testing.T) (*Service, []byte, *nonoFailoverTestHost, *nonoFailoverTestHost) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "failover.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
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
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	resourcePath := filepath.Join(service.dataDir, "resources", "original.png")
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "original", UserID: "owner", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "original.png", MimeType: "image/png", Size: int64(encoded.Len()), Width: 16, Height: 16}
	if err := service.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	primary := &nonoFailoverTestHost{err: io.ErrUnexpectedEOF}
	backup := &nonoFailoverTestHost{address: "https://u.pone.rs/reference.png"}
	service.temporaryImages = primary
	service.nonoImages = outbound.NewImageFailoverHost(primary, backup)
	return service, encoded.Bytes(), primary, backup
}

func TestNonoImageFailoverPersistsAndReusesOriginalReference(t *testing.T) {
	service, original, primary, backup := nonoFailoverFixture(t)
	config := generation.Config{InterfaceType: "nono-video", Model: "按条特惠seedance-2.5-720P 满血", Size: "16:9", VideoSeconds: "30", VQuality: "720p", VideoGenerateAudio: "true"}
	for attempt := 0; attempt < 2; attempt++ {
		input := generation.Input{Mode: "video", Prompt: "用户的完整提示词", Config: config, ReferenceImages: []generation.Media{{StorageKey: "resource:original", Name: "角色原图"}}}
		prepared, err := (appReferencePreparationPort{service: service}).Prepare(context.Background(), "owner", &input)
		if err != nil || !prepared || input.ReferenceImages[0].URL != backup.address || input.ReferenceImages[0].Name != "角色原图" || input.ReferenceImages[0].DataURL != "" || input.Config.Model != config.Model || input.Config.Size != config.Size || input.Config.VideoSeconds != config.VideoSeconds || input.Config.VideoGenerateAudio != config.VideoGenerateAudio || input.Prompt != "用户的完整提示词" {
			t.Fatalf("nono reference or native parameters changed: prepared=%v input=%+v err=%v", prepared, input, err)
		}
	}
	if primary.calls != 1 || backup.calls != 1 || !bytes.Equal(original, backup.data) {
		t.Fatalf("original not reused: primary=%d backup=%d", primary.calls, backup.calls)
	}
	saved, err := service.Resource("owner", "original")
	if err != nil || saved.TemporaryImageURL != backup.address || saved.TemporaryImageExpiresAt.Sub(*saved.TemporaryImageUploadedAt) != 24*time.Hour {
		t.Fatalf("backup URL not persisted: %+v err=%v", saved, err)
	}
	actual, err := os.ReadFile(filepath.Join(service.dataDir, "resources", "original.png"))
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatal("durable original modified")
	}
	expired := time.Now().Add(-time.Minute)
	if err := service.repo.DB().Model(&model.Resource{}).Where("id = ?", "original").Update("temporary_image_expires_at", expired).Error; err != nil {
		t.Fatal(err)
	}
	input := generation.Input{Mode: "video", Config: config, ReferenceImages: []generation.Media{{StorageKey: "resource:original"}}}
	if _, err := (appReferencePreparationPort{service: service}).Prepare(context.Background(), "owner", &input); err != nil {
		t.Fatal(err)
	}
	if primary.calls != 2 || backup.calls != 2 || !bytes.Equal(original, backup.data) {
		t.Fatal("expired backup was not refreshed from original")
	}
}

func TestNonoImageFailoverRemainsIsolatedAndOwned(t *testing.T) {
	service, _, _, backup := nonoFailoverFixture(t)
	for _, protocol := range []string{"jiasu-video", "towo-sd25-video"} {
		input := generation.Input{Mode: "video", Config: generation.Config{InterfaceType: protocol}, ReferenceImages: []generation.Media{{StorageKey: "resource:original"}}}
		ctx := service.bindCustomGenerationReferences(context.Background())
		if err := generation.HydrateMedia(ctx, "owner", &input, generation.MediaHydrationPolicy{PublicOnly: true}); err == nil {
			t.Fatalf("unrelated channel unexpectedly fell back: %s", protocol)
		}
	}
	input := generation.Input{Mode: "video", Config: generation.Config{InterfaceType: "nono-video"}, ReferenceImages: []generation.Media{{StorageKey: "resource:original"}}}
	if _, err := (appReferencePreparationPort{service: service}).Prepare(context.Background(), "other-owner", &input); err == nil {
		t.Fatal("foreign original uploaded")
	}
	if backup.calls != 0 {
		t.Fatal("backup crossed channel or ownership boundary")
	}
}
