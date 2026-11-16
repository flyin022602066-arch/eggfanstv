import { expect, spyOn, test } from "bun:test";
import { CHARACTER_REFERENCE_LAYOUTS, CHARACTER_DESIGN_TEMPLATES, characterReferenceLayout } from "@/lib/character-reference-templates";
import { characterTurnaroundVariables } from "@/lib/character-reference-generation";
import { normalizeProjectAssetImagePresets } from "@/lib/project-asset-image-preferences";
import { projectAssetImageConfig, resolveProjectAssetImagePreset } from "@/pages/projects/detail/project-asset-image";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot } from "@/stores/use-config-store";
import type { Project } from "@/services/api/projects";
import { extractChapterAssets, reviewChapterAssets } from "@/pages/projects/detail/project-chapter-ai";
import * as canvasGeneration from "@/lib/canvas/canvas-project-generation";

test("default layout matches the supplied two portraits and two body panels", () => {
    const layout = characterReferenceLayout();
    expect(layout.id).toBe("portrait-body-grid");
    for (const instruction of ["横版2×2四宫格", "左上为正面", "右上为右侧面", "左下为正面身体", "右下为背面身体", "同一套造型", "脚底", "中性灰色", "细横线", "以本规则为准"]) expect(layout.prompt).toContain(instruction);
    expect(characterReferenceLayout("deleted-template").id).toBe(layout.id);
    expect(CHARACTER_REFERENCE_LAYOUTS).toHaveLength(5);
    expect(CHARACTER_DESIGN_TEMPLATES).toHaveLength(7);
});

test("selected templates survive config persistence and both single and batch generation config", () => {
    const channel = createModelChannel({ id: "template-test", name: "fixture", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: ["gpt-image-2"] });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const preset = { model, size: "16:9", quality: "high", extraPrompt: "", characterLayoutId: "head-three-body", characterDesignTemplateId: "distinct-2d-animation" };
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], projectAssetImagePresets: { character: preset } } }).config;
    const resolved = resolveProjectAssetImagePreset(config, { id: "p" } as Project, "character");
    expect(resolved).toMatchObject(preset);
    const requestConfig = projectAssetImageConfig(config, resolved);
    const variables = characterTurnaroundVariables("角色甲", { clothing: "红袍" }, "左袖挽起", undefined, requestConfig.projectAssetImagePresets?.character);
    expect(variables).toMatchObject({ 角色参考图格式: "head-three-body", 角色形象模板: "distinct-2d-animation" });
    expect(variables.角色设定).toContain("红袍");
    expect(variables.角色设定).toContain("左袖挽起");
    expect(requestConfig).toMatchObject({ model, imageModel: model, size: "16:9", quality: "high", count: "1" });
    expect(resolveProjectAssetImagePreset(defaultConfig, {} as Project, "character").characterLayoutId).toBe("portrait-body-grid");
    expect(normalizeProjectAssetImagePresets({ prop: preset }).prop).not.toHaveProperty("characterLayoutId");
});

test("chapter extraction and its coverage review receive the saved character templates", async () => {
    const empty = { characters: [], scenes: [], props: [] };
    const run = spyOn(canvasGeneration, "runBackendCanvasGenerationTask").mockImplementation(async (request) => {
        request.onTaskCreated?.({ id: "offline-template-extraction", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" });
        return { text: JSON.stringify(empty) };
    });
    try {
        const config = { ...defaultConfig, model: "offline", projectAssetImagePresets: { character: { model: "offline-image", size: "16:9", quality: "high", extraPrompt: "", characterLayoutId: "source-design-sheet", characterDesignTemplateId: "distinct-overseas-realistic" } } };
        const input = { projectId: "offline", projectName: "示例", chapterId: "chapter", chapterTitle: "第一集", sourceText: "Emma推门进入办公室。", projectStyle: "海外写实", config };
        await extractChapterAssets(input, { batchId: "offline-batch" });
        await reviewChapterAssets(input, empty, { batchId: "offline-batch" });
        expect(run).toHaveBeenCalledTimes(2);
        for (const [request] of run.mock.calls) expect(request.metadata?.promptTemplateVariables).toMatchObject({ 角色参考图格式: "source-design-sheet", 角色形象模板: "distinct-overseas-realistic", 章节正文: input.sourceText });
        expect((run.mock.calls[1]![0].metadata?.promptTemplateVariables as Record<string, string>).资产复核清单).toBe(JSON.stringify(empty));
    } finally { run.mockRestore(); }
});
