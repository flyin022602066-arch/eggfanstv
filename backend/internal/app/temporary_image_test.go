package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"
)

type imageUploadTestFunc func(context.Context, string, []byte) (string, error)

func (upload imageUploadTestFunc) URLAvailable(ctx context.Context, _ string) (bool, error) {
	return true, ctx.Err()
}

func (upload imageUploadTestFunc) InvalidateURL(string) {}

type unavailableImageUpload struct {
	imageUploadTestFunc
	invalidated string
}

func (upload *unavailableImageUpload) URLAvailable(ctx context.Context, _ string) (bool, error) {
	return false, ctx.Err()
}

func (upload *unavailableImageUpload) InvalidateURL(value string) { upload.invalidated = value }

func (upload imageUploadTestFunc) Upload(ctx context.Context, userID string, data []byte) (outbound.TemporaryImageURL, error) {
	url, err := upload(ctx, userID, data)
	now := time.Now().UTC()
	return outbound.TemporaryImageURL{URL: url, UploadedAt: now, ExpiresAt: now.Add(3 * time.Hour)}, err
}

func temporaryImageTestResource(t *testing.T) (*Service, []byte) {
	t.Helper()
	svc := newResourceTestService(t)
	svc.mode, svc.localResourceStorage = serviceModeLocal, true
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "")
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	resourcePath := filepath.Join(svc.dataDir, "resources", "reference.png")
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "local-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "reference.png", MimeType: "image/png", Size: int64(encoded.Len()), Width: 2, Height: 2}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	return svc, encoded.Bytes()
}

func TestLocalURLOnlyImageUploadsFromOwnedResourceWithoutChangingOriginal(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	calls := 0
	svc.temporaryImages = imageUploadTestFunc(func(ctx context.Context, userID string, data []byte) (string, error) {
		calls++
		if userID != "user-1" || !bytes.Equal(data, original) {
			t.Fatal("uploaded wrong image or owner")
		}
		return "https://h.uguu.se/image.png", ctx.Err()
	})
	input := canvasGenerationInput{Mode: "video", Prompt: "test scene", Config: providerConfig{InterfaceType: "eggfans-sd2-video", Model: "sd-2.5-E", VideoSeconds: "27", Size: "9:16", VQuality: "720p"}, ReferenceImages: []providerMedia{{ID: "image-1", StorageKey: "resource:local-image"}}}
	if err := svc.hydrateGenerationMedia(context.Background(), "user-1", &input, providerMediaHydrationPolicy{requireURL: true}); err != nil {
		t.Fatal(err)
	}
	media := input.ReferenceImages[0]
	if media.URL != "https://h.uguu.se/image.png" || media.DataURL != "" || media.ID != "image-1" || media.StorageKey != "resource:local-image" || media.Width != 2 {
		t.Fatal("image URL replacement lost reference metadata")
	}
	adapter := officialSourceProviderAdapter(t, "eggfans-sd2-video", "eggfans-sd2-video")
	create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	payload := marshalProtocolBody(t, create.Body)
	images, ok := payload["image_refs"].([]any)
	if !ok || len(images) != 1 || images[0] != media.URL || payload["model"] != "sd-2.5-E" || payload["duration"] != float64(27) || payload["aspect_ratio"] != "9:16" {
		t.Fatalf("SD2 did not receive the uploaded image in its native request fields: %#v", payload)
	}
	input.Metadata = map[string]any{"videoStartFrameNodeId": "image-1"}
	frames, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	framePayload := marshalProtocolBody(t, frames.Body)
	if framePayload["first_image"] != media.URL || framePayload["image_refs"] != nil {
		t.Fatal("SD2 first-frame role was lost after uploading")
	}
	if _, err := svc.ResourceUpstreamURL(context.Background(), "other-user", "local-image"); err == nil || calls != 1 {
		t.Fatal("foreign image reached temporary hosting")
	}
	resource, err := svc.repo.ResourceForUser("user-1", "local-image")
	if err != nil || resource.Provider != "local" || resource.PublicURL != "" {
		t.Fatal("temporary URL replaced the durable local resource")
	}
	saved, err := svc.Resource("user-1", "local-image")
	if err != nil || saved.TemporaryImageURL != media.URL || saved.TemporaryImageUploadedAt == nil || saved.TemporaryImageExpiresAt == nil || saved.TemporaryImageExpiresAt.Sub(*saved.TemporaryImageUploadedAt) != 3*time.Hour {
		t.Fatal("worker upload URL and original expiry were not persisted for inspection")
	}
	if _, err := svc.Resource("other-user", "local-image"); err == nil || calls != 1 {
		t.Fatal("read-only resource inspection leaked upload details or uploaded again")
	}
	actual, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", "reference.png"))
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatal("original image was modified")
	}
}

