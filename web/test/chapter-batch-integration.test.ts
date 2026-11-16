import { afterEach, expect, spyOn, test } from "bun:test";
import type LocalForage from "localforage";
import { installLocalForageStoreFactoryForTests } from "../src/lib/localforage-storage";
import { setActiveUserScope } from "../src/lib/user-scope";
import { captureUserScope } from "../src/lib/user-scope-guard";
import { createChapterBatch, resumeChapterBatch } from "../src/lib/chapter-batch";
import { apiClient } from "../src/services/api/request";
import * as ai from "../src/pages/projects/detail/project-chapter-ai";
import { chapterBatchTask, completeChapterBatchStoryboardReview, loadChapterBatch, startChapterBatch, stopChapterBatch, type ChapterBatchSettings } from "../src/pages/projects/detail/project-chapter-batch";
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
    const candidates = new Map<string, any[]>(), assets: any[] = [], versions: any[] = [], shots = new Map<string, any[]>(), tasks = new Map<string, GenerationTask>();
    let revision = 1, failConfirm = false, failWrite = false, extraShot = false;
    const workspace = (id: string) => ({ unit: { id, title: id, sourceText: "林夏走进旧屋。", projectId }, shots: [...(shots.get(id) || []), ...(extraShot ? [{ id: "external", unitId: id }] : [])], shotRevisions: [], shotReferences: [], shotArtifacts: [], assetCandidates: candidates.get(id) || [], assets, tasks: [], workflows: [] });
    apiClient.defaults.adapter = async (config) => {
        const url = config.url || "", body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
        requests.push({ method: config.method, url, body });
        let data: any;
        if (url.endsWith("/core")) data = { project: { id: projectId, name: "离线剧", status: "active", revision } };
        else if (url.endsWith("/character-versions")) data = { versions, revision };
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
    return { scope, units, settings, requests, tasks, stored, workspace, candidates, assets, versions, shots, setFailConfirm: (value: boolean) => { failConfirm = value; }, setFailWrite: (value: boolean) => { failWrite = value; }, setExtraShot: () => { extraShot = true; } };
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
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
    apiClient.defaults.adapter = async (config) => {
        try { return await adapter(config); }
        finally { if (config.url?.endsWith("/confirm")) fixture.setFailConfirm(false); }
    };
    const state = createChapterBatch("batch-retry", fixture.units, "assets");
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(2); expect(model.review).toHaveBeenCalledTimes(2);
    expect(fixture.requests.filter((request) => request.url.endsWith("/asset-candidates"))).toHaveLength(2);
});
test("invalid recovered extraction is discarded and resubmitted with a fresh operation", async () => {
    const fixture = setup("batch-invalid-assets"), model = mockAssets();
    const state = createChapterBatch("batch-invalid-assets", [fixture.units[0]!], "assets");
    const task = { id: "invalid-output", status: "succeeded", resultJson: JSON.stringify({ text: "not JSON" }) } as GenerationTask;
    fixture.tasks.set(task.id, task); state.rows[0]!.taskIds.extract = task.id;
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, (batch) => { if ((batch.rows[0]!.assetRetries || 0) > 2) stopChapterBatch(state.projectId, fixture.scope); }, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(1);
    expect(model.extract.mock.calls[0]![1]?.taskAttempt).toBe(1); expect(result.rows[0]!.taskIds.extract).toBe("extract-a");
});
test("failed extraction retries immediately with a new operation and no duplicate episode work", async () => {
    const fixture = setup("batch-extract-failure"), model = mockAssets();
    model.extract.mockImplementationOnce(async (_input, options) => {
        const task = { id: "failed-extract", status: "failed", error: "content_filter: empty result" } as GenerationTask;
        fixture.tasks.set(task.id, task); options?.onTaskUpdate?.(task); throw new Error(task.error);
    });
    const result = await startChapterBatch(createChapterBatch("batch-extract-failure", [fixture.units[0]!], "assets"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(2); expect(model.review).toHaveBeenCalledTimes(1);
    expect(model.extract.mock.calls[1]![1]?.taskAttempt).toBe(1); expect(result.rows[0]!.assetRetries).toBe(1);
});
test("an interrupted completed asset query recovers the paid result instead of resubmitting", async () => {
    const fixture = setup("batch-asset-query-recovery"), model = mockAssets();
    const task = { id: "paid-extract", status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify({ ...empty(), props: [prop("旧信")] }) }) } as GenerationTask;
    fixture.tasks.set(task.id, task);
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>; let interrupted = false;
    apiClient.defaults.adapter = async (config) => {
        if (config.url === "/tasks/paid-extract" && !interrupted) { interrupted = true; throw new Error("connection lost"); }
        return adapter(config);
    };
    const state = createChapterBatch("batch-asset-query-recovery", [fixture.units[0]!], "assets"); state.rows[0]!.taskIds.extract = task.id;
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).not.toHaveBeenCalled(); expect(result.rows[0]!.taskIds.extract).toBe(task.id);
});
test("two empty asset passes restart extraction rather than retrying the same empty confirmation", async () => {
    const fixture = setup("batch-empty-assets"), model = mockAssets();
    model.extract.mockImplementationOnce(async () => ({ ...empty(), taskId: "empty-extract" }));
    model.review.mockImplementationOnce(async () => ({ ...empty(), taskId: "empty-review" }));
    const result = await startChapterBatch(createChapterBatch("batch-empty-assets", [fixture.units[0]!], "assets"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model.extract).toHaveBeenCalledTimes(2); expect(model.review).toHaveBeenCalledTimes(2);
    expect(model.extract.mock.calls[1]![1]?.taskAttempt).toBe(1); expect(model.review.mock.calls[1]![2]?.taskAttempt).toBe(1);
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

function mockStoryboard(fixture: ReturnType<typeof setup>, callback?: () => void, rowCounts = [3], characters: unknown[] = []) {
    let generatedCount = 0;
    const generate = spyOn(ai, "generateChapterStoryboard").mockImplementation(async (input, options) => {
        const count = rowCounts[Math.min(generatedCount++, rowCounts.length - 1)]!;
        const task = { id: "storyboard-" + input.chapterId + (options?.taskAttempt ? "-" + options.taskAttempt : ""), type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { chapterId: input.chapterId, chapterBatchId: "batch", chapterSourceText: input.sourceText } }), resultJson: JSON.stringify({ rows: Array.from({ length: count }, (_, index) => ({ plotDescription: "林夏走进旧屋。" + index, videoMotionPrompt: "镜头缓慢推进。", durationSeconds: 15, characters, assetBindings: [] })) }) } as GenerationTask;
        fixture.tasks.set(task.id, task); options?.onTaskUpdate?.(task); callback?.();
        return { ...ai.chapterStoryboardFromGenerationTask(task), taskId: task.id, skillCount: 0, skillLoadReport: [] };
    });
    cleanups.push(() => generate.mockRestore()); return generate;
}

function addCharacter(fixture: ReturnType<typeof setup>, multiple = false) {
    const character = { versionId: "hero-v1", version: 1, definition: {}, representations: [], visualStatus: "missing", voiceStatus: "missing" };
    fixture.assets.push({ id: "hero", title: "林夏", category: "character", primaryVersionId: character.versionId, character });
    fixture.versions.push({ ...character, assetId: "hero", title: "林夏", updatedAt: "" });
    if (multiple) fixture.versions.push({ ...fixture.versions[0], versionId: "hero-v2", version: 2 });
}
test("batch repairs an unknown ID from the same character's unique version without another model call", async () => {
    const fixture = setup("batch-reference-repair"); addCharacter(fixture);
    const model = mockStoryboard(fixture, undefined, [3], [{ characterName: "林夏", characterAssetId: "hero", characterVersionId: "typo-v1" }]);
    const result = await startChapterBatch(createChapterBatch("batch-reference-repair", [fixture.units[0]!], "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model).toHaveBeenCalledTimes(1);
    expect(fixture.workspace("a").shots.every((shot) => shot.assetVersionIds.includes("hero-v1"))).toBe(true);
    expect(result.rows[0]!.storyboardRepairs?.length).toBe(3);
});
test("ambiguous completed references wait for manual review, keep the paid task and let the next episode run", async () => {
    const fixture = setup("batch-reference-review"); addCharacter(fixture, true);
    const model = mockStoryboard(fixture, undefined, [3], [{ characterName: "林夏", characterAssetId: "hero", characterVersionId: "typo-v1" }]);
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
    let catalogReads = 0;
    apiClient.defaults.adapter = async (config) => {
        if (config.url?.endsWith("/character-versions") && ++catalogReads > 4) stopChapterBatch("batch-reference-review", fixture.scope);
        return adapter(config);
    };
    const result = await startChapterBatch(createChapterBatch("batch-reference-review", fixture.units, "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("paused"); expect(model).toHaveBeenCalledTimes(2);
    expect(result.rows.every((row) => row.storyboardNeedsReview && row.storyboard === "failed")).toBe(true);
    expect(result.rows[0]!.taskIds.storyboard).toBe("storyboard-a"); expect(result.rows[1]!.taskIds.storyboard).toBe("storyboard-b");
    expect(result.rows.every((row) => !row.storyboardRetries)).toBe(true);
    expect(fixture.requests.some((request) => request.url.endsWith("/shots"))).toBe(false);
}, 20000);
test("manual review marks only the matching batch row completed after a confirmed write receipt", async () => {
    const fixture = setup("batch-reference-receipt"); addCharacter(fixture, true);
    const model = mockStoryboard(fixture, undefined, [3], [{ characterName: "林夏", characterAssetId: "hero", characterVersionId: "typo-v1" }]);
    const state = await startChapterBatch(createChapterBatch("batch-reference-receipt", [fixture.units[0]!], "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    await expect(completeChapterBatchStoryboardReview(state.projectId, "a", "storyboard-a", fixture.scope)).rejects.toThrow("尚未确认分镜写入成功");
    expect((await loadChapterBatch(state.projectId, fixture.scope))!.rows[0]!.storyboardNeedsReview).toBe(true);
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
    apiClient.defaults.adapter = async (config) => config.url?.includes("/chapter-apply-receipts") ? { data: { code: 0, data: { receipts: [{ taskId: "storyboard-a", kind: "storyboard", applied: true }] } }, status: 200, statusText: "OK", headers: {}, config } : adapter(config);
    await completeChapterBatchStoryboardReview(state.projectId, "a", "storyboard-a", fixture.scope);
    const completed = await loadChapterBatch(state.projectId, fixture.scope);
    expect(completed!.status).toBe("completed"); expect(completed!.rows[0]!.storyboardNeedsReview).toBe(false);
    expect(completed!.rows[0]!.storyboardError).toBeUndefined(); expect(model).toHaveBeenCalledTimes(1);
});
test("storyboard save failure resumes the completed task without submitting another generation", async () => {
    const fixture = setup("batch-story-recover"), model = mockStoryboard(fixture); fixture.setFailWrite(true);
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
    apiClient.defaults.adapter = async (config) => {
        if (config.url?.endsWith("/shots") && config.method === "put") stopChapterBatch("batch-story-recover", fixture.scope);
        return adapter(config);
    };
    const state = createChapterBatch("batch-story-recover", [fixture.units[0]!], "storyboards");
    const failed = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(failed.status).toBe("paused"); expect(failed.rows[0]?.storyboardError).toContain("offline write failed");
    fixture.setFailWrite(false);
    apiClient.defaults.adapter = adapter;
    const result = await startChapterBatch(failed, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(model).toHaveBeenCalledTimes(1);
    expect(fixture.workspace("a").shots).toHaveLength(3);
});
test("existing complete storyboards are skipped, never overwritten or regenerated", async () => {
    const fixture = setup("batch-skip"), model = mockStoryboard(fixture);
    for (const unit of fixture.units) fixture.shots.set(unit.id, [0, 1, 2].map((index) => ({ id: unit.id + index, unitId: unit.id })));
    const state = createChapterBatch("batch-skip", fixture.units, "storyboards");
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(result.rows.every((row) => row.storyboard === "skipped")).toBe(true); expect(model).not.toHaveBeenCalled();
});

test("assets-only continuation does not query old storyboard tasks or submit storyboards and can later resume them", async () => {
    const fixture = setup("batch-resume-mode"), assets = mockAssets(), storyboards = mockStoryboard(fixture);
    const previous = createChapterBatch("batch-resume-mode", fixture.units, "linked");
    previous.rows[0]!.assets = "completed"; previous.rows[0]!.storyboard = "failed"; previous.rows[0]!.taskIds.storyboard = "old-storyboard";
    fixture.tasks.set("old-storyboard", { id: "old-storyboard", status: "failed" } as GenerationTask);
    const completed = await startChapterBatch(resumeChapterBatch(previous, "assets"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(completed.status).toBe("completed"); expect(completed.mode).toBe("assets");
    expect(storyboards).not.toHaveBeenCalled(); expect(assets.extract).toHaveBeenCalledTimes(1); expect(assets.review).toHaveBeenCalledTimes(1);
    expect(fixture.requests.some((request) => request.url.includes("old-storyboard") || request.url.endsWith("/shots"))).toBe(false);
    expect(completed.rows[0]!.taskIds.storyboard).toBe("old-storyboard");
    const resumed = await startChapterBatch(resumeChapterBatch(completed, "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(resumed.status).toBe("completed"); expect(storyboards).toHaveBeenCalledTimes(2); expect(assets.extract).toHaveBeenCalledTimes(1);
    expect(fixture.workspace("a").shots).toHaveLength(3); expect(fixture.workspace("b").shots).toHaveLength(3);
});

test("one or two existing shots are replaced only after a complete new storyboard is ready", async () => {
    const fixture = setup("batch-sparse");
    fixture.shots.set("a", [{ id: "old-a", unitId: "a" }]);
    fixture.shots.set("b", [{ id: "old-b1", unitId: "b" }, { id: "old-b2", unitId: "b" }]);
    mockStoryboard(fixture, () => { expect(fixture.workspace("a").shots.length).toBeGreaterThan(0); });
    const result = await startChapterBatch(createChapterBatch("batch-sparse", fixture.units, "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed");
    expect(fixture.workspace("a").shots).toHaveLength(3); expect(fixture.workspace("b").shots).toHaveLength(3);
    expect(fixture.requests.filter((request) => request.url.endsWith("/shots")).map((request) => request.body.expectedShotIds)).toEqual([["old-a"], ["old-b1", "old-b2"]]);
});

test("a one-shot model result is rejected and a new operation is submitted before writing", async () => {
    const fixture = setup("batch-short-result"); mockStoryboard(fixture, undefined, [1, 2, 3]);
    const result = await startChapterBatch(createChapterBatch("batch-short-result", [fixture.units[0]!], "storyboards"), fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(fixture.workspace("a").shots).toHaveLength(3);
    expect([...fixture.tasks.keys()]).toEqual(["storyboard-a", "storyboard-a-1", "storyboard-a-2"]);
    expect(fixture.requests.filter((request) => request.url.endsWith("/shots"))).toHaveLength(1);
}, 30000);

test("continuing a previously completed batch rechecks and regenerates one-shot episodes", async () => {
    const fixture = setup("batch-old-complete"); mockStoryboard(fixture);
    fixture.shots.set("a", [{ id: "old-a", unitId: "a" }]);
    const state = createChapterBatch("batch-old-complete", [fixture.units[0]!], "storyboards");
    state.status = "completed"; state.rows[0]!.storyboard = "completed"; state.rows[0]!.taskIds.storyboard = "old-task";
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(fixture.workspace("a").shots).toHaveLength(3);
    expect(result.rows[0]!.taskIds.storyboard).toBe("storyboard-a-1");
});

test("a failed model task is retried with a new operation but its assets are not re-extracted", async () => {
    const fixture = setup("batch-failed-task"), assets = mockAssets(); mockStoryboard(fixture);
    const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
    let checks = 0;
    const oldTask = { id: "old-failed", status: "failed" } as GenerationTask; fixture.tasks.set(oldTask.id, oldTask);
    apiClient.defaults.adapter = async (config) => {
        if (config.url === "/tasks/old-failed" && checks++ === 0) throw new Error("connection interrupted before observing failure");
        return adapter(config);
    };
    const state = createChapterBatch("batch-failed-task", [fixture.units[0]!], "storyboards"); state.rows[0]!.taskIds.storyboard = oldTask.id;
    const result = await startChapterBatch(state, fixture.scope, fixture.settings, () => {}, () => {});
    expect(result.status).toBe("completed"); expect(fixture.workspace("a").shots).toHaveLength(3);
    expect(result.rows[0]!.taskIds.storyboard).toBe("storyboard-a-1"); expect(assets.extract).not.toHaveBeenCalled();
}, 15000);
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
