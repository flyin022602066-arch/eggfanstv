package app

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeneratedImagePreservesUpstreamPixelsAndBytes(t *testing.T) {
	for _, dimensions := range []image.Point{{X: 3840, Y: 2160}, {X: 1672, Y: 941}} {
		t.Run(fmt.Sprintf("%dx%d", dimensions.X, dimensions.Y), func(t *testing.T) {
			var original bytes.Buffer
			if err := png.Encode(&original, image.NewNRGBA(image.Rect(0, 0, dimensions.X, dimensions.Y))); err != nil {
				t.Fatal(err)
			}
			images, err := imageDataURLs(imageResponse{Data: []map[string]interface{}{{"b64_json": base64.StdEncoding.EncodeToString(original.Bytes())}}})
			if err != nil {
				t.Fatal(err)
			}
			service := newResourceTestService(t)
			service.localResourceStorage = true
			result, err := service.persistGeneratedMediaResult("user-1", map[string]interface{}{"mode": "image", "images": images})
			if err != nil {
				t.Fatal(err)
			}
			storedImage := result["images"].([]interface{})[0].(map[string]interface{})
			if intValue(storedImage["width"]) != dimensions.X || intValue(storedImage["height"]) != dimensions.Y {
				t.Fatalf("stored dimensions = %vx%v", storedImage["width"], storedImage["height"])
			}
			resource, err := service.repo.ResourceForUser("user-1", strings.TrimPrefix(stringField(storedImage, "storageKey"), "resource:"))
			if err != nil {
				t.Fatal(err)
			}
			storedBytes, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(storedBytes, original.Bytes()) {
				t.Fatal("stored image differs from upstream original bytes")
			}
		})
	}
}
