package modelcatalog

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestLoadGwayCatalogNativeParameters(t *testing.T) {
	payload := []byte(`{"data":[{"model_name":"seedance-2.5-g5-v3","supported_endpoint_types":["openai-video"],"api_parameters":"[{\"name\":\"duration\",\"range\":\"4 ~ 30\",\"default\":\"30\"},{\"name\":\"ratio\",\"range\":\"16:9, 9:16, 1:1\",\"default\":\"16:9\"},{\"name\":\"resolution\",\"range\":\"480p, 720p\",\"default\":\"720p\"},{\"name\":\"images\",\"range\":\"0-10\"},{\"name\":\"videos\",\"range\":\"0\"},{\"name\":\"audios\",\"range\":\"0-5\"}]","quota_type":1,"model_price":3.5}]}`)
	fetch := func(context.Context, string, string, string, []ChannelHeader) ([]byte, error) { return payload, nil }
	for _, host := range []string{"https://www.gway.dev", "https://ai.jiasuapi.com/v1"} {
		items, err := LoadChannelModelCatalog(context.Background(), fetch, host, "openai", "synthetic-key", nil, nil)
		if err != nil || len(items) != 1 {
			t.Fatalf("load = %#v, %v", items, err)
		}
		var video VideoCapabilityConfig
		if err := json.Unmarshal(items[0].VideoCapabilities, &video); err != nil {
			t.Fatal(err)
		}
		if video.Duration.Min != 4 || video.Duration.Max != 30 || video.Duration.Default != 30 || !reflect.DeepEqual(video.Resolutions, []string{"480p", "720p"}) || video.DefaultResolution != "720p" {
			t.Fatalf("native output options = %#v", video)
		}
		if video.References.MaxImages != 10 || video.References.MaxVideos != 0 || video.References.MaxAudios != 5 || !video.GenerateAudio.Default {
			t.Fatalf("native references/audio = %#v", video)
		}
		profile, err := NormalizeModelCapabilityConfigForModel("video", "jiasu-video", items[0].ID, &ModelCapabilityConfig{Version: 1, Video: &video})
		if err != nil || !reflect.DeepEqual(profile.Video, &video) {
			t.Fatalf("normalization overwrote catalog: %#v, %v", profile, err)
		}
	}
	items, err := LoadChannelModelCatalog(context.Background(), fetch, "https://other.example", "openai", "synthetic-key", nil, nil)
	if err != nil || len(items[0].VideoCapabilities) != 0 {
		t.Fatalf("Gway metadata affected another channel: %#v, %v", items, err)
	}
}

func TestGwayH3DefaultUsesCurrentPublicContract(t *testing.T) {
	video := DefaultModelCapabilityConfigForModel("jiasu-video", "minimax-h3").Video
	if video.Duration.Selection != "range" || video.Duration.Min != 4 || video.Duration.Max != 30 || !reflect.DeepEqual(video.Resolutions, []string{"768p"}) || video.DefaultResolution != "768p" {
		t.Fatalf("H3 uses obsolete forced settings: %#v", video)
	}
}

func TestGwayCatalogArrayParametersAndMalformedMetadata(t *testing.T) {
	items, err := parseGwayVideoCatalog([]byte(`{"data":[{"id":"wan3-特惠","supported_endpoint_types":["openai-video"],"api_parameters":[{"name":"duration","range":"10~30","default":30},{"name":"resolution","range":"1080p","default":"1080p"}]},{"id":"invalid-metadata","supported_endpoint_types":["openai-video"],"api_parameters":"not-json"}]}`), "openai")
	if err != nil || len(items) != 2 {
		t.Fatalf("array catalog = %#v, %v", items, err)
	}
	if len(items[0].VideoCapabilities) != 0 {
		t.Fatal("malformed metadata was converted into fabricated capabilities")
	}
	var video VideoCapabilityConfig
	if err := json.Unmarshal(items[1].VideoCapabilities, &video); err != nil {
		t.Fatal(err)
	}
	profile, err := NormalizeModelCapabilityConfigForModel("video", "jiasu-video", items[1].ID, &ModelCapabilityConfig{Version: 1, Video: &video})
	if err != nil || profile.Video.Duration.Min != 10 || profile.Video.Duration.Default != 30 {
		t.Fatalf("Wan catalog settings overwritten: %#v, %v", profile, err)
	}
}
