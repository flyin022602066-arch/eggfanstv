import { expect, test } from "bun:test";
import { projectAssetImageModel, projectAssetImagePrompt, canGenerateProjectAssetImage, resolveProjectAssetImagePreset, projectAssetImageConfig, planProjectAssetImageBatch, activeProjectAssetImageIds, resolveProjectAssetImagePrompt } from "../src/pages/projects/detail/project-asset-image";
import { characterTurnaroundVariables } from "../src/pages/projects/detail/project-character-media";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import type { ProjectAsset, Project } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";
import { normalizeProjectAssetImagePresets } from "../src/lib/project-asset-image-preferences";
import { submitProjectAssetImageBatch, submitProjectAssetImages } from "../src/pages/projects/detail/project-asset-image-generation";
import type { CharacterReferenceVersion } from "../src/services/api/project-character-references";

test("asset image generation respects project image model and skips text defaults", () => {
    const channel = createModelChannel({ id: "images", name: "fixture", baseUrl: "https://example.invalid", interfaceType: "openai-image", models: ["gpt-image-2", "gpt-image-1"] });
    const first = encodeChannelModel(channel.id, "gpt-image-2");
    const second = encodeChannelModel(channel.id, "gpt-image-1");
    const config = { ...defaultConfig, channels: [channel], imageModel: first };
    expect(projectAssetImageModel(config, second)).toBe(second);
    expect(projectAssetImageModel(config, "missing-text-model")).toBe(first);
});

test("category presets survive config round-trip and keep independent models", () => {
    const channel = createModelChannel({ id: "images", name: "fixture", baseUrl: "https://example.invalid", apiKey: "private-test-key", interfaceType: "openai-image", models: ["gpt-image-2", "gpt-image-1"] });
    const characterModel = encodeChannelModel(channel.id, "gpt-image-2");
    const sceneModel = encodeChannelModel(channel.id, "gpt-image-1");
    const presets = { character: { model: characterModel, size: "3:2", quality: "high", extraPrompt: "统一服装材质" }, environment: { model: sceneModel, size: "1536x1024", quality: "medium", extraPrompt: "远景，无人物" } };
    const snapshot = JSON.parse(JSON.stringify({ config: { ...defaultConfig, channels: [channel], imageModel: characterModel, projectAssetImagePresets: presets } }));
    const config = normalizeConfigSnapshot(snapshot).config;
    const project = { id: "project", aspectRatio: "16:9", defaultImageModel: characterModel } as Project;
    expect(config.projectAssetImagePresets).toEqual(presets);
    expect(resolveProjectAssetImagePreset(config, project, "character").model).toBe(characterModel);
    expect(resolveProjectAssetImagePreset(config, project, "environment").model).toBe(sceneModel);
    expect(resolveProjectAssetImagePreset(config, project, "prop").model).toBe(characterModel);
    const scene = resolveProjectAssetImagePreset(config, project, "environment");
    expect(projectAssetImageConfig(config, scene).model).toBe(sceneModel);
    expect(projectAssetImageConfig(config, scene).taskWorkflowProvider).toBe("model");
    expect(scene.extraPrompt).toBe("远景，无人物");
    expect(JSON.stringify(config.projectAssetImagePresets)).not.toContain("private-test-key");
});

test("unavailable saved model blocks generation instead of borrowing another category model", () => {
    const config = { ...defaultConfig, projectAssetImagePresets: { environment: { model: "deleted-channel::image", size: "16:9", quality: "high", extraPrompt: "" } } };
    const preset = resolveProjectAssetImagePreset(config, { id: "project" } as Project, "environment");
    expect(preset.model).toBe("deleted-channel::image");
    expect(() => projectAssetImageConfig(config, preset)).toThrow("已保存的图片模型不可用");
    expect(normalizeProjectAssetImagePresets({ character: { model: null, size: 12, extraPrompt: null, apiKey: "discard" }, prop: [] })).toEqual({ character: { model: "", size: "", quality: "", extraPrompt: "" } });
});

