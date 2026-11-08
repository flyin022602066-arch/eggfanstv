import { describe, expect, test } from "bun:test";
import { parseCharacterBreakdown } from "../src/lib/canvas/canvas-character-reference";
import {
    normalizeProjectSystemPresentations,
    normalizeSystemPresentationSettings,
    systemCharacterDefinition,
    systemPresentationRule,
    type SystemPresentationSettings,
} from "../src/lib/chapter-system-presentation";

const defaults: SystemPresentationSettings = {
    mode: "panel",
    characterName: "系统精灵",
    characterAppearance: "小巧的悬浮精灵",
    characterVoice: "清晰自然的中文普通话",
};
const characterSettings: SystemPresentationSettings = {
    mode: "character",
    characterName: "小白",
    characterAppearance: "银白色的小狐狸，圆耳、短腿和一条蓬松尾巴",
    characterVoice: "轻柔明亮的中文普通话，语速平稳",
};

describe("系统呈现设置", () => {
    test("无效输入回落为稳定的面板默认设置", () => {
        for (const value of [undefined, null, false, 42, "character", [], {}]) {
            expect(normalizeSystemPresentationSettings(value)).toEqual(defaults);
        }
    });

    test("逐字段校验并去除首尾空白，不将任意值转换成角色设定", () => {
        expect(normalizeSystemPresentationSettings({ mode: "character", characterName: " 小白 ", characterAppearance: " 白色狐狸 ", characterVoice: " 轻柔声线 " })).toEqual({
            mode: "character", characterName: "小白", characterAppearance: "白色狐狸", characterVoice: "轻柔声线",
        });
        expect(normalizeSystemPresentationSettings({ mode: "sprite", characterName: "  ", characterAppearance: 123, characterVoice: {} })).toEqual(defaults);
        expect(normalizeSystemPresentationSettings({ mode: "panel", characterName: "小白" })).toEqual({ ...defaults, characterName: "小白" });
    });

    test("归一化不修改输入且默认结果彼此独立", () => {
        const input = Object.freeze({ ...characterSettings, characterName: " 小白 " });
        expect(normalizeSystemPresentationSettings(input)).toEqual(characterSettings);
        expect(input.characterName).toBe(" 小白 ");
        const first = normalizeSystemPresentationSettings(null);
        first.characterName = "其他名称";
        expect(normalizeSystemPresentationSettings(null)).toEqual(defaults);
    });

    test("项目映射仅接受有效对象条目，逐项目填充默认字段", () => {
        for (const value of [undefined, null, [], "project", 12]) expect(normalizeProjectSystemPresentations(value)).toEqual({});
        expect(normalizeProjectSystemPresentations({
            "": characterSettings,
            "  ": characterSettings,
            "project-a": { mode: "character", characterName: " 小白 " },
            "project-b": {},
            "project-c": null,
            "project-d": [],
            "project-e": "character",
        })).toEqual({
            "project-a": { ...defaults, mode: "character", characterName: "小白" },
            "project-b": defaults,
        });
    });
});

describe("系统呈现规则与角色定义", () => {
    test("面板模式约束动态模板，逐镜使用原文状态而非参考图旧数值", () => {
        const rule = systemPresentationRule(defaults);
        for (const text of ["面板", "外框", "布局", "逐镜", "原文", "数值", "留空", "不从其他章节", "不把系统拟人化"]) expect(rule).toContain(text);
        expect(rule).not.toContain(characterSettings.characterAppearance);
    });

    test("角色模式固定同名动物或精灵及声线，仅改编原有信息，不强制面板", () => {
        const rule = systemPresentationRule(characterSettings);
        for (const text of [characterSettings.characterName, characterSettings.characterAppearance, characterSettings.characterVoice, "动物", "精灵", "原文", "不得编造", "不强制", "面板", "跨章节", "参考图"]) expect(rule).toContain(text);
        expect(rule).not.toContain("不把系统拟人化");
    });

    test("生成的角色定义满足角色解析合同并保留配置的外形和声线", () => {
        const definition = systemCharacterDefinition(characterSettings);
        expect(definition.name).toBe(characterSettings.characterName);
        expect(definition.aliases).toContain("系统");
        expect(definition.appearance).toBe(characterSettings.characterAppearance);
        expect(definition.voiceTimbre).toBe(characterSettings.characterVoice);
        expect(definition.role).toContain("【拟人化系统角色】");
        for (const key of ["role", "physique", "clothing", "personality", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge"] as const) expect(definition[key].trim()).not.toBe("");
        expect(parseCharacterBreakdown(JSON.stringify({ characters: [definition] }))).toEqual([definition]);
    });

    test("三视图适用于完整动物或精灵，保留头部且不强套人类模特设定", () => {
        const definition = systemCharacterDefinition(characterSettings);
        for (const text of ["全身", "正面", "侧面", "背面", "头部", "动物", "精灵", characterSettings.characterAppearance]) expect(definition.multiViewPrompt).toContain(text);
        for (const text of [characterSettings.characterName, characterSettings.characterAppearance, "跨章节", "等级", "进度", "参考图"]) expect(definition.consistencyPrompt).toContain(text);
        expect(definition.multiViewPrompt).not.toMatch(/无头|去头|不含头|颈部以下|人类模特|人形站姿/u);
        expect(definition.physique).toContain(characterSettings.characterAppearance);
        expect(definition.multiViewPrompt).toContain("项目画风");
    });

    test("系统名本身作为配置名称时不产生重复自身别名", () => {
        const definition = systemCharacterDefinition({ ...characterSettings, characterName: "系统" });
        expect(definition.aliases).not.toContain("系统");
        expect(parseCharacterBreakdown(JSON.stringify({ characters: [definition] }))).toEqual([definition]);
    });
});
