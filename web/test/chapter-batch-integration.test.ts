import { afterEach, expect, spyOn, test } from "bun:test";
import type LocalForage from "localforage";
import { installLocalForageStoreFactoryForTests } from "../src/lib/localforage-storage";
import { setActiveUserScope } from "../src/lib/user-scope";
import { captureUserScope } from "../src/lib/user-scope-guard";
import { createChapterBatch } from "../src/lib/chapter-batch";
import { apiClient } from "../src/services/api/request";
import * as ai from "../src/pages/projects/detail/project-chapter-ai";
import { chapterBatchTask, loadChapterBatch, startChapterBatch, stopChapterBatch, type ChapterBatchSettings } from "../src/pages/projects/detail/project-chapter-batch";
import { useConfigStore } from "../src/stores/use-config-store";
import type { GenerationTask } from "../src/services/api/task-center";

const originalAdapter = apiClient.defaults.adapter;
const cleanups: Array<() => void> = [];
afterEach(() => { apiClient.defaults.adapter = originalAdapter; for (const cleanup of cleanups.splice(0)) cleanup(); installLocalForageStoreFactoryForTests(); });
const empty = () => ({ characters: [], scenes: [], props: [] });
const prop = (name: string) => ({ name, description: name, prompt: name });
function setup(projectId: string) {
    setActiveUserScope(projectId); const scope = captureUserScope(), stored = new Map<string, unknown>(), requests: Array<{ method?: string; url: string; body: any }> = [];
    installLocalForageStoreFactoryForTests(() => ({ ready: async () => {}, getItem: async (key: string) => structuredClone(stored.get(key) || null), setItem: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); return value; } }) as unknown as LocalForage);
    const units = [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }];
    const candidates = new Map<string, any[]>(), assets: any[] = [], shots = new Map<string, any[]>(), tasks = new Map<string, GenerationTask>();
    let revision = 1, failConfirm = false, failWrite = false, extraShot = false;
    const workspace = (id: string) => ({ unit: { id, title: id, sourceText: "林夏走进旧屋。", projectId }, shots: [...(shots.get(id) || []), ...(extraShot ? [{ id: "external", unitId: id }] : [])], shotRevisions: [], shotReferences: [], shotArtifacts: [], assetCandidates: candidates.get(id) || [], assets, tasks: [], workflows: [] });
    apiClient.defaults.adapter = async (config) => {
        const url = config.url || "", body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
        requests.push({ method: config.method, url, body });
        let data: any;
        if (url.endsWith("/core")) data = { project: { id: projectId, name: "离线剧", status: "active", revision } };
        else if (url.endsWith("/character-versions")) data = { versions: [], revision };
        else if (url.endsWith("/assets")) data = { assets };
        else if (url.endsWith("/workspace")) data = workspace(url.split("/").at(-2)!);
        else if (url.includes("/chapter-apply-receipts")) data = { receipts: [] };
        else if (url.startsWith("/tasks/")) data = tasks.get(url.split("/").at(-1)!);
        else if (url.endsWith("/asset-candidates")) {
            const id = body.candidates[0].unitId;
            const result = body.candidates.map((item: any, index: number) => ({ ...item, id: id + index, status: "pending_confirmation" }));
            candidates.set(id, result); data = { candidates: result }; revision++;
        } else if (url.endsWith("/confirm")) {
            if (failConfirm) throw new Error("offline confirm failed");
            const id = url.split("/").at(-2)!;
            const candidate = [...candidates.values()].flat().find((item) => item.id === id)!;
            candidate.status = "confirmed"; candidate.resolvedAssetId = "asset-" + id; assets.push({ id: candidate.resolvedAssetId, title: candidate.name, category: candidate.category, usages: [], definitionJson: "{}", unitIds: [candidate.unitId] }); revision++;
            data = { asset: assets.at(-1) };
        } else if (url.endsWith("/shots")) {
            if (failWrite) throw new Error("offline write failed");
            const id = url.split("/").at(-2)!; shots.set(id, body.shots.map((item: any, index: number) => ({ ...item, id: id + index, unitId: id }))); revision++; data = { shots: shots.get(id) };
        } else throw new Error("unexpected request: " + url);
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const settings: ChapterBatchSettings = { config: { ...useConfigStore.getInitialState().config, model: "offline" }, skills: [], selectedSkillIds: [], projectStyle: { presetId: "offline", title: "写实", prompt: "写实" }, storyboardMode: "standard", dialogueConstraintMode: "paced", systemPresentation: { mode: "panel", characterName: "", characterAppearance: "", characterVoice: "" } };
    return { scope, units, settings, requests, tasks, stored, workspace, candidates, assets, setFailConfirm: (value: boolean) => { failConfirm = value; }, setFailWrite: (value: boolean) => { failWrite = value; }, setExtraShot: () => { extraShot = true; } };
}
function mockAssets(callback?: (id: string) => void) {
    const extract = spyOn(ai, "extractChapterAssets").mockImplementation(async (input, options) => { callback?.(input.chapterId); options?.onTaskUpdate?.({ id: "extract-" + input.chapterId, status: "succeeded" } as GenerationTask); return { ...empty(), props: [prop(input.chapterId)], taskId: "extract-" + input.chapterId }; });
    const review = spyOn(ai, "reviewChapterAssets").mockImplementation(async (input, first, options) => { expect(first.props).toHaveLength(1); options?.onTaskUpdate?.({ id: "review-" + input.chapterId, status: "succeeded" } as GenerationTask); return { ...empty(), props: [prop(input.chapterId + "-补漏")], taskId: "review-" + input.chapterId }; });
    cleanups.push(() => extract.mockRestore(), () => review.mockRestore()); return { extract, review };
}
test("batch adapter confirms both passes before extracting the next episode and persists progress without keys", async () => {
    const fixture = setup("batch-confirm"), model = mockAssets((id) => { if (id === "b") expect(fixture.assets).toHaveLength(2); });
    const state = createChapterBatch("batch-confirm", fixture.units, "assets");
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(2); expect(model.review).toHaveBeenCalledTimes(2);
    expect(fixture.assets).toHaveLength(4); expect((await loadChapterBatch(state.projectId, fixture.scope))?.status).toBe("completed");
    expect(JSON.stringify([...fixture.stored.values()])).not.toContain("apiKey");
});
test("confirmation retry reuses extracted and reviewed data, without a second paid model call", async () => {
    const fixture = setup("batch-retry"), model = mockAssets(); fixture.setFailConfirm(true);
    const state = createChapterBatch("batch-retry", fixture.units, "assets");
    const failed = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(failed.status).toBe("paused"); expect(model.extract).toHaveBeenCalledTimes(1); expect(model.review).toHaveBeenCalledTimes(1);
    fixture.setFailConfirm(false);
    const result = await startChapterBatch(failed, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(2); expect(model.review).toHaveBeenCalledTimes(2);
    expect(fixture.requests.filter((request) => request.url.endsWith("/asset-candidates"))).toHaveLength(2);
});
test("pause preserves first-pass output and continuing starts review rather than extracting again", async () => {
    const fixture = setup("batch-pause"), model = mockAssets(() => stopChapterBatch("batch-pause", fixture.scope));
    const state = createChapterBatch("batch-pause", [fixture.units[0]!], "assets");
    const paused = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(paused.status).toBe("paused"); expect(model.review).not.toHaveBeenCalled(); model.extract.mockRestore();
    const result = await startChapterBatch(paused, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.review).toHaveBeenCalledTimes(1);
});
test("scope switch stops batch writes and never confirms assets under the new account", async () => {
    const fixture = setup("batch-scope"); mockAssets(() => setActiveUserScope("other-user"));
    const state = createChapterBatch("batch-scope", fixture.units, "assets");
    await expect(startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {})).rejects.toThrow("账号已切换");
    expect(fixture.requests.some((request) => request.method !== "get")).toBe(false);
});