func TestLocalInlineImageUploadOnlyRunsForURLRequiredProtocols(t *testing.T) {
	svc, data := temporaryImageTestResource(t)
	calls := 0
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, _ string, _ []byte) (string, error) {
		calls++
		return "https://h.uguu.se/inline.png", nil
	})
	inlineURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	media := &providerMedia{DataURL: inlineURL}
	if err := svc.hydrateProviderMedia(context.Background(), "user-1", media, providerMediaHydrationPolicy{}); err != nil || calls != 0 || media.DataURL != inlineURL {
		t.Fatal("inline-capable protocol unexpectedly uploaded an image")
	}
	if err := svc.hydrateProviderMedia(context.Background(), "user-1", media, providerMediaHydrationPolicy{requireURL: true}); err != nil || calls != 1 || media.URL != "https://h.uguu.se/inline.png" || media.DataURL != "" {
		t.Fatal("URL-only protocol did not upload the inline image")
	}
}

func TestLocalImageUpstreamURLUsesTemporaryHostAndRejectsUnreadyResource(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	calls := 0
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, userID string, data []byte) (string, error) {
		calls++
		if userID != "user-1" || !bytes.Equal(data, original) {
			t.Fatal("resource API uploaded the wrong image")
		}
		return "https://h.uguu.se/reference.png", nil
	})
	resultURL, err := svc.ResourceUpstreamURL(context.Background(), "user-1", "local-image")
	if err != nil || resultURL != "https://h.uguu.se/reference.png" || calls != 1 {
		t.Fatalf("resource API did not prepare a temporary image: %v", err)
	}
	pending := model.Resource{ID: "pending-image", UserID: "user-1", Kind: "image", Provider: "local", Status: model.ResourceStatusPending}
	if err := svc.repo.CreateResource(&pending); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResourceUpstreamURL(context.Background(), "user-1", "pending-image"); err == nil || calls != 1 {
		t.Fatal("unready image was uploaded")
	}
}

func TestResourceTemporaryImageURLExplicitlyUploadsToUguu(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	calls := 0
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, userID string, data []byte) (string, error) {
		calls++
		if userID != "user-1" || !bytes.Equal(data, original) {
			t.Fatal("resource API uploaded the wrong image")
		}
		return "https://h.uguu.se/manual.png", nil
	})

	resultURL, err := svc.ResourceTemporaryImageURL(context.Background(), "user-1", "local-image")
	if err != nil || resultURL != "https://h.uguu.se/manual.png" || calls != 1 {
		t.Fatalf("manual Uguu upload did not run: url=%q calls=%d err=%v", resultURL, calls, err)
	}

	saved, err := svc.Resource("user-1", "local-image")
	if err != nil || saved.TemporaryImageURL != resultURL {
		t.Fatalf("manual Uguu URL was not persisted: resource=%#v err=%v", saved, err)
	}
}

