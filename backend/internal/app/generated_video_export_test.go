package app

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeneratedVideoExportsOriginalAndKeepsPlayableResource(t *testing.T) {
	svc := newResourceTestService(t)
	svc.mode = serviceModeLocal
	svc.localResourceStorage = true
	outputDir := filepath.Join(t.TempDir(), "项目输出", "videos")
	svc.SetGeneratedVideoOutputDir(outputDir)
	clip := syntheticVideoMP4(1280, 720, 5042)
	result, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{
		"videos": []interface{}{map[string]interface{}{"dataUrl": "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(clip)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	video := result["videos"].([]interface{})[0].(map[string]interface{})
	resourceID := stringField(video, "resourceId")
	resource, err := svc.repo.ResourceForUser("user-1", resourceID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stringField(video, "url"), "/api/resources/"+resourceID+"/file") {
		t.Fatalf("playback no longer uses the owned resource: %v", video["url"])
	}
	for _, file := range []string{
		filepath.Join(outputDir, "video-"+resourceID+".mp4"),
		filepath.Join(svc.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)),
	} {
		data, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(data, clip) {
			t.Fatalf("original bytes were not preserved in %s: %v", file, err)
		}
	}
	if err := svc.exportGeneratedVideo(resource); err != nil {
		t.Fatalf("repeating the same export failed: %v", err)
	}
	entries, err := os.ReadDir(outputDir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "video-"+resourceID+".mp4" {
		t.Fatalf("export left duplicates or temporary files: %v, %v", entries, err)
	}
}

func TestGeneratedVideoExportFailureDoesNotFailGeneration(t *testing.T) {
	svc := newResourceTestService(t)
	svc.mode = serviceModeLocal
	svc.localResourceStorage = true
	blockedDir := filepath.Join(t.TempDir(), "occupied")
	if err := os.WriteFile(blockedDir, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc.SetGeneratedVideoOutputDir(blockedDir)
	clip := syntheticVideoMP4(1280, 720, 5000)
	result, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{
		"video": map[string]interface{}{"dataUrl": "data:video/mp4;base64," + base64.StdEncoding.EncodeToString(clip)},
	})
	if err != nil {
		t.Fatalf("an output copy failure must not resubmit a paid generation: %v", err)
	}
	video := result["video"].(map[string]interface{})
	resource, err := svc.repo.ResourceForUser("user-1", stringField(video, "resourceId"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil || !bytes.Equal(data, clip) {
		t.Fatalf("original unavailable after export failure: %v", err)
	}
	data, err = os.ReadFile(blockedDir)
	if err != nil || string(data) != "keep" {
		t.Fatalf("unrelated destination was overwritten: %v", err)
	}
}

func TestGeneratedVideoExportDoesNotIncludeUploadsImagesOrHostedResults(t *testing.T) {
	for _, scenario := range []string{"upload", "image", "hosted"} {
		t.Run(scenario, func(t *testing.T) {
			svc := newResourceTestService(t)
			svc.mode = serviceModeLocal
			svc.localResourceStorage = true
			outputDir := filepath.Join(t.TempDir(), "output", "videos")
			svc.SetGeneratedVideoOutputDir(outputDir)
			if scenario == "upload" {
				if _, _, err := svc.storeResource("user-1", "video", "upload.mp4", "video/mp4", 4, 1, 1, 0, bytes.NewReader([]byte("data")), nil, true); err != nil {
					t.Fatal(err)
				}
			} else {
				mimeType := "image/png"
				if scenario == "hosted" {
					svc.mode = serviceModeHosted
					mimeType = "video/mp4"
				}
				if _, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{"dataUrl": "data:" + mimeType + ";base64,YQ=="}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := os.Stat(outputDir); !os.IsNotExist(err) {
				t.Fatalf("unexpected output for %s: %v", scenario, err)
			}
		})
	}
}
