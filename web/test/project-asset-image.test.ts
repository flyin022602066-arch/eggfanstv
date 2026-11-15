import { expect, test } from "bun:test";
import { projectAssetImageModel, projectAssetImagePrompt, canGenerateProjectAssetImage, resolveProjectAssetImagePreset, projectAssetImageConfig, planProjectAssetImageBatch, activeProjectAssetImageIds, resolveProjectAssetImagePrompt } from "../src/pages/projects/detail/project-asset-image";
import { characterTurnaroundVariables } from "../src/pages/projects/detail/project-character-media";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import type { ProjectAsset, Project } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";
import { normalizeProjectAssetImagePresets } from "../src/lib/project-asset-image-preferences";
import { submitProjectAssetImage, submitProjectAssetImageBatch, submitProjectAssetImages } from "../src/pages/projects/detail/project-asset-image-generation";
import type { submitBackendGenerationTask } from "../src/services/api/generation-task";
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
    const presets = { character: { model: characterModel, size: "3:2", quality: "high", extraPrompt: "统一服装材质", extraPromptScope: "category" as const }, environment: { model: sceneModel, size: "1536x1024", quality: "medium", extraPrompt: "远景，无人物", extraPromptScope: "category" as const } };
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

test("legacy unscoped supplements never apply to other assets or batch generation", () => {
    const project = { id: "project" } as Project;
    for (const category of ["character", "environment", "prop"] as const) {
        const saved = { model: "saved-image-model", size: "16:9", quality: "high", extraPrompt: "右眼上额头处有一条清晰的疤痕" };
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, projectAssetImagePresets: { [category]: saved } } }).config;
        const preset = resolveProjectAssetImagePreset(config, project, category);
        expect(preset.extraPrompt).toBe("");
        expect(preset.model).toBe(saved.model);
        expect(preset.size).toBe(saved.size);
        expect(preset.quality).toBe(saved.quality);
        expect(config.projectAssetImagePresets?.[category]?.extraPrompt).toBe(saved.extraPrompt);
    }
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
    let peak = 0;
    const result = await submitProjectAssetImageBatch(assets, async (asset) => {
        peak = Math.max(peak, ++concurrent);
        called.push(asset.id);
        await Promise.resolve();
        concurrent--;
        if (asset.id === "b") throw new Error("渠道未配置");
    }, (count) => progress.push(count));
    expect(called).toEqual(["a", "b", "c"]);
    expect(peak).toBe(3);
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
    expect(calls).toEqual(["daily", "other", "wait-base"]);
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

test("scene sheets explicitly preserve connected angles and narrative detail without tiny grids", () => {
    const asset = { id: "palace", title: "沙丘平台正殿", category: "environment", definitionJson: JSON.stringify({ description: "龙榻前十步连接殿门，左侧有木案", prompt: "原有秦代木构设计" }) } as ProjectAsset;
    const prompt = projectAssetImagePrompt(asset);
    for (const required of ["主全景", "补充角度", "关键局部", "同一空间", "不强制九宫格", "龙榻前十步连接殿门", "原有秦代木构设计"]) expect(prompt).toContain(required);
});

test("prop sheets prioritize identity and useful structure instead of generic objects or forced grids", () => {
    const asset = { id: "medicine", title: "回元注射剂", category: "prop", definitionJson: JSON.stringify({ description: "淡金色药液，透明管体，可拆封装" }) } as ProjectAsset;
    const prompt = projectAssetImagePrompt(asset);
    for (const required of ["完整主体", "轮廓", "关键结构", "局部", "简单道具", "不凭空", "淡金色药液"]) expect(prompt).toContain(required);
});

test("character design keeps narrative identity and visible signatures in the submitted definition", () => {
    const variables = characterTurnaroundVariables("陈尧", { role: "跨越时空救治嬴政的军医", appearance: "青年，狭长眼，直眉", clothing: "深色实用夹克", personality: "忠诚恳切" }, "保留深灰配色");
    for (const required of ["跨越时空救治嬴政的军医", "狭长眼", "深色实用夹克", "保留深灰配色", "角色视觉辨识设计", "2—3个", "基础版"]) expect(variables.角色设定).toContain(required);
});

test("image task submission preserves design sheets, edited prompts and provider parameters", async () => {
    const channel = createModelChannel({ id: "design-test", name: "fixture", baseUrl: "https://example.invalid", apiKey: "fixture-only", interfaceType: "openai-image", models: ["gpt-image-2"] });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model, size: "1536x1024", quality: "high" };
    const asset = { id: "palace", title: "正殿", category: "environment", mediaType: "text", primaryVersionId: "palace-v1", definitionJson: JSON.stringify({ description: "秦式木构正殿" }) } as ProjectAsset;
    const submissions: Parameters<typeof submitBackendGenerationTask>[0][] = [];
    const dependencies = { submitTask: async (options: Parameters<typeof submitBackendGenerationTask>[0]) => { submissions.push(options); return {} as GenerationTask; } };
    const referenceImage = { id: "source", name: "空间参考", storageKey: "resource:source", dataUrl: "", type: "image/png" };
    await submitProjectAssetImage({ id: "p" } as Project, { asset, config, prompt: projectAssetImagePrompt(asset), referenceImage }, dependencies);
    expect(submissions[0]?.prompt).toContain("主全景");
    expect(submissions[0]?.prompt).toContain("秦式木构正殿");
    expect(submissions[0]?.config).toBe(config);
    expect(submissions[0]?.referenceImages).toEqual([referenceImage]);
    expect(submissions[0]?.metadata).toMatchObject({ assetId: "palace", assetVersionId: "palace-v1" });
    await submitProjectAssetImage({ id: "p" } as Project, { asset, config, prompt: "用户明确只要单张全景，不要拼接" }, dependencies);
    expect(submissions[1]?.prompt).toBe("用户明确只要单张全景，不要拼接");
});
