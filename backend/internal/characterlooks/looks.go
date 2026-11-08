// Package characterlooks separates wardrobe states from a shared character identity.
package characterlooks

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type Look struct {
	Name           string `json:"name"`
	Clothing       string `json:"clothing"`
	Appearance     string `json:"appearance,omitempty"`
	AgeStage       string `json:"ageStage,omitempty"`
	Hairstyle      string `json:"hairstyle,omitempty"`
	State          string `json:"state,omitempty"`
	MatchHints     string `json:"matchHints,omitempty"`
	ExcludeHints   string `json:"excludeHints,omitempty"`
	ChangeReason   string `json:"changeReason,omitempty"`
	SourceEvidence string `json:"sourceEvidence,omitempty"`
}

var numbered = regexp.MustCompile(`(?:造型|服装|形态)\s*[一二三四五六七八九十0-9]+\s*[（(]([^）)]+)[）)]\s*[：:]|(?:造型|服装|形态)\s*[一二三四五六七八九十0-9]+\s*[：:]`)
var switched = regexp.MustCompile(`[；;]\s*(?:后|随后|之后|接着|再)?\s*(?:换为|换成|换上|换穿|改穿|更换为)\s*`)

func text(value any) string { v, _ := value.(string); return strings.TrimSpace(v) }

func inherit(look Look, d map[string]any) Look {
	if look.Appearance == "" {
		look.Appearance = text(d["appearance"])
	}
	if look.AgeStage == "" {
		look.AgeStage = text(d["ageStage"])
	}
	if look.Hairstyle == "" {
		look.Hairstyle = text(d["hairstyle"])
	}
	if look.State == "" {
		look.State = text(d["state"])
	}
	return look
}

func Extract(definition map[string]any) ([]Look, error) {
	if raw, ok := definition["looks"]; ok {
		encoded, err := json.Marshal(raw)
		if err != nil {
			return nil, err
		}
		var looks []Look
		if json.Unmarshal(encoded, &looks) != nil || len(looks) == 0 || len(looks) > 24 {
			return nil, fmt.Errorf("角色造型必须为 1 到 24 项的数组")
		}
		seen := map[string]bool{}
		for i := range looks {
			looks[i].Name = strings.TrimSpace(looks[i].Name)
			looks[i].Clothing = strings.TrimSpace(looks[i].Clothing)
			if looks[i].Name == "" || len([]rune(looks[i].Name)) > 80 || looks[i].Clothing == "" || seen[looks[i].Name] || len(numbered.FindAllStringIndex(looks[i].Clothing, -1)) > 1 || switched.MatchString(looks[i].Clothing) {
				return nil, fmt.Errorf("第 %d 套角色造型缺少名称、单套服装或名称重复", i+1)
			}
			seen[looks[i].Name] = true
			looks[i] = inherit(looks[i], definition)
		}
		return looks, nil
	}
	clothing := text(definition["clothing"])
	indices := numbered.FindAllStringSubmatchIndex(clothing, -1)
	if len(indices) > 1 {
		looks := make([]Look, 0, len(indices))
		for i, m := range indices {
			end := len(clothing)
			if i+1 < len(indices) {
				end = indices[i+1][0]
			}
			name := fmt.Sprintf("造型%d", i+1)
			if m[2] >= 0 {
				name = clothing[m[2]:m[3]]
			}
			outfit := strings.Trim(clothing[m[1]:end], " \t\r\n；;。")
			if outfit == "" {
				return nil, fmt.Errorf("%s 缺少服装说明", name)
			}
			looks = append(looks, inherit(Look{Name: name, Clothing: outfit}, definition))
		}
		if len(looks) > 24 {
			return nil, fmt.Errorf("角色造型超过 24 套，请分批整理")
		}
		return looks, nil
	}
	parts := switched.Split(clothing, -1)
	if len(parts) > 1 {
		if len(parts) > 24 {
			return nil, fmt.Errorf("角色造型超过 24 套，请分批整理")
		}
		looks := make([]Look, 0, len(parts))
		for i, part := range parts {
			outfit := strings.Trim(part, " \t\r\n；;。")
			if outfit == "" {
				return nil, fmt.Errorf("换装说明不完整")
			}
			looks = append(looks, inherit(Look{Name: fmt.Sprintf("造型%d", i+1), Clothing: outfit}, definition))
		}
		return looks, nil
	}
	return []Look{inherit(Look{Name: "默认造型", Clothing: clothing}, definition)}, nil
}

func Definition(base map[string]any, look Look) map[string]any {
	result := make(map[string]any, len(base))
	for k, v := range base {
		if k != "looks" {
			result[k] = v
		}
	}
	for k, v := range map[string]string{"clothing": look.Clothing, "appearance": look.Appearance, "ageStage": look.AgeStage, "hairstyle": look.Hairstyle, "state": look.State} {
		if v != "" {
			result[k] = v
		}
	}
	// Rebuild visual prompts: old prose often hardcodes a different main outfit.
	identity := strings.Join([]string{text(result["appearance"]), text(result["physique"]), text(result["ageStage"]), text(result["hairstyle"]), text(result["state"]), look.Clothing}, "；")
	result["consistencyPrompt"] = "保持同一角色的身份、五官与体态。当前仅呈现造型「" + look.Name + "」：" + identity + "。不得混用其他服装、年龄或形态。"
	if strings.Contains(text(base["role"]), "【拟人化系统角色】") {
		result["multiViewPrompt"] = "同一角色当前造型的完整身体正面、侧面、背面三视图，保留已确认物种与完整形态。" + identity
	} else {
		result["multiViewPrompt"] = "同一张设定图：左侧独立完整头部特写，右侧仅当前造型的正面、右侧面、背面身体三视图；身体区域按颈部自然裁切至脚底，不表现断颈或伤口，三个身体视图服装完全一致。" + identity
	}
	return result
}

func Key(look Look) string {
	// Clothing and state define continuity; labels may change between chapters.
	data, _ := json.Marshal([]string{strings.TrimSpace(look.Clothing), strings.TrimSpace(look.AgeStage), strings.TrimSpace(look.Hairstyle), strings.TrimSpace(look.State)})
	sum := sha256.Sum256(data)
	return "look-" + hex.EncodeToString(sum[:12])
}