test("batch plans all assets across folders, skips active/image assets, and deduplicates", () => {
    const base = { id: "scene", title: "场景", category: "environment", mediaType: "text", primaryVersionId: "v1", folderId: "nested" } as ProjectAsset;
    const assets = Array.from({ length: 85 }, (_, index) => ({ ...base, id: `scene-${index}` }));
    assets.push({ ...base, id: "ready", mediaType: "image", storageKey: "resource:ready" }, { ...base, id: "invalid", primaryVersionId: undefined }, assets[0]);
    const plan = planProjectAssetImageBatch(assets, "environment", new Set(["scene-0"]), true);
    expect(plan.assets).toHaveLength(84);
    expect(plan.assets.some((asset) => asset.id === "scene-84")).toBe(true);
    expect(plan.activeCount).toBe(1);
    expect(plan.existingCount).toBe(1);
    expect(planProjectAssetImageBatch(assets, "environment", new Set(["scene-0"]), false).assets).toHaveLength(85);
    expect(planProjectAssetImageBatch(assets, "prop", new Set(), true).assets).toHaveLength(0);
});

test("character batch distinguishes missing pictures from a bound character image", () => {
    const character = { id: "character", title: "角色", category: "character", character: { versionId: "cv1", representations: [] } } as unknown as ProjectAsset;
    const ready = { ...character, id: "ready", character: { ...character.character!, representations: [{ id: "rep", resourceId: "picture", mediaType: "image", role: "turnaround_sheet" }] } };
    expect(planProjectAssetImageBatch([character, ready], "character", new Set(), true).assets.map((asset) => asset.id)).toEqual(["character"]);
    const tasks = [{ status: "running", clientContext: { nodeId: "character-turnaround:character" } }, { status: "queued", clientContext: { nodeId: "project-asset-image:scene" } }, { status: "failed", clientContext: { nodeId: "project-asset-image:failed" } }] as GenerationTask[];
    expect([...activeProjectAssetImageIds(tasks)]).toEqual(["character", "scene"]);
});

test("character batch submits every distinct look instead of collapsing by character ID", () => {
    const base = { id: "hero", title: "韩枫", category: "character", character: { versionId: "daily", representations: [] } } as unknown as ProjectAsset;
    const injured = { ...base, primaryVersionId: "injured", character: { ...base.character!, versionId: "injured" } };
    expect(planProjectAssetImageBatch([base, injured, base], "character", new Set(), true).assets.map((asset) => asset.character!.versionId)).toEqual(["daily", "injured"]);
});

test("batch records partial submission failures, continues, and submits each asset once", async () => {
    const assets = ["a", "b", "c"].map((id) => ({ id, title: id }) as ProjectAsset);
    const called: string[] = [], progress: number[] = [];
    let concurrent = 0;
    const result = await submitProjectAssetImageBatch(assets, async (asset) => {
        expect(concurrent++).toBe(0);
        called.push(asset.id);
        await Promise.resolve();
        concurrent--;
        if (asset.id === "b") throw new Error("渠道未配置");
    }, (count) => progress.push(count));
    expect(called).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([1, 2, 3]);
    expect(result.submittedIds).toEqual(["a", "c"]);
    expect(result.failures.map((failure) => [failure.asset.id, failure.message])).toEqual([["b", "渠道未配置"]]);
});

test("scene and prop image prompts retain full extracted definition", () => {
    const asset = { id: "scene", title: "古城", category: "environment", mediaType: "text", primaryVersionId: "v1", previewText: "truncated", definitionJson: JSON.stringify({ description: "石桥", details: "城墙" }) } as ProjectAsset;
    expect(canGenerateProjectAssetImage(asset)).toBe(true);
    expect(projectAssetImagePrompt(asset)).toContain("城墙");
    expect(projectAssetImagePrompt(asset)).toContain("不添加人物");
    expect(projectAssetImagePrompt({ ...asset, category: "prop" })).toContain("道具设定图");
    expect(canGenerateProjectAssetImage({ ...asset, mediaType: "video" })).toBe(false);
});

