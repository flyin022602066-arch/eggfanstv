import { expect, test } from "bun:test";
import { activeProjectAssetImageBatchIds, submitProjectAssetImageBatch, type ProjectAssetImageBatchState } from "../src/pages/projects/detail/project-asset-image-generation";
import type { ProjectAsset } from "../src/services/api/projects";
import type { CharacterReferenceVersion } from "../src/services/api/project-character-references";
import type { GenerationTask } from "../src/services/api/task-center";
import { setActiveUserScope } from "../src/lib/user-scope";
import { getActiveUserScope } from "../src/lib/user-scope";

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>((done) => { resolve = done; });
    return { promise, resolve };
}

function characterTargets(count: number) {
    const versions = Array.from({ length: count }, (_, index) => ["daily", "winter"].map((look, position) => ({ assetId: `character-${index}`, title: `角色${index}`, versionId: `${index}-${look}`, version: position + 1, definition: { clothing: look }, representations: [], referenceProfile: { lookId: look, name: look } }) as CharacterReferenceVersion)).flat();
    const assets = versions.map((character) => ({ id: character.assetId, title: character.title, category: "character", character }) as ProjectAsset);
    return { versions, assets };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("eight character images submit independent bases immediately and count queued tasks before waiting", async () => {
    const { assets, versions } = characterTargets(4);
    const bases = Array.from({ length: 4 }, () => deferred<GenerationTask>());
    const calls: string[] = [], progress: number[] = [], states: ProjectAssetImageBatchState[] = [];
    const pending = submitProjectAssetImageBatch(assets, async (asset) => {
        calls.push(asset.character!.versionId);
        return { id: asset.character!.versionId, status: "queued", stage: "等待上游" } as GenerationTask;
    }, (completed) => progress.push(completed), {
        projectId: "batch-project", versions, onStateChange: (state) => states.push(state),
        wait: (task) => bases[Number(task.id.split("-")[0])]!.promise,
    });
    await flush();
    expect(calls).toEqual(["0-daily", "1-daily", "2-daily", "3-daily"]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(states.at(-1)?.submitted).toBe(4);
    expect(states.at(-1)?.waiting).toHaveLength(4);
    expect([...activeProjectAssetImageBatchIds("batch-project")]).toHaveLength(4);
    expect(activeProjectAssetImageBatchIds("another-project").size).toBe(0);
    bases[2]!.resolve({ id: "2-daily", status: "succeeded" } as GenerationTask);
    await flush();
    expect(calls.at(-1)).toBe("2-winter");
    expect(calls).toHaveLength(5);
    bases.forEach((base, index) => base.resolve({ id: `${index}-daily`, status: "succeeded" } as GenerationTask));
    const result = await pending;
    expect(calls).toHaveLength(8);
    expect(new Set(calls).size).toBe(8);
    expect(result.submittedIds).toHaveLength(8);
    expect(result.failures).toEqual([]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(activeProjectAssetImageBatchIds("batch-project").size).toBe(0);
});

test("slow admission of one asset does not hold back another asset", async () => {
    const first = deferred<unknown>();
    const calls: string[] = [];
    const pending = submitProjectAssetImageBatch(["first", "second", "third"].map((id) => ({ id, title: id }) as ProjectAsset), async (asset) => {
        calls.push(asset.id);
        if (asset.id === "first") await first.promise;
    }, () => undefined);
    await flush();
    expect(calls).toEqual(["first", "second", "third"]);
    first.resolve(undefined);
    expect((await pending).submittedIds).toEqual(calls);
});

test("base failure affects only its dependent looks and keeps its successful submission count", async () => {
    const { assets, versions } = characterTargets(2);
    const calls: string[] = [];
    const result = await submitProjectAssetImageBatch(assets, async (asset) => {
        calls.push(asset.character!.versionId);
        return { id: asset.character!.versionId, status: "queued" } as GenerationTask;
    }, () => undefined, { versions, wait: async (task) => ({ ...task, status: task.id === "0-daily" ? "failed" : "succeeded" }) });
    expect(calls).toEqual(["0-daily", "1-daily", "1-winter"]);
    expect(result.submittedIds).toHaveLength(3);
    expect(result.failures.map(({ asset }) => asset.character!.versionId)).toEqual(["0-winter"]);
});

test("stop releases waiting observation without cancelling queued images or submitting dependent looks", async () => {
    const { assets, versions } = characterTargets(1);
    const controller = new AbortController();
    const calls: string[] = [];
    const pending = submitProjectAssetImageBatch(assets, async (asset) => {
        calls.push(asset.character!.versionId);
        return { id: "base-task", status: "queued" } as GenerationTask;
    }, () => undefined, {
        projectId: "stopped-project", versions, signal: controller.signal,
        wait: (_task, options) => new Promise((_resolve, reject) => { options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }),
    });
    await flush();
    controller.abort();
    const result = await pending;
    expect(calls).toEqual(["0-daily"]);
    expect(result.submittedIds).toEqual(["character-0"]);
    expect(result.failures).toEqual([]);
    expect(result.cancelledAssets.map((asset) => asset.character!.versionId)).toEqual(["0-winter"]);
    expect(activeProjectAssetImageBatchIds("stopped-project").size).toBe(0);
});

test("malformed character identity reports a target error without aborting unrelated assets", async () => {
    const { assets, versions } = characterTargets(2);
    const result = await submitProjectAssetImageBatch(assets, async (asset) => ({ id: asset.id, status: "queued" }) as GenerationTask, () => undefined, {
        versions: versions.filter((version) => version.assetId !== "character-0"),
        wait: async (task) => ({ ...task, status: "succeeded" }),
    });
    expect(result.failures).toHaveLength(2);
    expect(result.submittedIds).toEqual(["character-1", "character-1"]);
});

test("background reservations remain isolated when the user changes", async () => {
    const originalScope = getActiveUserScope();
    const request = deferred<unknown>();
    setActiveUserScope("batch-owner");
    const pending = submitProjectAssetImageBatch([{ id: "scene", title: "场景" }] as ProjectAsset[], () => request.promise, () => undefined, { projectId: "shared-project" });
    expect(activeProjectAssetImageBatchIds("shared-project").has("scene")).toBe(true);
    setActiveUserScope("another-owner");
    expect(activeProjectAssetImageBatchIds("shared-project").size).toBe(0);
    request.resolve({ id: "scene-task", status: "queued" });
    try { await expect(pending).rejects.toThrow("账号已切换"); }
    finally { setActiveUserScope(originalScope); }
});