function mockStoryboard(fixture: ReturnType<typeof setup>, callback?: () => void) {
    const generate = spyOn(ai, "generateChapterStoryboard").mockImplementation(async (input, options) => {
        const task = { id: "storyboard-" + input.chapterId, type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { chapterId: input.chapterId, chapterBatchId: "batch", chapterSourceText: input.sourceText } }), resultJson: JSON.stringify({ rows: [{ plotDescription: "林夏走进旧屋。", videoMotionPrompt: "镜头缓慢推进。", durationSeconds: 15, characters: [], assetBindings: [] }] }) } as GenerationTask;
        fixture.tasks.set(task.id, task); options?.onTaskUpdate?.(task); callback?.();
        return { ...ai.chapterStoryboardFromGenerationTask(task), taskId: task.id, skillCount: 0, skillLoadReport: [] };
    });
    cleanups.push(() => generate.mockRestore()); return generate;
}
test("storyboard save failure resumes the completed task without submitting another generation", async () => {
    const fixture = setup("batch-story-recover"), model = mockStoryboard(fixture); fixture.setFailWrite(true);
    const state = createChapterBatch("batch-story-recover", [fixture.units[0]!], "storyboards");
    const failed = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(failed.status).toBe("paused"); expect(failed.rows[0]?.storyboardError).toContain("offline write failed");
    fixture.setFailWrite(false);
    const result = await startChapterBatch(failed, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model).toHaveBeenCalledTimes(1);
    expect(fixture.workspace("a").shots).toHaveLength(1);
});
test("existing storyboards are skipped, never overwritten or regenerated", async () => {
    const fixture = setup("batch-skip"), model = mockStoryboard(fixture); fixture.setExtraShot();
    const state = createChapterBatch("batch-skip", fixture.units, "storyboards");
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(result.rows.every((row) => row.storyboard === "skipped")).toBe(true); expect(model).not.toHaveBeenCalled();
});
test("a new manual shot during generation blocks replacement and retains the completed task", async () => {
    const fixture = setup("batch-conflict"), model = mockStoryboard(fixture, () => fixture.setExtraShot());
    const state = createChapterBatch("batch-conflict", [fixture.units[0]!], "storyboards");
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("paused"); expect(result.rows[0]?.storyboardError).toContain("分镜已被修改"); expect(model).toHaveBeenCalledTimes(1);
    expect(fixture.requests.filter((request) => request.url.endsWith("/shots"))).toHaveLength(0);
    expect(result.rows[0]?.taskIds.storyboard).toBe("storyboard-a");
});

test("task list summaries isolate batch review even when full input is omitted", () => {
    expect(chapterBatchTask({ clientContext: { chapterBatchId: "batch-1" } } as GenerationTask)).toBe(true);
    expect(chapterBatchTask({ clientContext: { nodeId: "chapter-batch:batch-1:u1:review" } } as GenerationTask)).toBe(true);
    expect(chapterBatchTask({ clientContext: { chapterId: "u1", chapterOperation: "characters" } } as GenerationTask)).toBe(false);
});
