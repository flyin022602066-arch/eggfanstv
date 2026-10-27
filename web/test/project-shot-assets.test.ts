import { expect, test } from "bun:test";

import { prepareProjectShotAssets, prepareProjectUnitShotAssets } from "../src/services/project-shot-assets";
import type { ProjectAsset, ProjectUnitWorkspace, ShotAssetReference } from "../src/services/api/projects";

function fixture() {
    const asset = { id: "character", title: "嬴政", category: "character", primaryVersionId: "character-v2" } as ProjectAsset;
    const workspace = { shots: [{ id: "shot-1" }], shotReferences: [], assets: [] } as unknown as ProjectUnitWorkspace;
    const calls: string[] = [];
    const api = {
        getProjectUnitWorkspace: async () => workspace,
        listProjectAssets: async () => { calls.push("list-assets"); return { assets: [asset] }; },
        linkShotAsset: async (_projectId: string, shotId: string, input: { assetVersionId: string; role: string }) => {
            calls.push(`bind:${input.assetVersionId}`);
            const reference = { id: `reference-${workspace.shotReferences.length + 1}`, shotId, ...input, status: "linked", createdAt: "" } as ShotAssetReference;
            workspace.shotReferences.push(reference);
            workspace.assets.push(asset);
            return { reference };
        },
        unlinkShotAsset: async (_projectId: string, _shotId: string, referenceId: string) => {
            calls.push(`unbind:${referenceId}`);
            workspace.shotReferences = workspace.shotReferences.filter((reference) => reference.id !== referenceId);
            return { unlinked: true };
        },
    };
    return { api, workspace, calls };
}