test("batch waits for the base, skips only its variants after failure, and counts each target once", async () => {
    const versions = ["daily", "injured", "winter"].map((lookId, index) => ({ assetId: "hero", versionId: lookId, version: index + 1, definition: { clothing: lookId }, representations: [], referenceProfile: { lookId, name: lookId } }) as CharacterReferenceVersion);
    const assets = [...versions.map((character) => ({ id: "hero", title: "韩枫", category: "character", character }) as ProjectAsset), { id: "other", title: "其他角色" } as ProjectAsset];
    const calls: string[] = [], progress: number[] = [];
    const result = await submitProjectAssetImageBatch(assets, async (asset) => {
        calls.push(asset.character?.versionId || asset.id);
        return { id: "base-task", status: "queued" } as GenerationTask;
    }, (count) => progress.push(count), { versions, wait: async () => { calls.push("wait-base"); return { id: "base-task", status: "failed" } as GenerationTask; } });
    expect(calls).toEqual(["daily", "wait-base", "other"]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(result.submittedIds).toEqual(["hero", "other"]);
    expect(result.failures.map((failure) => failure.asset.character?.versionId)).toEqual(["injured", "winter"]);
});

test("main character generation submits each look's own prompt and shared supplement", async () => {
    const versions = ["白色常服", "染血伤态"].map((clothing, index) => ({ assetId: "hero", versionId: `v${index + 1}`, version: index + 1, definition: { clothing }, representations: index ? [] : [{ role: "primary", mediaType: "image", resourceId: "base-image" }], referenceProfile: { lookId: `look${index}`, name: clothing } }) as CharacterReferenceVersion);
    const asset = { id: "hero", title: "韩枫", category: "character", character: versions[0] } as ProjectAsset;
    const prompts: string[] = [];
    const clothing: unknown[] = [];
    const result = await submitProjectAssetImages({ id: "p" } as Project, { asset, config: {} as never, prompt: "旧的基础版本提示词", characterVersions: versions, characterPromptSupplement: "电影布光" }, {
        loadCatalog: async () => ({ revision: 1, versions }),
        submit: async (_project, input) => { prompts.push(input.prompt); clothing.push(input.asset.character!.definition.clothing); return { id: "task", status: "queued" } as GenerationTask; },
    });
    expect(result).toEqual({ submitted: 2, errors: [] });
    expect(clothing).toEqual(["白色常服", "染血伤态"]);
    expect(prompts.every((prompt) => prompt.includes("电影布光") && !prompt.includes("旧的基础版本提示词"))).toBe(true);
});

test("system panel templates do not burn chapter state into the reusable image", () => {
    const asset = { id: "panel", title: "进化系统面板", category: "prop", mediaType: "image", primaryVersionId: "v1", definitionJson: JSON.stringify({ description: "【宿主：苏夜】\n【灵气：5632】", prompt: "原文面板，灵气5632" }) } as ProjectAsset;
    const prompt = projectAssetImagePrompt(asset);
    expect(prompt).toContain("数值区域留空");
    expect(prompt).not.toContain("5632");
    expect(prompt).not.toContain("苏夜");
    expect(prompt).toContain("灵气");
});

test("asset image submission uses the edited prompt instead of the generated default", () => {
    const edited = resolveProjectAssetImagePrompt("原始资产提示词", "用户改写后的提示词", "统一画风补充");
    expect(edited).toBe("用户改写后的提示词\n\n统一画风补充");
    expect(edited).not.toContain("原始资产提示词");
    expect(resolveProjectAssetImagePrompt("原始资产提示词", "", "补充要求")).toBe("原始资产提示词\n\n补充要求");
});

test("character turnaround prompt override does not re-append the old multi-view prompt", () => {
    const variables = characterTurnaroundVariables("角色", { role: "主角", multiViewPrompt: "旧的三视图提示词" }, "新的三视图提示词");
    expect(variables.角色设定).toContain("新的三视图提示词");
    expect(variables.角色设定).not.toContain("旧的三视图提示词");
});
