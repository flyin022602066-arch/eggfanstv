import { expect, spyOn, test } from "bun:test";
import { chapterStoryboardRequirements } from "../src/lib/chapter-storyboard-mode";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import * as taskApi from "../src/services/api/task-center";
import { skillRuntime } from "../src/services/skill-runtime";
import { defaultConfig } from "../src/stores/use-config-store";
import { chapterStoryboardReferencePlan } from "../src/pages/projects/detail/chapter-storyboard-reference-budget";
import { storyboardRowsFromTask } from "../src/lib/canvas/canvas-project-domain";
import { storyboardRowsToProjectShots } from "../src/pages/projects/detail/chapter-storyboard-production";
import { prepareProjectShotAssets } from "../src/services/project-shot-assets";
import { buildShotAssetReferenceContext } from "../src/pages/projects/detail/workflow-shot-references";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { normalizeConfigSnapshot, encodeChannelModel } from "../src/stores/use-config-store";
import type { ProjectAsset, ProjectDetail, ProjectUnitWorkspace } from "../src/services/api/projects";

const assets = [
    { id: "room", title: "议事厅", type: "image" as const, category: "environment", tags: [], prompt: "议事厅" },
    ...Array.from({ length: 9 }, (_, index) => ({ id: `prop-${index}`, title: `信物${index + 1}号`, type: "image" as const, category: "prop", tags: [], prompt: "剧情关键的独立信物" })),
];
const row = (propIds: number[]) => ({
    durationSeconds: 5, plotDescription: "在议事厅依次查验信物。", videoMotionPrompt: "在议事厅依次查验信物。", characters: [],
    sceneAssetId: "room", sceneName: "议事厅", propNames: propIds.map((index) => assets[index + 1]!.title),
    assetBindings: [{ nodeId: "room", role: "environment", priority: 90 }, ...propIds.map((index) => ({ nodeId: `prop-${index}`, role: "prop", priority: 90 }))],
});

test("standard planning shares a nine-image budget across characters, scenes and props without cropping the story", () => {
    for (const directorFormat of [undefined, "shots-v1"] as const) {
        const requirements = chapterStoryboardRequirements("standard", "paced", undefined, directorFormat, 15);
        for (const rule of ["合计不超过9张", "角色、场景、道具", "完整话轮", "不同造型", "不是每类9张", "不能直接截掉"]) expect(requirements).toContain(rule);
    }
    expect(chapterStoryboardRequirements("continuous_30s")).not.toContain("合计不超过9张");
});

test("budget counts the same bound image once and includes automatically discovered characters", () => {
    const task: taskApi.GenerationTask = { id: "offline-count", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [{ ...row([0, 1, 2, 3, 4, 5, 6, 7]), videoMotionPrompt: "议事厅内，林默查验信物。", characters: ["林默"] }] }) };
    const characters = [{ assetId: "hero", versionId: "hero-look", name: "林默", definition: {} }];
    const catalog = [...assets, { id: "hero", title: "林默", type: "character" as const, category: "character", characterVersionId: "hero-look", tags: [], prompt: "主角" }];
    const plan = chapterStoryboardReferencePlan(storyboardRowsFromTask(task).rows, catalog, characters);
    expect(plan.counts).toEqual([10]);
    expect(plan.issues[0]).toContain("10张");
    expect(plan.issues[0]).toContain("林默");
    const exact = chapterStoryboardReferencePlan(storyboardRowsFromTask({ ...task, resultJson: JSON.stringify({ rows: [row([0, 1, 2, 3, 4, 5, 6, 7])] }) }).rows, catalog, characters);
    expect(exact.counts).toEqual([9]);
    expect(exact.issues).toEqual([]);
    expect(new Set(exact.rows[0]!.referenceAssetIds).size).toBe(9);
});

