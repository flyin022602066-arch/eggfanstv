package prompts

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed character_reference_templates.json
var characterReferenceTemplatesJSON []byte

type characterReferenceTemplate struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

var characterReferenceTemplates = func() struct {
	Layouts []characterReferenceTemplate `json:"layouts"`
	Designs []characterReferenceTemplate `json:"designs"`
} {
	var catalog struct {
		Layouts []characterReferenceTemplate `json:"layouts"`
		Designs []characterReferenceTemplate `json:"designs"`
	}
	if err := json.Unmarshal(characterReferenceTemplatesJSON, &catalog); err != nil || len(catalog.Layouts) == 0 || len(catalog.Designs) == 0 {
		panic("invalid built-in character reference templates")
	}
	return catalog
}()

func selectedCharacterReferenceTemplate(templates []characterReferenceTemplate, id string) characterReferenceTemplate {
	for _, template := range templates {
		if template.ID == strings.TrimSpace(id) {
			return template
		}
	}
	return templates[0]
}

func characterGenerationLayout(values map[string]string) string {
	return selectedCharacterReferenceTemplate(characterReferenceTemplates.Layouts, values["角色参考图格式"]).Prompt
}

func characterGenerationDesign(values map[string]string) string {
	selected := selectedCharacterReferenceTemplate(characterReferenceTemplates.Designs, values["角色形象模板"])
	return "【所选角色形象模板：" + selected.Name + "】\n" + selected.Prompt + "\n本模板只调整人物图像的表达与设计方法，不改变角色提取范围、已确认身份、物种、时代、服装、造型变化与项目画风；冲突时以这些明确设定为准，不更换图片模型或请求参数。"
}
