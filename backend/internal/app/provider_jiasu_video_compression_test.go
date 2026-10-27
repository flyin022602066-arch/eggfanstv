package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/protocol"
)

func TestJiasuVideoValidationDoesNotEnforceTotalReferenceByteLimit(t *testing.T) {
	for _, modelName := range []string{"sd-2.5-j2-V", "sd-2.5-J3-doubao"} {
		t.Run(modelName, func(t *testing.T) {
			input := jiasuTestInput(modelName)
			input.ReferenceImages = make([]providerMedia, 4)
			for index := range input.ReferenceImages {
				input.ReferenceImages[index] = providerMedia{Bytes: 30 * 1024 * 1024}
			}
			if err := validateJiasuVideoInput(input); err != nil {
				t.Fatalf("local validation must not reject aggregate reference size: %v", err)
			}
			profile := DefaultModelCapabilityConfigForModel("jiasu-video", modelName).Video
			if err := validateVideoTask(profile, input); err != nil {
				t.Fatalf("capability validation must not reject aggregate reference size: %v", err)
			}
		})
	}
}

func TestJiasuVideoReferencesPrecompressSoftSingleImageLimit(t *testing.T) {
	tests := []struct {
		name   string
		images []providerMedia
		want   bool
	}{
		{
			name:   "single image soft limit",
			images: []providerMedia{{Bytes: 17 << 20}},
			want:   true,
		},
		{
			name:   "aggregate soft limit",
			images: []providerMedia{{Bytes: 13 << 20}, {Bytes: 13 << 20}, {Bytes: 13 << 20}, {Bytes: 13 << 20}, {Bytes: 13 << 20}, {Bytes: 13 << 20}, {Bytes: 13 << 20}},
			want:   true,
		},
		{
			name:   "below soft limits",
			images: []providerMedia{{Bytes: 15 << 20}, {Bytes: 15 << 20}, {Bytes: 15 << 20}, {Bytes: 15 << 20}},
			want:   false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := jiasuTestInput("sd-2.5-j2-V")
			input.ReferenceImages = test.images
			if got := jiasuVideoReferencesNeedPrecompression(input); got != test.want {
				t.Fatalf("jiasuVideoReferencesNeedPrecompression() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestJiasuReferenceCompressionTargetPreservesQuality(t *testing.T) {
	tests := []struct {
		name   string
		source int
		want   int
	}{
		{name: "large reference capped below provider soft limit", source: 21 << 20, want: 14 << 20},
		{name: "medium reference keeps three quarters", source: 12 << 20, want: 9 << 20},
		{name: "small reference has quality floor", source: 5 << 20, want: 8 << 20},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := jiasuReferenceCompressionTargetBytes(test.source); got != test.want {
				t.Fatalf("jiasuReferenceCompressionTargetBytes(%d) = %d, want %d", test.source, got, test.want)
			}
		})
	}
}

func TestJiasuReferenceSizeRejectionDetection(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "explicit payload too large", err: providerHTTPError{StatusCode: 413, Body: `{"message":"request entity too large"}`}, want: true},
		{name: "explicit reference size", err: providerHTTPError{StatusCode: 400, Body: `{"message":"total reference image size exceeds limit"}`}, want: true},
		{name: "jiasu reference too large payload", err: providerPayloadError{raw: `{"error":{"code":"reference_too_large","message":"reference_images 第 6 个素材超过该模型单文件或合计大小限制，尚未提交生成。"}}`}, want: true},
		{name: "unrelated validation", err: providerHTTPError{StatusCode: 400, Body: `{"message":"invalid duration"}`}, want: false},
		{name: "server failure", err: providerHTTPError{StatusCode: 500, Body: `{"message":"reference image too large"}`}, want: false},
		{name: "nil", err: nil, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isJiasuReferenceSizeRejection(test.err); got != test.want {
				t.Fatalf("isJiasuReferenceSizeRejection() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestCompressJiasuReferenceImageTargetsHalfSize(t *testing.T) {
	imageData := makeJiasuCompressionTestImage(t)
	compressed, mimeType, width, height, err := compressJiasuReferenceImage(imageData, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if len(compressed) > len(imageData)*3/4 {
		t.Fatalf("compressed image size = %d, want at most three quarters of %d", len(compressed), len(imageData))
	}
	if mimeType != "image/jpeg" || width < 1024 || height < 1024 || width > 2048 || height > 2048 {
		t.Fatalf("unexpected compressed image metadata: mime=%s size=%dx%d", mimeType, width, height)
	}
}

func TestJiasuCreateRetriesOnceAfterReferenceSizeRejection(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, failRetry := range []bool{false, true} {
		name := "retry succeeds"
		if failRetry {
			name = "retry is attempted only once"
		}
		t.Run(name, func(t *testing.T) {
			service, _ := temporaryImageTestResource(t)
			service.coordinator = platform.NewLocalCoordinator()
			imageUploads := 0
			var uploadedBytes int
			service.temporaryImages = imageUploadTestFunc(func(_ context.Context, userID string, data []byte) (string, error) {
				if userID != "user-1" {
					t.Fatalf("compression upload used wrong owner %q", userID)
				}
				imageUploads++
				uploadedBytes = len(data)
				return "https://h.uguu.se/compressed.png", nil
			})
			createCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPost || request.URL.Path != "/v1/video/generations" {
					t.Errorf("unexpected request %s %s", request.Method, request.URL.Path)
					http.NotFound(writer, request)
					return
				}
				createCalls++
				var body map[string]any
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Errorf("decode create request: %v", err)
				}
				images, _ := body["images"].([]any)
				if createCalls == 2 && (len(images) != 1 || !strings.Contains(images[0].(map[string]any)["url"].(string), "compressed.png")) {
					t.Errorf("retry did not use the compressed image URL: %#v", body["images"])
				}
				if createCalls == 1 || failRetry {
					writer.WriteHeader(http.StatusRequestEntityTooLarge)
					_, _ = writer.Write([]byte(`{"message":"request entity too large"}`))
					return
				}
				_, _ = writer.Write([]byte(`{"id":"task-after-compression","status":"queued"}`))
			}))
			defer server.Close()

			input := jiasuTestInput("sd-2.5-j2-V")
			input.Config.BaseURL, input.Config.APIKey = server.URL, "test-key"
			imageData := makeJiasuCompressionTestImage(t)
			resource, _, err := service.storeResource("user-1", "image", "reference.png", "image/png", int64(len(imageData)), 1200, 1200, 0, bytes.NewReader(imageData), nil, false)
			if err != nil {
				t.Fatal(err)
			}
			input.ReferenceImages = []providerMedia{{Name: "角色1", URL: "https://cdn.example/reference.png", StorageKey: "resource:" + resource.ID, MimeType: "image/png", Bytes: int64(len(imageData)), Width: 1200, Height: 1200}}
			loaded, mimeType, err := service.jiasuReferenceImageBytes(context.Background(), "user-1", input.Config, input.ReferenceImages[0])
			if err != nil {
				t.Fatalf("read test reference: %v", err)
			}
			compressed, _, _, _, err := compressJiasuReferenceImage(loaded, mimeType)
			if err != nil || len(compressed) >= len(loaded) {
				t.Fatalf("compress test reference: bytes=%d compressed=%d err=%v", len(loaded), len(compressed), err)
			}
			adapter := officialSourceProviderAdapter(t, "jiasu-video", "jiasu-video")
			service.workerID = newID()
			serviceID := registerProviderService(service)
			if providerService(providerAnalyticsContext{ServiceID: serviceID}) != service {
				t.Fatal("test service was not registered for provider retries")
			}
			ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ServiceID: serviceID, UserID: "user-1"})
			precompressed := input
			precompressed.ReferenceImages = append([]providerMedia(nil), input.ReferenceImages...)
			changed, err := service.prepareJiasuVideoReferenceImages(ctx, "user-1", &precompressed, true)
			if err != nil || !changed || imageUploads != 1 {
				t.Fatalf("direct compression setup: changed=%v uploads=%d err=%v", changed, imageUploads, err)
			}
			imageUploads = 0
			retriedInput, request, created, taskID, err := createProtocolAdapterTaskWithJiasuRetry(ctx, input, adapter, protocolRequestFromInput(input))
			if failRetry {
				if err == nil || createCalls != 2 || imageUploads != 1 {
					t.Fatalf("failed retry count: calls=%d uploads=%d retryable=%v err=%v", createCalls, imageUploads, isJiasuReferenceSizeRejection(err), err)
				}
				return
			}
			if err != nil || createCalls != 2 || imageUploads != 1 || taskID != "task-after-compression" || created.Status != protocol.StatusPending {
				t.Fatalf("retry result: calls=%d uploads=%d retryable=%v task=%q status=%q err=%v", createCalls, imageUploads, isJiasuReferenceSizeRejection(err), taskID, created.Status, err)
			}
			if retriedInput.ReferenceImages[0].URL != "https://h.uguu.se/compressed.png" || len(request.Images) != 1 || uploadedBytes >= len(imageData)*3/4 {
				t.Fatalf("compressed request was not preserved: input=%#v request=%#v uploaded=%d original=%d", retriedInput.ReferenceImages[0], request.Images, uploadedBytes, len(imageData))
			}
		})
	}
}

func makeJiasuCompressionTestImage(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	imageValue := image.NewRGBA(image.Rect(0, 0, 1900, 1900))
	random := rand.New(rand.NewSource(1))
	for y := 0; y < 1900; y++ {
		for x := 0; x < 1900; x++ {
			imageValue.SetRGBA(x, y, color.RGBA{R: uint8(random.Intn(256)), G: uint8(random.Intn(256)), B: uint8(random.Intn(256)), A: 255})
		}
	}
	if err := png.Encode(&buffer, imageValue); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
