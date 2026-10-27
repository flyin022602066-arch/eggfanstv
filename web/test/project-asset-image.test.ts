import { expect, test } from "bun:test";
import { projectAssetImageModel, projectAssetImagePrompt, canGenerateProjectAssetImage, resolveProjectAssetImagePreset, projectAssetImageConfig, planProjectAssetImageBatch, activeProjectAssetImageIds } from "../src/pages/projects/detail/project-asset-image";
import { createModelChannel, defaultConfig, encodeChannelModel, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import type { ProjectAsset, Project } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";
import { normalizeProjectAssetImagePresets } from "../src/lib/project-asset-image-preferences";
import { submitProjectAssetImageBatch } from "../src/pages/projects/detail/project-asset-image-generation";

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
