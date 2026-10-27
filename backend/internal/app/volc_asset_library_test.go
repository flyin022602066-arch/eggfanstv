package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func saveVolcLibraryTestConfig(t *testing.T, svc *Service, baseURL, key string) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"volcAssetLibrary": map[string]any{"enabled": true, "baseUrl": baseURL + "/v1", "apiKey": key, "groupName": "测试角色组", "projectName": "default"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveLocalModelConfig(body); err != nil {
		t.Fatal(err)
	}
}

func TestVolcAssetLibraryURLToURIUsesIndependentCredentialsAndPersists(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	uploads, creates, lists := 0, 0, 0
	svc.temporaryImages = imageUploadTestFunc(func(_ context.Context, owner string, data []byte) (string, error) {
		uploads++
		if owner != "user-1" || !bytes.Equal(data, original) {
			t.Fatal("wrong upload source")
		}
		return "https://h.uguu.se/latest.png", nil
	})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer asset-upload-key" || request.Header.Get("X-Video-Key") != "" {
			t.Fatal("video credentials leaked into asset upload")
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.Method + " " + request.URL.Path {
		case "GET /v1/assets/groups":
			lists++
			if request.URL.Query().Get("name") != "测试角色组" || request.URL.Query().Get("page_size") != "100" {
				t.Error("wrong group query")
			}
			fmt.Fprint(writer, `{"success":true,"data":{"items":[{"id":"local-group","provider_group_id":"provider-group","name":"测试角色组"}]}}`)
		case "POST /v1/assets":
			creates++
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["group_id"] != "local-group" || body["url"] != "https://h.uguu.se/latest.png" || body["name"] != "角色A" || body["asset_type"] != "Image" || body["project_name"] != "default" || body["wait_for_active"] != true || body["timeout_ms"] != float64(120000) || body["model"] != nil || body["GroupId"] != nil {
				t.Errorf("wrong asset contract: %#v", body)
			}
			fmt.Fprint(writer, `{"success":true,"data":{"id":"aggregation-record","provider_asset_id":"asset-official-1","asset_uri":"asset://asset-official-1","status":"Active"}}`)
		default:
			t.Errorf("unexpected route: %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	saveVolcLibraryTestConfig(t, svc, server.URL, "asset-upload-key")
	now := time.Now().UTC()
	if err := svc.repo.SaveResourceTemporaryImageURL("user-1", "local-image", "https://h.uguu.se/expired.png", now.Add(-4*time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{BaseURL: "https://api.eggfans.com", APIKey: "video-key", Model: "doubao-seedance-2-5-260628", InterfaceType: "eggfans-seedance-video", VideoSeconds: "27", Size: "9:16", VQuality: "720", Headers: []OutboundHeader{{Name: "X-Video-Key", Value: "video-header"}}}
	for attempt := 0; attempt < 2; attempt++ {
		input := canvasGenerationInput{Mode: "video", Prompt: "@角色A 走入街道", Config: config, ReferenceImages: []providerMedia{{Name: "角色A", StorageKey: "resource:local-image"}}}
		svc.eggfansAssetLocks.Clear()
		if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input); err != nil {
			t.Fatal(err)
		}
		if input.ReferenceImages[0].URL != "asset://asset-official-1" || input.Config.APIKey != "video-key" || input.Config.BaseURL != "https://api.eggfans.com" {
			t.Fatal("URI or video channel changed")
		}
		adapter := officialSourceProviderAdapter(t, "eggfans-seedance", "eggfans-seedance-video")
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		body := marshalProtocolBody(t, spec.Body)
		content := body["content"].([]any)
		reference := content[1].(map[string]any)
		if reference["role"] != "reference_image" || reference["image_url"].(map[string]any)["url"] != "asset://asset-official-1" || body["duration"] != float64(27) || body["ratio"] != "9:16" {
			t.Fatalf("Seedance reference contract changed: %#v", body)
		}
	}
	if uploads != 1 || creates != 1 || lists != 1 {
		t.Fatalf("duplicate uploads: %d %d %d", uploads, creates, lists)
	}
	records, err := svc.ListVolcLibraryAssets("user-1")
	if err != nil || len(records) != 1 || records[0].URI != "asset://asset-official-1" || records[0].ResourceID != "local-image" {
		t.Fatalf("local URI record missing: %#v %v", records, err)
	}
	archived, err := os.ReadFile(filepath.Join(svc.volcLibraryDir("user-1"), records[0].ImageFile))
	if err != nil || !bytes.Equal(archived, original) {
		t.Fatal("local asset library lost original image")
	}
	jsonRecord, err := os.ReadFile(filepath.Join(svc.volcLibraryDir("user-1"), records[0].ID+".json"))
	if err != nil || bytes.Contains(jsonRecord, []byte("asset-upload-key")) || bytes.Contains(jsonRecord, []byte("video-key")) {
		t.Fatal("local URI record leaked credentials")
	}
	foreignRecords, err := svc.ListVolcLibraryAssets("other-user")
	if err != nil || len(foreignRecords) != 0 {
		t.Fatal("local asset library crossed users")
	}
	sd2 := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "eggfans-sd2-video"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &sd2); err != nil {
		t.Fatal(err)
	}
	if err := svc.hydrateGenerationMedia(context.Background(), "user-1", &sd2, providerMediaHydrationPolicy{requireURL: true}); err != nil || sd2.ReferenceImages[0].URL != "https://h.uguu.se/latest.png" || creates != 1 {
		t.Fatalf("SD2 URI pollution: %v", err)
	}
	foreign := canvasGenerationInput{Mode: "video", Config: config, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "other-user", &foreign); err == nil || creates != 1 {
		t.Fatal("foreign resource uploaded")
	}
}

func TestVolcAssetLibraryRejectsUnreadyURIAndDoesNotRepeatAmbiguousCreation(t *testing.T) {
	for _, response := range []string{
		`{"success":true,"data":{"id":"local-only","status":"Active"}}`,
		`{"success":true,"data":{"provider_asset_id":"asset-one","asset_uri":"asset://asset-one","status":"Processing"}}`,
		`{"success":true,"data":{"provider_asset_id":"asset-two","asset_uri":"asset://asset-one","status":"Active"}}`,
		`{"success":false,"code":403,"error":"permission denied"}`,
	} {
		t.Run(response, func(t *testing.T) {
			svc, _ := temporaryImageTestResource(t)
			svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) { return "https://h.uguu.se/image.png", nil })
			creates := 0
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method == http.MethodGet {
					fmt.Fprint(writer, `{"success":true,"data":[{"id":"group","name":"测试角色组"}]}`)
				} else {
					creates++
					fmt.Fprint(writer, response)
				}
			}))
			defer server.Close()
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			saveVolcLibraryTestConfig(t, svc, server.URL, "asset-key")
			for attempt := 0; attempt < 2; attempt++ {
				input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "eggfans-seedance-video"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
				if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input); err == nil || input.ReferenceImages[0].URL != "" {
					t.Fatal("invalid asset became usable")
				}
			}
			if creates != 1 {
				t.Fatal("ambiguous create retried")
			}
		})
	}
}

