package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/outbound"
)

type uguuRestoreImageHost struct {
	calls int
	err   error
}

func (host *uguuRestoreImageHost) URLAvailable(ctx context.Context, _ string) (bool, error) {
	return true, ctx.Err()
}

func (host *uguuRestoreImageHost) InvalidateURL(string) {}

func (host *uguuRestoreImageHost) Upload(ctx context.Context, _ string, data []byte) (outbound.TemporaryImageURL, error) {
	host.calls++
	if !bytes.Equal(data, []byte("original image")) {
		return outbound.TemporaryImageURL{}, errors.New("original image changed")
	}
	if ctx.Err() != nil {
		return outbound.TemporaryImageURL{}, ctx.Err()
	}
	now := time.Now().UTC()
	return outbound.TemporaryImageURL{URL: "https://h.uguu.se/original.png", UploadedAt: now, ExpiresAt: now.Add(3 * time.Hour)}, host.err
}

func TestGwayReferencePreparationUsesOnlyOriginalUguuFlow(t *testing.T) {
	for _, scenario := range []string{"success", "uguu-failed", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			host := &uguuRestoreImageHost{}
			if scenario == "uguu-failed" {
				host.err = errors.New("Uguu unavailable")
			}
			svc := &Service{temporaryImages: host}
			config := providerConfig{InterfaceType: "jiasu-video", BaseURL: "https://www.gway.dev", APIKey: "test-key", Model: "seedance-2.5", VideoSeconds: "30"}
			input := canvasGenerationInput{Mode: "video", Config: config, Prompt: "original prompt", ReferenceImages: []providerMedia{{ID: "image", Name: "原图", DataURL: "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("original image"))}}}
			port := appReferencePreparationPort{service: svc}
			ctx, cancel := context.WithCancel(generation.WithRuntime(context.Background(), generation.Runtime{References: port}))
			defer cancel()
			if scenario == "cancelled" {
				cancel()
			}
			prepared, err := port.Prepare(ctx, "user-1", &input)
			if prepared || err != nil {
				t.Fatalf("Gway dedicated media preparation still enabled: prepared=%v err=%v", prepared, err)
			}
			err = generation.HydrateMedia(ctx, "user-1", &input, generation.MediaHydrationPolicyFor(ctx, input))
			if scenario == "cancelled" {
				if !errors.Is(err, context.Canceled) || host.calls != 0 {
					t.Fatalf("cancelled task started uploading: calls=%d err=%v", host.calls, err)
				}
				return
			}
			if host.calls != 1 {
				t.Fatalf("wrong Uguu upload count: %d", host.calls)
			}
			if scenario == "uguu-failed" {
				if !errors.Is(err, host.err) || input.ReferenceImages[0].URL != "" {
					t.Fatalf("Uguu failure was hidden or another upload attempted: %v", err)
				}
				return
			}
			if err != nil || input.ReferenceImages[0].URL != "https://h.uguu.se/original.png" || input.ReferenceImages[0].DataURL != "" || input.Prompt != "original prompt" || input.Config.Model != config.Model || input.Config.BaseURL != config.BaseURL || input.Config.VideoSeconds != "30" {
				t.Fatalf("original Uguu flow or generation parameters changed: %v", err)
			}
		})
	}
}
