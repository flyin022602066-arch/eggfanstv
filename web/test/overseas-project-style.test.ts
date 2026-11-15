import { expect, spyOn, test } from "bun:test";
import { compileCanvasStylePreset, defaultProjectStyleSelection, parseCanvasStyleSelection, projectStyleCastingOptions, projectStyleSelectionFromSnapshot, recommendedCanvasStylePresets } from "../src/lib/canvas/canvas-style-system";
import { parseStyleProfile, serializeStyleProfile } from "../src/lib/canvas/style-profile";
import { characterTurnaroundVariables } from "../src/lib/character-reference-generation";
import { extractChapterAssets } from "../src/pages/projects/detail/project-chapter-ai";
import * as canvasGeneration from "../src/lib/canvas/canvas-project-generation";
import { useConfigStore } from "../src/stores/use-config-store";

test("overseas casting remains independent of rendering medium and survives saved snapshots", () => {
    for (const casting of projectStyleCastingOptions) {
        for (const medium of ["live-action", "3d-realistic", "2d-anime"] as const) {
            const selection = { ...defaultProjectStyleSelection, world: "western-urban" as const, medium, character: medium === "2d-anime" ? "anime" as const : "realistic" as const, casting: casting.id };
            const preset = compileCanvasStylePreset(selection);
            expect(parseCanvasStyleSelection(preset.id)).toEqual(selection);
            expect(parseStyleProfile(serializeStyleProfile(preset.profile!))?.selection).toEqual(selection);
            expect(projectStyleSelectionFromSnapshot({ ...preset.profile!.selection })).toEqual(selection);
            expect(preset.prompt).toContain(`地域选角：${casting.label}`);
            expect(preset.prompt).not.toContain("角色采用真实东亚骨相");
            expect(preset.prompt).not.toContain("欧美默认脸");
            expect(preset.prompt).not.toContain("角色采用东方动漫造型");
        }
    }
    expect(parseCanvasStyleSelection("v2-urban--romantic--live-action--realistic")).toEqual({ world: "urban", tone: "romantic", medium: "live-action", character: "realistic" });
    expect(parseCanvasStyleSelection("v3-western-urban--romantic--live-action--realistic--invalid")).toBeNull();
    expect(projectStyleSelectionFromSnapshot({ world: "unknown" })).toBeUndefined();
});

test("overseas recommended styles include live action, 3D and 2D without changing stored Chinese presets", () => {
    for (const world of ["western-urban", "western-period", "western-fantasy"]) {
        const presets = recommendedCanvasStylePresets.filter((preset) => preset.selection?.world === world);
        for (const medium of ["live-action", "3d-realistic", "2d-anime"]) expect(presets.some((preset) => preset.selection?.medium === medium)).toBe(true);
    }
    expect(compileCanvasStylePreset({ world: "urban", tone: "romantic", medium: "live-action", character: "realistic" }).id).toBe("v2-urban--romantic--live-action--realistic");
});

test("character image prompts retain regional casting and explicit script or face-reference precedence", () => {
    const preset = compileCanvasStylePreset({ world: "western-urban", tone: "romantic", medium: "3d-realistic", character: "realistic", casting: "western" });
    const variables = characterTurnaroundVariables("Emma", { appearance: "成年女性，棕色短发", clothing: "深蓝色通勤装" }, "", preset);
    expect(variables.项目画风).toContain("【地域选角与文化语境】");
    expect(variables.项目画风).toContain("原文明示");
    expect(variables.项目画风).toContain("人脸参考");
    expect(variables.项目画风).toContain("美术补全");
    expect(variables.项目画风).not.toContain("角色采用真实东亚骨相");
});

test("chapter asset extraction sends overseas casting as project context without changing source facts", async () => {
    const preset = compileCanvasStylePreset({ world: "western-urban", tone: "romantic", medium: "live-action", character: "realistic", casting: "western" });
    const run = spyOn(canvasGeneration, "runBackendCanvasGenerationTask").mockImplementation(async (input) => {
        input.onTaskCreated?.({ id: "offline-overseas", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" });
        return { text: JSON.stringify({ characters: [], scenes: [{ name: "办公室", description: "Emma推门进入", prompt: "办公室内景" }], props: [] }) };
    });
    try {
        await extractChapterAssets({ projectId: "fixture", projectName: "海外剧", chapterId: "episode", chapterTitle: "第一集", sourceText: "Emma推门进入办公室。", projectStyle: preset.prompt, config: { ...useConfigStore.getInitialState().config, model: "offline" } });
        const variables = run.mock.calls[0]![0].metadata?.promptTemplateVariables as Record<string, string>;
        expect(variables.项目画风).toContain("【地域选角与文化语境】");
        expect(variables.项目画风).toContain("欧美");
        expect(variables.章节正文).toBe("Emma推门进入办公室。");
    } finally {
        run.mockRestore();
    }
});
