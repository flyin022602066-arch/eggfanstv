package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNonoBundledPackageMatchesSource(t *testing.T) {
	root := filepath.Join("..", "..", "..", "plugin-packages")
	data, err := os.ReadFile(filepath.Join(root, "nono-video.beeftv-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "nono-video", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sourceManifest, packageManifest map[string]any
	if err := json.Unmarshal(source, &sourceManifest); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(pkg.ManifestRaw, &packageManifest); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(sourceManifest, packageManifest) {
		t.Fatal("nono bundled plugin does not match the source manifest")
	}
}

func TestNonoReferenceModeAndUnrestrictedMedia(t *testing.T) {
	adapter := officialPackageAdapter(t, "nono-video.beeftv-plugin", "nono-video")
	for _, modelName := range []string{"按条特惠seedance-2.5-720P 满血", "按条福利seedance-2.5-720P", "按条seedance-2.5-720P 只支持参考图"} {
		for _, counts := range [][3]int{{0, 0, 0}, {9, 0, 0}, {30, 10, 10}, {31, 11, 11}, {0, 1, 0}, {0, 0, 1}} {
			t.Run(fmt.Sprintf("%s/%v", modelName, counts), func(t *testing.T) {
				request := GenerationRequest{Capability: CapabilityVideo, Model: modelName, Prompt: "original prompt", Duration: 30, AspectRatio: "9:16", Resolution: "720p"}
				groups := []*[]MediaReference{&request.Images, &request.Videos, &request.Audios}
				for group, count := range counts {
					for index := 0; index < count; index++ {
						*groups[group] = append(*groups[group], MediaReference{URL: fmt.Sprintf("https://h.uguu.se/reference-%d-%d.png", group, index)})
					}
				}
				spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
				if err != nil {
					t.Fatal(err)
				}
				body := manifestTestBody(t, spec)
				mode := "text"
				if counts[0]+counts[1]+counts[2] > 0 {
					mode = "omni"
				}
				if body["reference_mode"] != mode {
					t.Fatalf("reference_mode = %#v, want %q for %v references", body["reference_mode"], mode, counts)
				}
				params, ok := body["params"].(map[string]any)
				if !ok {
					t.Fatal("params is missing")
				}
				if _, exists := params["referenceMode"]; exists {
					t.Fatal("params.referenceMode must not be sent")
				}
				for group, field := range []string{"image_urls", "video_urls", "audio_urls"} {
					urls, _ := body[field].([]any)
					if len(urls) != counts[group] {
						t.Fatalf("%s truncated: %d != %d", field, len(urls), counts[group])
					}
					for index, actual := range urls {
						if actual != (*groups[group])[index].URL {
							t.Fatalf("%s reference %d reordered", field, index)
						}
					}
				}
			})
		}
	}
}
