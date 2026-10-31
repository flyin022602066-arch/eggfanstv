package skills

import (
	"embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed seed/storyboard-30s/*
var storyboard30Skills embed.FS

func storyboard30SkillDefinitions() ([]builtinSkillDefinition, error) {
	catalogJSON, err := storyboard30Skills.ReadFile("seed/storyboard-30s/catalog.json")
	if err != nil {
		return nil, err
	}
	var catalog []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		File        string `json:"file"`
	}
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		return nil, fmt.Errorf("解析30秒分镜技能目录失败: %w", err)
	}
	contract, err := storyboard30Skills.ReadFile("seed/storyboard-30s/contract.md")
	if err != nil {
		return nil, err
	}
	definitions := make([]builtinSkillDefinition, 0, len(catalog))
	for index, item := range catalog {
		instruction, err := storyboard30Skills.ReadFile("seed/storyboard-30s/" + item.File)
		if err != nil {
			return nil, fmt.Errorf("读取30秒分镜技能 %s 失败: %w", item.ID, err)
		}
		definitions = append(definitions, builtinSkillDefinition{
			SkillID: item.ID, SkillName: item.Name, Description: item.Description,
			Instruction: strings.Join([]string{"# " + item.Name, strings.TrimSpace(string(contract)), strings.TrimSpace(string(instruction))}, "\n\n"),
			Status:      skillStatusEnabled, Source: 3, Tag: "drama", SortWeight: 1090 - index,
			CreateTime: 1793318400000, UpdateTime: 1793318400000,
			OwnerUID: "eggfans-builtin", EffectiveUser: seedEffectiveUser{Name: "Eggfans TV", UID: "eggfans-builtin"},
		})
	}
	return definitions, nil
}
