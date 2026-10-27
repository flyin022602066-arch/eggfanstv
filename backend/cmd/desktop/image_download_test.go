package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveOwnedImagePreservesOriginalResolutionAndBytes(t *testing.T) {
	for _, dimensions := range []image.Point{{X: 3840, Y: 2160}, {X: 1672, Y: 941}} {
		t.Run(fmt.Sprintf("%dx%d", dimensions.X, dimensions.Y), func(t *testing.T) {
			var original bytes.Buffer
			if err := png.Encode(&original, image.NewNRGBA(image.Rect(0, 0, dimensions.X, dimensions.Y))); err != nil {
				t.Fatal(err)
			}
			application := newDesktopApp(t.TempDir())
			application.startup(context.Background())
			defer application.shutdown(context.Background())
			resourceID := uploadDesktopResource(t, application, original.Bytes())
			destination := filepath.Join(t.TempDir(), "original.png")
			application.chooseSavePath = func(context.Context, string) (string, error) { return destination, nil }
			saved, err := application.SaveOwnedMedia("original.png", resourceID)
			if err != nil || !saved {
				t.Fatalf("save = %v, error = %v", saved, err)
			}
			download, err := os.ReadFile(destination)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(download, original.Bytes()) {
				t.Fatal("download differs from original image bytes")
			}
			decoded, err := png.DecodeConfig(bytes.NewReader(download))
			if err != nil {
				t.Fatal(err)
			}
			if decoded.Width != dimensions.X || decoded.Height != dimensions.Y {
				t.Fatalf("download dimensions = %dx%d", decoded.Width, decoded.Height)
			}
		})
	}
}