test("generation repairs an unbound historical shot using the full project asset catalog", async () => {
    const { api, calls } = fixture();
    const result = await prepareProjectShotAssets({ projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", script: { plotDescription: "嬴政躺在龙榻上" } }, api);
    expect(result.workspace.shotReferences.map((reference) => reference.assetVersionId)).toEqual(["character-v2"]);
    expect(result.boundCount).toBe(1);
    expect(calls).toEqual(["list-assets", "bind:character-v2"]);
});

for (const count of [10, 30]) {
    test(`shot preparation preserves ${count} matched assets beyond the legacy six-asset cap`, async () => {
        const { api, workspace, calls } = fixture();
        const assets = Array.from({ length: count }, (_, index) => ({ id: `asset-${index}`, title: `资产${index}`, category: index === 0 ? "environment" : "prop", primaryVersionId: `version-${index}` })) as ProjectAsset[];
        api.listProjectAssets = async () => ({ assets });
        const input = { projectId: "p", unitId: "u", shotId: "shot-1", script: { assetBindings: assets.map((asset) => ({ nodeId: asset.id })) } };
        const result = await prepareProjectShotAssets(input, api);
        expect(result.boundCount).toBe(count);
        expect(workspace.shotReferences.map((reference) => reference.assetVersionId)).toEqual(assets.map((asset) => asset.primaryVersionId!));
        expect((await prepareProjectShotAssets(input, api)).boundCount).toBe(0);
        expect(calls.filter((call) => call.startsWith("bind:"))).toHaveLength(count);
    });
}

test("existing explicit references retain their pinned version without auto-binding unrelated assets", async () => {
    const { api, workspace, calls } = fixture();
    workspace.shotReferences = [{ shotId: "shot-1", assetVersionId: "character-v1", role: "reference", status: "linked", referencedVersion: { assetId: "character" } } as ShotAssetReference];
    const result = await prepareProjectShotAssets({ projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", script: { plotDescription: "嬴政" } }, api);
    expect(result.workspace.shotReferences[0]?.assetVersionId).toBe("character-v1");
    expect(calls).toEqual(["list-assets"]);
});

test("an existing character does not prevent missing scene and visible prop bindings", async () => {
    const { api, workspace, calls } = fixture();
    const character = { id: "character", title: "嬴政", category: "character", primaryVersionId: "character-v2" } as ProjectAsset;
    const scene = { id: "scene", title: "正殿", category: "environment", primaryVersionId: "scene-v1" } as ProjectAsset;
    const prop = { id: "sword", title: "短剑", category: "prop", primaryVersionId: "sword-v1" } as ProjectAsset;
    api.listProjectAssets = async () => ({ assets: [character, scene, prop] });
    workspace.shotReferences = [{ id: "old-pin", shotId: "shot-1", assetVersionId: "character-v1", asset: character, role: "reference", status: "linked" } as ShotAssetReference];
    const result = await prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政在正殿握着短剑" } }, api);
    expect(result.boundCount).toBe(2);
    expect(calls).toEqual(["bind:scene-v1", "bind:sword-v1"]);
    expect(workspace.shotReferences[0]!.assetVersionId).toBe("character-v1");
});

test("chapter repair inherits scenes from preceding shots and is idempotent", async () => {
    const { api, workspace, calls } = fixture();
    const scene = { id: "scene", title: "正殿", category: "environment", primaryVersionId: "scene-v1" } as ProjectAsset;
    api.listProjectAssets = async () => ({ assets: [scene] });
    workspace.shots = [
        { id: "shot-1", unitId: "u", position: 0, description: "正殿全景" },
        { id: "shot-2", unitId: "u", position: 1, description: "殿内，人物抬头" },
    ] as ProjectUnitWorkspace["shots"];
    workspace.shotRevisions = [];
    const result = await prepareProjectUnitShotAssets({ projectId: "p", unitId: "u" }, api);
    expect(result.boundCount).toBe(2);
    expect(result.unresolvedSceneShotIds).toEqual([]);
    expect(workspace.shotReferences.map((reference) => reference.shotId)).toEqual(["shot-1", "shot-2"]);
    await prepareProjectUnitShotAssets({ projectId: "p", unitId: "u" }, api);
    expect(calls.filter((call) => call.startsWith("bind:"))).toHaveLength(2);
});

test("chapter repair binds a manually added prop mentioned on screen despite an outdated prop list", async () => {
    const { api, workspace, calls } = fixture();
    const prop = { id: "manual-prop", title: "残缺古籍", category: "prop", primaryVersionId: "prop-image-v2", mediaType: "image", storageKey: "resource:prop-image", definitionJson: JSON.stringify({ aliases: ["旧书"] }) } as ProjectAsset;
    const unrelated = { id: "other-prop", title: "茶杯", category: "prop", primaryVersionId: "cup-v1" } as ProjectAsset;
    api.listProjectAssets = async () => ({ assets: [prop, unrelated] });
    workspace.shots = [
        { id: "shot-1", position: 0, currentRevisionId: "revision-1", description: "人物拿起旧书" },
        { id: "shot-2", position: 1, description: "人物离开屋子" },
    ] as ProjectUnitWorkspace["shots"];
    workspace.shotRevisions = [{ id: "revision-1", shotId: "shot-1", version: 1, videoPrompt: "起幅：手持旧书。落幅：翻开残缺的书页。", dialogue: "找一个茶杯。", actionBeatsJson: JSON.stringify([{ type: "asset_context", propNames: [] }]) }] as ProjectUnitWorkspace["shotRevisions"];
    expect((await prepareProjectUnitShotAssets({ projectId: "p", unitId: "episode-8" }, api)).boundCount).toBe(1);
    expect(workspace.shotReferences.map((reference) => [reference.shotId, reference.assetVersionId])).toEqual([["shot-1", "prop-image-v2"]]);
    expect((await prepareProjectUnitShotAssets({ projectId: "p", unitId: "episode-8" }, api)).boundCount).toBe(0);
    expect(calls.filter((call) => call.startsWith("bind:"))).toEqual(["bind:prop-image-v2"]);
});

test("chapter repair matches a uniquely named scene when the shot adds a character prefix and room suffix", async () => {
    const { api, workspace, calls } = fixture();
    const scene = { id: "scene", title: "庄内议事处", category: "environment", primaryVersionId: "scene-v1" } as ProjectAsset;
    api.listProjectAssets = async () => ({ assets: [scene] });
    workspace.shots = [{ id: "shot-1", unitId: "u", position: 0, currentRevisionId: "revision-1", description: "四兄弟在庄内议事" }] as ProjectUnitWorkspace["shots"];
    workspace.shotRevisions = [{ id: "revision-1", shotId: "shot-1", version: 1, actionBeatsJson: JSON.stringify([{ type: "asset_context", sceneName: "张飞庄内议事厅", sceneChange: true }]) }] as ProjectUnitWorkspace["shotRevisions"];

    const result = await prepareProjectUnitShotAssets({ projectId: "p", unitId: "u" }, api);

    expect(result.boundCount).toBe(1);
    expect(result.unresolvedSceneShotIds).toEqual([]);
    expect(calls).toContain("bind:scene-v1");
});

test("chapter repair refuses to guess when multiple scenes share the same scene-name suffix", async () => {
    const { api, workspace, calls } = fixture();
    api.listProjectAssets = async () => ({ assets: [
        { id: "scene-1", title: "庄内议事处", category: "environment", primaryVersionId: "scene-v1" },
        { id: "scene-2", title: "庄内议事厅", category: "environment", primaryVersionId: "scene-v2" },
    ] as ProjectAsset[] });
    workspace.shots = [{ id: "shot-1", unitId: "u", position: 0, currentRevisionId: "revision-1", description: "四兄弟在庄内议事" }] as ProjectUnitWorkspace["shots"];
    workspace.shotRevisions = [{ id: "revision-1", shotId: "shot-1", version: 1, actionBeatsJson: JSON.stringify([{ type: "asset_context", sceneName: "张飞庄内议事厅", sceneChange: true }]) }] as ProjectUnitWorkspace["shotRevisions"];

    await expect(prepareProjectUnitShotAssets({ projectId: "p", unitId: "u" }, api)).rejects.toThrow("存在重名");
    expect(calls.filter((call) => call.startsWith("bind:"))).toEqual([]);
});

test("binding errors stop preparation instead of proceeding with a text-only task", async () => {
    const { api } = fixture();
    api.linkShotAsset = async () => { throw new Error("保存失败"); };
    await expect(prepareProjectShotAssets({ projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", script: { plotDescription: "嬴政" } }, api)).rejects.toThrow("嬴政");
});

test("a missing shot cannot bind assets from another chapter", async () => {
    const { api, calls } = fixture();
    await expect(prepareProjectShotAssets({ projectId: "project-1", unitId: "chapter-1", shotId: "other-shot", script: { plotDescription: "嬴政" } }, api)).rejects.toThrow("镜头");
    expect(calls).toEqual([]);
});

test("partial binding is rolled back so a retry can bind every matched asset", async () => {
    const { api, workspace, calls } = fixture();
    api.listProjectAssets = async () => ({ assets: [
        { id: "character", title: "嬴政", category: "character", primaryVersionId: "character-v2" },
        { id: "scene", title: "正殿", category: "environment", primaryVersionId: "scene-v1" },
    ] as ProjectAsset[] });
    const link = api.linkShotAsset;
    let fail = true;
    api.linkShotAsset = async (...args) => {
        if (fail && args[2].assetVersionId === "scene-v1") throw new Error("写入失败");
        return link(...args);
    };
    const input = { projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", script: { plotDescription: "嬴政在正殿" } };
    await expect(prepareProjectShotAssets(input, api)).rejects.toThrow("正殿");
    expect(workspace.shotReferences).toEqual([]);
    expect(calls).toContain("unbind:reference-1");
    fail = false;
    expect((await prepareProjectShotAssets(input, api)).workspace.shotReferences.map((reference) => reference.assetVersionId)).toEqual(["character-v2", "scene-v1"]);
});

test("an incomplete readback cannot silently continue generation", async () => {
    const { api } = fixture();
    api.linkShotAsset = async (_projectId, shotId, input) => ({ reference: { id: "not-persisted", shotId, ...input, status: "linked" } as ShotAssetReference });
    await expect(prepareProjectShotAssets({ projectId: "project-1", unitId: "chapter-1", shotId: "shot-1", script: { plotDescription: "嬴政" } }, api)).rejects.toThrow("完整保存");
});

test("chapter repair leaves running shots untouched", async () => {
    const { api, workspace, calls } = fixture();
    workspace.tasks = [{ status: "running", clientContext: { shotId: "shot-1" } }] as ProjectUnitWorkspace["tasks"];
    const result = await prepareProjectUnitShotAssets({ projectId: "p", unitId: "u" }, api);
    expect(result.skippedShotIds).toEqual(["shot-1"]);
    expect(calls.filter((call) => call.startsWith("bind:"))).toEqual([]);
    await expect(prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政" } }, api)).rejects.toThrow("正在生成");
});

test("a failed video can reuse its complete bindings while a storyboard task runs", async () => {
    const { api, workspace, calls } = fixture();
    workspace.shotReferences = [{ shotId: "shot-1", assetVersionId: "character-v1", role: "reference", status: "linked", referencedVersion: { assetId: "character" } } as ShotAssetReference];
    workspace.tasks = [
        { id: "image-task", status: "running", clientContext: { shotId: "shot-1", artifactType: "storyboard" } },
        { id: "video-task", status: "failed", clientContext: { shotId: "shot-1", artifactType: "video" } },
    ] as ProjectUnitWorkspace["tasks"];
    const result = await prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政" }, generationArtifactType: "video" }, api);
    expect(result.boundCount).toBe(0);
    expect(result.workspace.shotReferences[0]!.assetVersionId).toBe("character-v1");
    expect(calls).toEqual(["list-assets"]);
});

test("same-stage active generation blocks duplicates even when bindings need no changes", async () => {
    const { api, workspace, calls } = fixture();
    workspace.shotReferences = [{ shotId: "shot-1", assetVersionId: "character-v1", role: "reference", status: "linked", referencedVersion: { assetId: "character" } } as ShotAssetReference];
    workspace.tasks = [{ status: "queued", clientContext: { shotId: "shot-1", artifactType: "video" } }] as ProjectUnitWorkspace["tasks"];
    await expect(prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政" }, generationArtifactType: "video" }, api)).rejects.toThrow("镜头视频任务正在生成");
    expect(calls).toEqual([]);
});

test("other-stage active tasks still protect asset changes and identify the blocking stage", async () => {
    const { api, workspace, calls } = fixture();
    workspace.tasks = [{ status: "running", clientContext: { shotId: "shot-1", artifactType: "storyboard" } }] as ProjectUnitWorkspace["tasks"];
    await expect(prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政" }, generationArtifactType: "video" }, api)).rejects.toThrow("分镜图任务正在生成");
    expect(calls.filter((call) => call.startsWith("bind:"))).toEqual([]);
});

test("failed and cancelled tasks release binding preparation for a video retry", async () => {
    const { api, workspace } = fixture();
    workspace.tasks = [
        { status: "failed", clientContext: { shotId: "shot-1", artifactType: "video" } },
        { status: "cancelled", clientContext: { shotId: "shot-1", artifactType: "storyboard" } },
    ] as ProjectUnitWorkspace["tasks"];
    const result = await prepareProjectShotAssets({ projectId: "p", unitId: "u", shotId: "shot-1", script: { plotDescription: "嬴政" }, generationArtifactType: "video" }, api);
    expect(result.boundCount).toBe(1);
});
