package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 前台模型目录为空时也必须发 models: []，不能因为 omitempty 丢掉字段：
// 前端在 source=frontend 时强制校验 models 是数组，缺字段会被判成畸形响应；
// 而 auth-session-hydrator 会把该异常当成未登录并清掉会话，表现为刷新后跳回登录页。
func TestModelCatalogAlwaysSerializesCollectionsAsArrays(t *testing.T) {
	for _, test := range []struct {
		name            string
		frontendEnabled bool
		wantSource      string
	}{
		{name: "空的前台模型目录", frontendEnabled: true, wantSource: "frontend"},
		{name: "空的系统渠道目录", frontendEnabled: false, wantSource: "system"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := newModelCatalogTestService(t)
			if test.frontendEnabled {
				if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"frontendModelsEnabled":true}`}).Error; err != nil {
					t.Fatal(err)
				}
			}

			catalog, err := svc.ModelCatalog(nil)
			if err != nil {
				t.Fatal(err)
			}
			if string(catalog.Source) != test.wantSource {
				t.Fatalf("source = %q, want %q", catalog.Source, test.wantSource)
			}

			encoded, err := json.Marshal(catalog)
			if err != nil {
				t.Fatal(err)
			}
			var payload map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &payload); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"models", "channels"} {
				raw, present := payload[key]
				if !present || string(raw) == "null" {
					t.Fatalf("%s 集合没有序列化成数组：%s", key, encoded)
				}
			}
		})
	}
}

func TestNormalizeEggfansCatalogURL(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{name: "pricing page", raw: "https://api.eggfans.com/pricing", want: "https://api.eggfans.com/api/pricing_new", ok: true},
		{name: "pricing page trailing slash", raw: "https://api.eggfans.com/pricing/", want: "https://api.eggfans.com/api/pricing_new", ok: true},
		{name: "other catalog", raw: "https://models.example.com/catalog", want: "https://models.example.com/catalog", ok: true},
		{name: "relative path", raw: "/pricing", want: "/pricing", ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := normalizeEggfansCatalogURL(test.raw)
			if got != test.want || ok != test.ok {
				t.Fatalf("normalizeEggfansCatalogURL(%q) = %q, %v; want %q, %v", test.raw, got, ok, test.want, test.ok)
			}
		})
	}
}

func TestNormalizeJiasuCatalogURL(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{name: "pricing page", raw: "https://www.gway.dev/pricing", want: "https://www.gway.dev/api/pricing?surface=plaza", ok: true},
		{name: "legacy pricing page", raw: "https://ai.jiasuapi.com/pricing/", want: "https://www.gway.dev/api/pricing?surface=plaza", ok: true},
		{name: "other host", raw: "https://models.example.com/pricing", want: "https://models.example.com/pricing", ok: true},
		{name: "relative path", raw: "/pricing", want: "/pricing", ok: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := normalizeJiasuCatalogURL(test.raw)
			if got != test.want || ok != test.ok {
				t.Fatalf("normalizeJiasuCatalogURL(%q) = %q, %v; want %q, %v", test.raw, got, ok, test.want, test.ok)
			}
		})
	}
}

func newModelCatalogTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.LogicalModel{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}
