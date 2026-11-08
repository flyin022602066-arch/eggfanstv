package prompts

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestChapterSystemInterfacePropRuleOverridesOldExclusion(t *testing.T) {
	context := protectedPromptContext(OperationChapterAssetsExtract, map[string]string{"章节正文": "【宿主：苏夜】\n【等级：D级】"})
	for _, required := range []string{"系统界面道具", "props", "逐镜", "纯声音", "以本规则为准"} {
		if !strings.Contains(context, required) {
			t.Errorf("protected chapter extraction missing %q", required)
		}
	}
	for _, definition := range defaultPromptDefinitions() {
		if definition.Operation == OperationChapterAssetsExtract && strings.Contains(definition.DefaultContent, "不是角色、场景或道具资产") {
			t.Fatal("default prompt still excludes system UI props")
		}
	}
}

func TestChapterSystemPresentationDefaultsToPanel(t *testing.T) {
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract} {
		t.Run(operation, func(t *testing.T) {
			baseline := protectedPromptContext(operation, nil)
			for _, mode := range []string{"", "panel", "unknown", "Character", " character "} {
				t.Run(mode, func(t *testing.T) {
					context := protectedPromptContext(operation, map[string]string{
						"系统表现模式": mode,
						"系统角色名称": "阿灵",
						"系统角色形象": "银白色小狐狸",
						"系统角色声音": "清亮童声",
					})
					if context != baseline {
						t.Fatal("non-character mode must preserve the default panel context and ignore character settings")
					}
				})
			}
			if operation == OperationChapterAssetsExtract && !strings.Contains(baseline, chapterSystemInterfaceAssetRule) {
				t.Error("default chapter extraction lost the protected panel prop rule")
			}
			if operation == OperationCharacterExtract && !strings.Contains(baseline, "不要创建“系统”角色") {
				t.Error("default character extraction must still exclude system announcements")
			}
			if !strings.Contains(baseline, characterExtractionVisualRule) {
				t.Error("default character reference layout changed")
			}
		})
	}
}

func TestChapterSystemCharacterProtectedContext(t *testing.T) {
	values := map[string]string{
		"项目名称":   "进化之旅",
		"章节名称":   "初次绑定",
		"项目画风":   "水墨动画",
		"章节正文":   "苏夜听见提示音。【宿主：苏夜】\n【等级：D级】\n【进化点：10】",
		"系统表现模式": "character",
		"系统角色名称": "阿灵",
		"系统角色形象": "银白色小狐狸，四足，蓝色尾尖\n额前一颗星",
		"系统角色声音": "清亮童声\n普通话，语速平稳",
	}
	settingsSnapshot := `【系统角色设定】
系统表现模式：character
系统角色名称：阿灵
系统角色形象：银白色小狐狸，四足，蓝色尾尖
额前一颗星
系统角色声音：清亮童声
普通话，语速平稳`
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract} {
		t.Run(operation, func(t *testing.T) {
			context := protectedPromptContext(operation, values)
			for _, required := range []string{
				settingsSnapshot, values["章节正文"], values["项目画风"], promptOutputContract(operation),
				"动物、精灵", "反复出场", "characters", "name 必须与系统角色名称完全一致",
				"role 必须包含精确标记【拟人化系统角色】", "不因配置凭空创建正文没有的系统",
				"appearance", "physique", "consistencyPrompt", "voiceLanguage", "voiceAge", "voiceTimbre",
				"不得作为系统面板道具放入 props", "不得新增剧情或编造新的台词",
				"系统消息", "状态", "数值", "出现顺序", "逐镜", "纯声音",
				"旧模板、自定义指令和前端默认内容", "以本模式规则为准",
				"仅系统角色例外", "人类角色仍严格遵守", characterReferenceSheetLayout,
				"完整身体的正面、侧面、背面", "不得强制套用人类的独立头部特写与无头身体三视图",
			} {
				if !strings.Contains(context, required) {
					t.Errorf("character mode protected context missing %q", required)
				}
			}
			for _, forbidden := range []string{chapterSystemInterfaceAssetRule, "不要创建“系统”角色"} {
				if strings.Contains(context, forbidden) {
					t.Errorf("character mode retained the unconditional panel restriction %q", forbidden)
				}
			}
		})
	}
}

func TestChapterSystemCharacterSettingsDoNotInventDefaults(t *testing.T) {
	settingsSnapshot := "【系统角色设定】\n系统表现模式：character\n系统角色名称：\n系统角色形象：\n系统角色声音："
	for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract} {
		context := protectedPromptContext(operation, map[string]string{"系统表现模式": "character"})
		if !strings.Contains(context, settingsSnapshot) || !strings.Contains(context, "未提供的设定写“正文未明确”") {
			t.Errorf("%s must preserve empty settings without inventing a name, appearance or voice", operation)
		}
	}
}

