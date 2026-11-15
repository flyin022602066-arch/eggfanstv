package characterlooks

import (
	"strings"
	"testing"
)

func TestExtractNumberedLooksKeepsEveryOutfitSeparate(t *testing.T) {
	definition := map[string]any{"name": "云舒", "appearance": "22岁，黑色中长发", "clothing": "造型1（云舒-居家02）：黑色细吊带睡裙，外搭米白针织开衫；造型2（云舒-居家01）：浅粉色毛绒连体长袖长裤睡衣；造型3（云舒-前置01）：浅米白圆领长袖棉质上衣，浅灰直筒长裤", "consistencyPrompt": "主造型穿黑色细吊带睡裙", "multiViewPrompt": "白色上衣的三视图", "voiceTimbre": "轻柔"}
	looks, err := Extract(definition)
	if err != nil || len(looks) != 3 {
		t.Fatalf("looks=%+v error=%v", looks, err)
	}
	for i, look := range looks {
		d := Definition(definition, look)
		if d["voiceTimbre"] != "轻柔" || d["appearance"] != definition["appearance"] {
			t.Fatal("lost shared identity")
		}
		if strings.Contains(d["clothing"].(string), "造型2") || d["clothing"] != look.Clothing {
			t.Fatal("mixed outfits")
		}
		if i > 0 && strings.Contains(d["consistencyPrompt"].(string), "黑色细吊带睡裙") {
			t.Fatal("stale default outfit leaked")
		}
		if d["looks"] != nil {
			t.Fatal("siblings leaked into isolated definition")
		}
	}
	if looks[0].Name != "云舒-居家02" || looks[2].Name != "云舒-前置01" {
		t.Fatal(looks)
	}
}

func TestExtractStructuredAndSequentialLooks(t *testing.T) {
	for _, d := range []map[string]any{
		{"clothing": "白衬衫；后换为黑色长裙"},
		{"clothing": "白衬衫", "looks": []any{map[string]any{"name": "日常", "clothing": "白衬衫", "matchHints": "出门前"}, map[string]any{"name": "晚宴", "clothing": "黑色长裙", "matchHints": "晚宴"}}},
	} {
		got, err := Extract(d)
		if err != nil || len(got) != 2 {
			t.Fatalf("%+v %v", got, err)
		}
	}
	got, err := Extract(map[string]any{"clothing": "白衬衫搭配黑色长裤、外套"})
	if err != nil || len(got) != 1 {
		t.Fatal(got, err)
	}
	got, err = Extract(map[string]any{"clothing": "正文未明确"})
	if err != nil || len(got) != 1 {
		t.Fatal(got, err)
	}
}

func TestInvalidStructuredLooksFailInsteadOfDroppingStates(t *testing.T) {
	for _, value := range []any{"白裙、黑裙", []any{map[string]any{"name": "晚宴"}}, []any{map[string]any{"name": "日常", "clothing": "白衬衫"}, map[string]any{"name": "日常", "clothing": "黑裙"}}} {
		if _, err := Extract(map[string]any{"looks": value}); err == nil {
			t.Fatal("invalid looks accepted", value)
		}
	}
}

func TestExtractNumberedLooksWithSpaces(t *testing.T) {
	looks, err := Extract(map[string]any{"clothing": "造型1 （日常） ： 白衣；造型2 （晚宴） ： 黑裙"})
	if err != nil || len(looks) != 2 {
		t.Fatalf("%+v %v", looks, err)
	}
}

func TestLookKeySurvivesIsolatedDefinition(t *testing.T) {
	d := map[string]any{"appearance": "黑发", "ageStage": "青年", "state": "受伤", "looks": []Look{{Name: "日常", Clothing: "白衣"}, {Name: "战斗", Clothing: "黑甲", State: "痊愈"}}}
	looks, err := Extract(d)
	if err != nil {
		t.Fatal(err)
	}
	for _, look := range looks {
		isolated, _ := Extract(Definition(d, look))
		if len(isolated) != 1 || Key(isolated[0]) != Key(look) {
			t.Fatal("look key changed after saving", look, isolated)
		}
	}
}

func TestVisualDesignAnchorsSurviveWardrobeIsolation(t *testing.T) {
	definition := map[string]any{
		"name": "陈尧", "role": "军医",
		"appearance": "美术补全·非原文事实：狭长眼、平直浓眉", "physique": "清瘦，肩背挺直",
		"looks": []Look{{Name: "常服", Clothing: "深灰夹克，窄立领"}, {Name: "防护", Clothing: "白色防护外套"}},
	}
	looks, err := Extract(definition)
	if err != nil {
		t.Fatal(err)
	}
	for _, look := range looks {
		isolated := Definition(definition, look)
		if isolated["appearance"] != definition["appearance"] || isolated["physique"] != definition["physique"] {
			t.Fatal("wardrobe isolation lost stable visual design anchors")
		}
		for _, field := range []string{"consistencyPrompt", "multiViewPrompt"} {
			prompt := text(isolated[field])
			for _, required := range []string{"狭长眼", "平直浓眉", "肩背挺直", look.Clothing} {
				if !strings.Contains(prompt, required) {
					t.Errorf("%s lost visual anchor %q", field, required)
				}
			}
		}
	}
}

func TestStructuredLooksKeepTheirOwnEquipmentAndBody(t *testing.T) {
	definition := map[string]any{
		"appearance": "暗金甲壳巨兽", "physique": "沉重的四足体型", "clothing": "背负合金架", "props": "背部合金架、胸前旧箍",
		"looks": []map[string]any{
			{"name": "负重", "clothing": "背负合金架", "props": "背部合金架、胸前旧箍"},
			{"name": "卸除束缚", "clothing": "合金架与前箍已完全卸除", "props": "", "physique": "卸载后轻快的四足体型"},
			{"name": "新护具", "clothing": "换上新护具", "props": "蓝色护肩"},
		},
	}
	looks, err := Extract(definition)
	if err != nil {
		t.Fatal(err)
	}
	for index, expected := range []string{"背部合金架、胸前旧箍", "", "蓝色护肩"} {
		isolated := Definition(definition, looks[index])
		if isolated["props"] != expected {
			t.Errorf("look %d props=%v, want %q", index, isolated["props"], expected)
		}
		if index == 1 {
			if isolated["physique"] != "卸载后轻快的四足体型" {
				t.Errorf("later body design lost: %v", isolated["physique"])
			}
			for _, field := range []string{"consistencyPrompt", "multiViewPrompt"} {
				if strings.Contains(text(isolated[field]), "背部合金架、胸前旧箍") {
					t.Errorf("%s restored removed equipment", field)
				}
			}
		}
	}
	if definition["props"] != "背部合金架、胸前旧箍" {
		t.Fatal("base definition was mutated")
	}
}

func TestMissingEquipmentDoesNotCopyAnotherLook(t *testing.T) {
	definition := map[string]any{
		"clothing": "黑甲", "props": "头盔、胸甲",
		"looks": []map[string]any{{"name": "战斗", "clothing": "黑甲"}, {"name": "常服", "clothing": "换成白衬衫"}},
	}
	looks, err := Extract(definition)
	if err != nil {
		t.Fatal(err)
	}
	if Definition(definition, looks[0])["props"] != "头盔、胸甲" {
		t.Fatal("first look lost its equipment")
	}
	if got := Definition(definition, looks[1])["props"]; got != "" {
		t.Fatalf("later look copied old equipment: %v", got)
	}
}