for (const mode of ["standard", "continuous_30s"] as const) {
    test(`${mode} automatically replans excess references only in standard mode`, async () => {
        const makeTask = (id: string, rows: unknown[]): taskApi.GenerationTask => ({ id, type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows }) });
        const initial = makeTask("initial", [row([0, 1, 2, 3, 4, 5, 6, 7, 8])]);
        const repaired = makeTask("replanned", [row([0, 1, 2, 3, 4]), row([5, 6, 7, 8])]);
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValueOnce({ ...initial, status: "queued" }).mockResolvedValue({ ...repaired, status: "queued" });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValueOnce(initial).mockResolvedValue(repaired);
        const prepare = spyOn(skillRuntime, "prepare").mockResolvedValue({ prompt: "【用户任务】查验信物", selectedSkills: [], metadata: {} } as Awaited<ReturnType<typeof skillRuntime.prepare>>);
        try {
            const generated = await generateChapterStoryboard({ projectId: "offline", chapterId: "chapter", chapterTitle: "信物核对", sourceText: "在议事厅依次查验九件信物。", projectStyle: { presetId: "", title: "", prompt: "" }, characters: [], assets, config: { ...defaultConfig, model: "offline", textModel: "offline" }, skills: [], selectedSkillIds: [], approvedRevision: 1, approvedShotIds: [], storyboardMode: mode });
            expect(create).toHaveBeenCalledTimes(mode === "standard" ? 2 : 1);
            expect(generated.rows).toHaveLength(mode === "standard" ? 2 : 1);
            expect(generated.taskId).toBe(mode === "standard" ? "replanned" : "initial");
            if (mode === "standard") {
                expect(create.mock.calls[1]![0].prompt).toContain("10张");
                expect(create.mock.calls[1]![0].prompt).toContain("不删");
                expect(generated.rows.flatMap((item) => item.propNames || []).sort()).toEqual(assets.slice(1).map((asset) => asset.title).sort());
            }
        } finally { prepare.mockRestore(); wait.mockRestore(); create.mockRestore(); }
    });
}

test("a nine-image plan survives script persistence, binding repair and the actual video task payload", async () => {
    const catalog = assets.map((asset) => ({ id: asset.id, title: asset.title, category: asset.category, primaryVersionId: asset.id, mediaType: "image", storageKey: `resource:picture-${asset.id}` })) as ProjectAsset[];
    const parsed = storyboardRowsFromTask({ id: "plan", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [row([0, 1, 2, 3, 4, 5, 6, 7])] }) }).rows;
    const plan = chapterStoryboardReferencePlan(parsed, assets, []);
    const [saved] = storyboardRowsToProjectShots(plan.rows, { assets: catalog } as ProjectDetail);
    expect(saved!.assetVersionIds).toHaveLength(9);
    expect(JSON.stringify(saved!.revision.actionBeats)).toContain("referenceAssetIds");
    const workspace = { unit: { id: "chapter" }, shots: [{ id: "shot", unitId: "chapter", position: 0, currentRevisionId: "revision", description: saved!.description }], shotRevisions: [{ ...saved!.revision, id: "revision", shotId: "shot", version: 1, actionBeatsJson: JSON.stringify(saved!.revision.actionBeats) }], shotReferences: saved!.assetVersionIds.map((assetVersionId) => ({ id: `ref-${assetVersionId}`, shotId: "shot", assetVersionId, asset: catalog.find((asset) => asset.id === assetVersionId), role: "reference", status: "linked", selectionSource: "rule" })), tasks: [], assets: catalog } as unknown as ProjectUnitWorkspace;
    const videoText = `${saved!.revision.videoPrompt} 同场信物9号仍只作为剧情描述。`;
    let writes = 0;
    const prepared = await prepareProjectShotAssets({ projectId: "offline", unitId: "chapter", shotId: "shot", script: { videoPrompt: videoText }, generationArtifactType: "video" }, { getProjectUnitWorkspace: async () => workspace, listProjectAssets: async () => ({ assets: catalog, total: catalog.length }), linkShotAsset: async () => { writes++; throw new Error("must not add unplanned references"); }, unlinkShotAsset: async () => { writes++; return { unlinked: true }; } });
    const context = buildShotAssetReferenceContext({ ...prepared.workspace, assets: catalog } as unknown as ProjectDetail, "shot");
    expect(writes).toBe(0);
    expect(context.referenceImages).toHaveLength(9);
    expect(context.assetReferences.some((reference) => reference.assetId === "prop-8")).toBe(false);
    const config = normalizeConfigSnapshot().config;
    const model = encodeChannelModel("doubao-browser", "seedance_v2.0_std");
    const task = await prepareBackendGenerationTask({ mode: "video", projectId: "offline", config: { ...config, model, videoSeconds: "15", size: "16:9" }, prompt: videoText, referenceImages: context.referenceImages });
    expect((task.input as { referenceImages: unknown[] }).referenceImages).toHaveLength(9);
    expect(task.prompt).toBe(videoText);
});