func TestVolcAssetLibraryMissingKeyStopsBeforeHosting(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	saveVolcLibraryTestConfig(t, svc, "https://20nbifxd.magine.work", "")
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		t.Fatal("uploaded without asset credentials")
		return "", nil
	})
	input := canvasGenerationInput{Mode: "video", Config: providerConfig{InterfaceType: "eggfans-seedance-video"}, ReferenceImages: []providerMedia{{StorageKey: "resource:local-image"}}}
	if err := svc.prepareEggfansPrivateAssetReferences(context.Background(), "user-1", &input); err == nil || !strings.Contains(err.Error(), "资产上传 Key") {
		t.Fatalf("missing upload key was not actionable: %v", err)
	}
}

func TestVolcAssetLibraryGroupFilterFallbackCreatesDocumentedGroup(t *testing.T) {
	svc, _ := temporaryImageTestResource(t)
	reads, creates := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet {
			reads++
			if request.URL.Query().Get("name") != "" {
				writer.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(writer, `{"error":"where express error:DESCRIPTION"}`)
			} else {
				fmt.Fprint(writer, `{"success":true,"data":[]}`)
			}
			return
		}
		creates++
		var body map[string]any
		json.NewDecoder(request.Body).Decode(&body)
		if body["name"] != "测试角色组" || body["project_name"] != "default" || body["description"] != "测试角色组 剧本素材组" {
			t.Errorf("invalid group: %#v", body)
		}
		fmt.Fprint(writer, `{"code":200,"data":{"id":"local-group","provider_group_id":"wrong-group"}}`)
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	config := volcAssetLibraryConfig{Enabled: true, BaseURL: server.URL + "/v1", APIKey: "upload-key", GroupName: "测试角色组", ProjectName: "default"}
	for attempt := 0; attempt < 2; attempt++ {
		id, err := svc.ensureVolcLibraryGroup(context.Background(), "user-1", config)
		if err != nil || id != "local-group" {
			t.Fatalf("group failed: %s %v", id, err)
		}
	}
	if reads != 2 || creates != 1 {
		t.Fatal("group cache or filter fallback failed")
	}
}

func TestVolcAssetLibraryDefaultArchiveStaysUnderProjectRoot(t *testing.T) {
	projectRoot := t.TempDir()
	svc := &Service{dataDir: filepath.Join(projectRoot, ".local", "EggfansTV")}
	expected := filepath.Join(projectRoot, "asset-library", "volc", sha256Hex([]byte("user-1")))
	if svc.volcLibraryDir("user-1") != expected {
		t.Fatal("archive escaped project root")
	}
}