func TestChapterSystemPresentationSurvivesPromptCustomization(t *testing.T) {
	for _, customizationMode := range []string{"default", "saved", promptCustomizationAppend, promptCustomizationRewrite} {
		t.Run(customizationMode, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			if err != nil {
				t.Fatal(err)
			}
			connection, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			connection.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = connection.Close() })
			if err := db.AutoMigrate(&model.PromptTemplate{}, &model.UserPromptCustomization{}); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(db)
			service := New(repo, nil)
			for _, operation := range []string{OperationChapterAssetsExtract, OperationCharacterExtract, OperationCharacterTurnaround} {
				if customizationMode != "default" {
					if err := repo.SavePromptTemplate(&model.PromptTemplate{
						ID: operation, Operation: operation, Name: "旧面板模板", Version: 1, Enabled: true,
						Content: "系统只能提取为面板道具，不得提取系统角色。保留原文事实。" + characterReferenceSheetLayout,
					}); err != nil {
						t.Fatal(err)
					}
				}
				if customizationMode == promptCustomizationAppend || customizationMode == promptCustomizationRewrite {
					if err := repo.SaveUserPromptCustomization(&model.UserPromptCustomization{
						ID: operation, UserID: "test-user", Operation: operation, Mode: customizationMode,
						Content: "系统播报不是角色。保留蓝色尾尖。" + characterReferenceSheetLayout,
					}); err != nil {
						t.Fatal(err)
					}
				}
				for _, presentationMode := range []string{"panel", "character"} {
					t.Run(operation+"/"+presentationMode, func(t *testing.T) {
						values := map[string]string{
							"系统表现模式": presentationMode, "系统角色名称": "阿灵",
							"系统角色形象": "银白色小狐狸，蓝色尾尖", "系统角色声音": "清亮童声",
							"章节正文": "【宿主：苏夜】\n【等级：D级】", "项目画风": "水墨动画",
							"角色名称": "阿灵", "角色设定": "银白色小狐狸，蓝色尾尖",
						}
						if operation == OperationCharacterTurnaround && presentationMode == "character" {
							values["角色设定"] = "【拟人化系统角色】" + values["角色设定"]
						}
						compiled, err := service.CompilePrompt("test-user", operation, values)
						if err != nil {
							t.Fatal(err)
						}
						contextPrefix := "\n\n【任务】\n"
						if operation == OperationCharacterTurnaround {
							contextPrefix = "\n\n【角色名称】\n"
						}
						_, protected, found := strings.Cut(compiled.Content, contextPrefix)
						if !found {
							t.Fatal("compiled prompt lost its protected context")
						}
						if customizationMode == promptCustomizationAppend || customizationMode == promptCustomizationRewrite {
							if !strings.Contains(compiled.Content, "保留蓝色尾尖") {
								t.Error("mode selection discarded unrelated customization")
							}
						}
						if operation == OperationCharacterTurnaround {
							expectedLayout := characterReferenceSheetLayout
							if presentationMode == "character" {
								expectedLayout = systemCharacterReferenceSheetLayout
								if strings.Contains(protected, characterReferenceSheetLayout) {
									t.Error("saved human layout overrode the marked system character exception")
								}
							}
							if !strings.Contains(protected, values["角色设定"]) || !strings.HasSuffix(protected, expectedLayout) {
								t.Error("compiled turnaround lost its character definition or final protected layout")
							}
							return
						}
						if !strings.Contains(protected, promptOutputContract(operation)) || !strings.Contains(protected, values["章节正文"]) {
							t.Error("compiled prompt lost its output contract or original system state")
						}
						if presentationMode == "character" {
							for _, required := range []string{
								"以本模式规则为准", "仅系统角色例外",
								"系统表现模式：character\n系统角色名称：阿灵\n系统角色形象：银白色小狐狸，蓝色尾尖\n系统角色声音：清亮童声",
							} {
								if !strings.Contains(protected, required) {
									t.Errorf("compiled character mode missing %q", required)
								}
							}
							if strings.Contains(protected, chapterSystemInterfaceAssetRule) {
								t.Error("compiled character mode still mandates panel props")
							}
						} else if strings.Contains(protected, "系统角色名称：阿灵") {
							t.Error("panel mode leaked inactive system character settings")
						}
					})
				}
			}
		})
	}
}

func TestChapterSystemCharacterTurnaroundRequiresExactMarker(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		definition string
		character  bool
	}{
		{name: "human", definition: "青色长袍，银色腰带。"},
		{name: "animal-without-marker", definition: "银白色小狐狸，四足，蓝色尾尖。"},
		{name: "similar-marker", definition: "[拟人化系统角色]银白色小狐狸。"},
		{name: "partial-marker", definition: "【拟人化系统】银白色小狐狸。"},
		{name: "animal-system", definition: "【拟人化系统角色】银白色小狐狸，四足，蓝色尾尖。", character: true},
		{name: "sprite-system", definition: "反复出场的精灵。【拟人化系统角色】半透明圆球，发光羽翼。", character: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			for _, mode := range []string{"", "panel", "character"} {
				values := map[string]string{
					"角色名称": "阿灵", "角色设定": testCase.definition, "项目画风": "水墨动画",
					"系统表现模式": mode, "系统角色名称": "阿灵",
				}
				context := protectedPromptContext(OperationCharacterTurnaround, values)
				if !strings.Contains(context, testCase.definition) || !strings.Contains(context, "水墨动画") || !strings.Contains(context, "阿灵") {
					t.Error("turnaround lost the confirmed character identity, appearance or style")
				}
				if testCase.character {
					for _, required := range []string{"完整身体的正面、侧面、背面", "不得强制套用人类的独立头部特写与无头身体三视图", "以本规则为准"} {
						if !strings.Contains(context, required) {
							t.Errorf("marked system character turnaround missing %q", required)
						}
					}
					if strings.Contains(context, characterReferenceSheetLayout) {
						t.Error("marked system character is still forced into the human headless sheet")
					}
				} else {
					expected := "【角色名称】\n阿灵\n\n【项目画风】\n水墨动画\n\n【角色设定】\n" + testCase.definition + "\n\n【人物设定图固定规则】\n" + characterReferenceSheetLayout
					if context != expected {
						t.Error("turnaround without the exact role marker must preserve the original protected context")
					}
				}
			}
		})
	}
}