func TestTemporaryImageURLReusesPersistedURLAndRefreshesBeforeExpiry(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	calls := 0
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		calls++
		return "https://h.uguu.se/fresh.png", nil
	})
	now := time.Now().UTC()
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/persisted.png", now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, prepare := range []func(context.Context, string, string) (string, error){svc.ResourceTemporaryImageURL, svc.ResourceUpstreamURL} {
		result, err := prepare(context.Background(), "user-1", "local-image")
		if err != nil || result != "https://h.uguu.se/persisted.png" || calls != 0 {
			t.Fatalf("valid persisted URL was not reused: url=%q calls=%d err=%v", result, calls, err)
		}
	}
	for _, expiry := range []time.Time{now.Add(4 * time.Minute), now.Add(-time.Minute)} {
		if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/expired.png", now.Add(-3*time.Hour), expiry); err != nil {
			t.Fatal(err)
		}
		before := calls
		media := providerMedia{StorageKey: "resource:local-image", URL: "asset://other-channel"}
		if err := svc.hydrateProviderMedia(context.Background(), "user-1", &media, providerMediaHydrationPolicy{requireURL: true}); err != nil || media.URL != "https://h.uguu.se/fresh.png" || calls != before+1 {
			t.Fatalf("expired URL was not replaced for SD2: media=%#v calls=%d err=%v", media, calls, err)
		}
	}
}

func TestTemporaryImageURLRefreshesDeletedLinkAndPersistsLatest(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	calls := 0
	upload := &unavailableImageUpload{imageUploadTestFunc: func(context.Context, string, []byte) (string, error) {
		calls++
		return "https://h.uguu.se/latest.png", nil
	}}
	svc.temporaryImages = upload
	now := time.Now().UTC()
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/deleted.png", now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	result, err := svc.ResourceTemporaryImageURL(context.Background(), "user-1", "local-image")
	if err != nil || result != "https://h.uguu.se/latest.png" || upload.invalidated != "https://h.uguu.se/deleted.png" || calls != 1 {
		t.Fatalf("early deleted URL was not refreshed: url=%q calls=%d err=%v", result, calls, err)
	}
	saved, err := svc.Resource("user-1", "local-image")
	if err != nil || saved.TemporaryImageURL != result || !saved.TemporaryImageExpiresAt.After(now.Add(2*time.Hour)) {
		t.Fatal("latest URL and expiry were not persisted")
	}
}

func TestLocalTemporaryImageUploadFailuresStopPreparation(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	failure := errors.New("temporary hosting unavailable")
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, _ string, _ []byte) (string, error) { return "", failure })
	media := &providerMedia{StorageKey: "resource:local-image"}
	if err := svc.hydrateProviderMedia(context.Background(), "user-1", media, providerMediaHydrationPolicy{requireURL: true}); !errors.Is(err, failure) || media.URL != "" {
		t.Fatal("upload failure was ignored")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := svc.hydrateProviderMedia(ctx, "user-1", media, providerMediaHydrationPolicy{requireURL: true}); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled task continued uploading")
	}
}

func TestVideoReferencePreparationTimeoutDoesNotImplyProviderSubmission(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		return "", context.DeadlineExceeded
	})
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "jiasu-video", Model: "sd-2.5-j2-V"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
	err := svc.hydrateGenerationMedia(context.Background(), "user-1", &input, providerMediaHydrationPolicyFor(context.Background(), input))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("preparation cause lost: %v", err)
	}
	failure := classifyTaskFailure(err)
	if failure.Category != generation.CategoryInputInaccessible || failure.Uncertain || failure.TaskID != "" {
		t.Fatalf("preparation timeout classified as submitted: %#v", failure)
	}
	message := failure.UserMessage()
	if !strings.Contains(message, "参考图片 1/1") || !strings.Contains(message, "视频请求尚未发送") || strings.Contains(message, "模型服务响应超时") {
		t.Fatalf("incorrect failure copy: %s", message)
	}
	persisted := generation.ClassifyText(message)
	if persisted.Category != failure.Category || persisted.UserMessage() != message || persisted.Uncertain {
		t.Fatalf("persisted preparation failure lost its meaning: %#v", persisted)
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if outer := classifyTaskFailure(taskExecutionError(ctx, "canvas_video", err)); outer.UserMessage() != message || outer.Uncertain {
		t.Fatalf("task deadline masked preparation failure: %#v", outer)
	}
}