func TestVolcAssetLibraryNumericGroupRecordsReachAssetCreation(t *testing.T) {
	for _, createGroup := range []bool{false, true} {
		t.Run(fmt.Sprintf("create-group-%t", createGroup), func(t *testing.T) {
			svc, _ := temporaryImageTestResource(t)
			uploads, groupCreates, assetCreates := 0, 0, 0
			svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
				uploads++
				return "https://h.uguu.se/original.png", nil
			})
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				switch request.Method + " " + request.URL.Path {
				case "GET /v1/assets/groups":
					if createGroup {
						fmt.Fprint(writer, `{"data":[],"meta":{"total":0,"page":1,"page_size":100}}`)
					} else {
						fmt.Fprint(writer, `{"data":[{"id":3118,"provider_group_id":"group-native","name":"测试角色组","project_name":"default"}],"meta":{"total":1,"page":1,"page_size":100}}`)
					}
				case "POST /v1/assets/groups":
					groupCreates++
					fmt.Fprint(writer, `{"success":true,"data":{"id":3118,"provider_group_id":"group-native"}}`)
				case "POST /v1/assets":
					assetCreates++
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["group_id"] != float64(3118) || body["url"] != "https://h.uguu.se/original.png" {
						t.Errorf("numeric aggregation record ID was not preserved: %#v", body)
					}
					fmt.Fprint(writer, `{"data":{"id":123456,"provider_asset_id":"asset-numeric-group","asset_uri":"Asset://asset-numeric-group","status":"Active"}}`)
				default:
					t.Errorf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
			}))
			defer server.Close()
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			saveVolcLibraryTestConfig(t, svc, server.URL, "upload-key")
			for attempt := 0; attempt < 2; attempt++ {
				binding, err := svc.SyncResourceToVolcLibrary(context.Background(), "user-1", "local-image", "角色图")
				if err != nil || binding.AssetGroupID != "3118" || binding.URI != "asset://asset-numeric-group" {
					t.Fatalf("numeric group did not produce a reusable URI: %#v %v", binding, err)
				}
			}
			expectedGroupCreates := 0
			if createGroup {
				expectedGroupCreates = 1
			}
			if uploads != 1 || assetCreates != 1 || groupCreates != expectedGroupCreates {
				t.Fatalf("duplicate or missing operations: uploads=%d groups=%d assets=%d", uploads, groupCreates, assetCreates)
			}
		})
	}
}

func TestVolcAssetLibraryRecoversCreatedAssetWithoutRepeatedUpload(t *testing.T) {
	svc, original := temporaryImageTestResource(t)
	reads := 0
	svc.temporaryImages = imageUploadTestFunc(func(context.Context, string, []byte) (string, error) {
		t.Fatal("created asset must not be uploaded again")
		return "", nil
	})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/v1/assets" || request.URL.Query().Get("provider_asset_id") != "asset-already-created" {
			t.Errorf("recovery must only query the known provider asset: %s %s", request.Method, request.URL)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		reads++
		fmt.Fprint(writer, `{"data":[{"provider_asset_id":"asset-unrelated","asset_uri":"Asset://asset-unrelated","status":"Active"},{"id":2511,"provider_asset_id":"asset-already-created","asset_uri":"Asset://asset-already-created","status":"Active"}],"meta":{"total":2}}`)
	}))
	defer server.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	saveVolcLibraryTestConfig(t, svc, server.URL, "upload-key")
	config, err := svc.readVolcAssetLibraryConfig()
	if err != nil {
		t.Fatal(err)
	}
	binding := &model.EggfansAssetBinding{ID: "recovery-binding", UserID: "user-1", AccountScope: volcLibraryScope("user-1", config), SourceKey: sha256Hex([]byte("Image\x00local-image\x00" + config.GroupName)), ResourceID: "local-image", BaseURL: config.BaseURL, AssetType: "Image", AssetGroupID: "11180", AssetID: "asset-already-created", Status: "unknown", CreatedAt: time.Now().UTC()}
	if err := svc.repo.SaveEggfansAssetBinding(binding); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		recovered, err := svc.SyncResourceToVolcLibrary(context.Background(), "user-1", "local-image", "角色图")
		if err != nil || recovered.Status != "active" || recovered.URI != "asset://asset-already-created" {
			t.Fatalf("created asset recovery failed: %#v %v", recovered, err)
		}
	}
	records, err := svc.ListVolcLibraryAssets("user-1")
	if err != nil || len(records) != 1 || reads != 1 {
		t.Fatalf("recovered record missing or queried repeatedly: %#v %d %v", records, reads, err)
	}
	archived, err := os.ReadFile(filepath.Join(svc.volcLibraryDir("user-1"), records[0].ImageFile))
	if err != nil || !bytes.Equal(archived, original) {
		t.Fatal("recovery did not archive the original image")
	}
}
