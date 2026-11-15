package modelcatalog

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestKanhaiCatalogUsesVideoCapabilitiesAndPoints(t *testing.T) {
	body, err := os.ReadFile("testdata/kanhai-models.json")
	if err != nil {
		t.Fatal(err)
	}
	items, err := LoadChannelModelCatalog(context.Background(), func(context.Context, string, string, string, []ChannelHeader) ([]byte, error) { return body, nil }, "https://yioapp.top/openapi/v1", "openai", "synthetic-key", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	lookup := map[string]ChannelModelCatalogItem{}
	for _, item := range items {
		if item.ModelType != "video" || strings.Contains(item.ID, "gpt-image") {
			t.Fatalf("non-video leaked: %s", item.ID)
		}
		if !strings.Contains(item.DisplayName, "积分/") || strings.Contains(item.DisplayName, "¥") {
			t.Fatalf("wrong price: %s", item.DisplayName)
		}
		lookup[item.ID] = item
	}
	var video VideoCapabilityConfig
	if err := json.Unmarshal(lookup["chaomeng-video-88b0bf9d5c3f"].VideoCapabilities, &video); err != nil {
		t.Fatal(err)
	}
	if video.References.MaxImages != 9 || video.References.MaxVideos != 0 || video.References.MaxAudios != 3 || len(video.Resolutions) != 1 || video.Resolutions[0] != "1080p" || !containsKanhaiDuration(video.Duration.Values, 30) {
		t.Fatalf("marketing title overrode structured capability: %#v", video)
	}
	if !strings.Contains(lookup["DB-SD-2.5"].DisplayName, "不卡人脸（渠道声明）") {
		t.Fatal("face support missing")
	}
	if strings.Contains(lookup["seedance-2.5-720p-c4"].DisplayName, "不卡人脸（渠道声明）") {
		t.Fatal("invented face support")
	}
	if !strings.Contains(lookup["JL-seedance-2.5-720p"].DisplayName, "4.8积分/秒") {
		t.Fatal("per-second price lost")
	}
	if !strings.Contains(lookup["lingjing-sd2.5"].DisplayName, "维护中") {
		t.Fatal("maintenance hidden")
	}
	if _, ok := lookup["vs-sd 2.5-a"]; !ok {
		t.Fatal("model ID with space changed")
	}
}

func TestKanhaiAccountPriceAndEnvelope(t *testing.T) {
	for _, body := range []string{
		`{"models":[{"id":"opaque","type":"video","normalPoints":50,"memberPoints":48,"effective_price":{"points":35}}]}`,
		`{"data":{"models":[{"id":"opaque","generationType":"video","effective_price":{"points":35}}]}}`,
		`[{"id":"opaque","type":"video","effective_price":{"points":35}}]`,
	} {
		items, err := ParseKanhaiVideoCatalog([]byte(body))
		if err != nil || len(items) != 1 || !strings.Contains(items[0].DisplayName, "本账号 35积分/条") {
			t.Fatalf("account price/envelope lost: %#v %v", items, err)
		}
	}
	if IsKanhaiBaseURL("https://other.example/openapi/v1") || IsKanhaiBaseURL("https://yioapp.top/v1") {
		t.Fatal("provider boundary broadened")
	}
}

func TestKanhaiFaceSupportDoesNotOverrideExplicitFalse(t *testing.T) {
	for _, entry := range []string{
		`{"id":"opaque","type":"video","name":"过人脸","supportsRealPerson":false}`,
		`{"id":"opaque","type":"video","name":"不过人脸"}`,
		`{"id":"opaque","type":"video","name":"不过真人"}`,
	} {
		items, err := ParseKanhaiVideoCatalog([]byte(`{"data":[` + entry + `]}`))
		if err != nil || len(items) != 1 || strings.Contains(items[0].DisplayName, "不卡人脸（渠道声明）") {
			t.Fatalf("invented face support: %#v %v", items, err)
		}
	}
}
