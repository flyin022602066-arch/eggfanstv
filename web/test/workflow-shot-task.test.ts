import { expect, test } from "bun:test";
import { latestWorkflowShotTasks, mergeWorkflowTaskSnapshots } from "../src/lib/workflow-shot-task";
import type { GenerationTask } from "../src/services/api/task-center";

function task(id: string, status: GenerationTask["status"], createdAt: string, updatedAt = createdAt, artifactType = "video") {
    return { id, status, createdAt, updatedAt, clientContext: { shotId: "shot", artifactType } } as GenerationTask;
}

test("stale retry snapshots cannot resurrect completed or locally stopped tasks", () => {
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
        const stored = task("same-task", status, "2026-11-16T01:00:00Z");
        const stale = { ...stored, status: "running" as const };
        expect(mergeWorkflowTaskSnapshots([stored], [stale])).toEqual([stored]);
        expect(mergeWorkflowTaskSnapshots([stale], [stored])).toEqual([stored]);
        const actualRetry = { ...stale, updatedAt: "2026-11-16T02:00:00Z" };
        expect(mergeWorkflowTaskSnapshots([stored], [actualRetry])).toEqual([actualRetry]);
    }
});

test("an active video wins over a failed attempt in the timeline and submit controls", () => {
    const active = task("active", "queued", "2026-10-21T08:00:00Z");
    const failed = task("failed", "failed", "2026-10-21T07:00:00Z", "2026-10-21T09:00:00Z");
    expect(latestWorkflowShotTasks([failed, active], "video").get("shot")).toBe(active);
});

test("the newest terminal attempt wins even when an older task was updated later", () => {
    const current = task("current", "failed", "2026-10-21T08:00:00Z");
    const old = task("old", "succeeded", "2026-10-21T07:00:00Z", "2026-10-21T09:00:00Z");
    expect(latestWorkflowShotTasks([old, current], "video").get("shot")).toBe(current);
});

test("a running image does not turn a failed video into a running video", () => {
    const video = task("video", "failed", "2026-10-21T08:00:00Z");
    const image = task("image", "running", "2026-10-21T09:00:00Z", undefined, "storyboard");
    expect(latestWorkflowShotTasks([image, video], "video").get("shot")).toBe(video);
});

test("old browser receipt lookups never mask a later successful or failed submission", () => {
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
        const old = { ...task("old-lookup", "running", "2026-11-15T15:05:00Z", "2026-11-16T02:00:00Z"), model: "doubao-browser::seedance_v2.0", stage: "提交状态待确认，正在自动查找原任务回执" };
        const latest = { ...task("latest", status, "2026-11-15T16:39:00Z"), model: old.model };
        for (const order of [[old, latest], [latest, old]]) expect(latestWorkflowShotTasks(order, "video").get("shot")).toBe(latest);
    }
});

test("an actual new browser generation is not marked complete by a previous successful video", () => {
    const completed = { ...task("completed", "succeeded", "2026-11-15T16:00:00Z"), model: "doubao-browser::seedance_v2.0" };
    const rerun = { ...task("rerun", "running", "2026-11-15T17:00:00Z"), model: completed.model };
    expect(latestWorkflowShotTasks([rerun, completed], "video").get("shot")).toBe(rerun);
});

test("historical pending tasks cannot override a newer video across providers", () => {
    for (const model of ["nono::video", "hanbao::seedance_v2.0", "doubao-browser::seedance_v2.0"]) {
        const old = { ...task("old", "running", "2026-11-15T15:00:00Z", "2026-11-16T03:00:00Z"), model, stage: "提交状态待确认" };
        const completed = { ...task("complete", "succeeded", "2026-11-15T16:00:00Z"), model: "nono::new-video" };
        for (const order of [[old, completed], [completed, old]]) expect(latestWorkflowShotTasks(order, "video").get("shot")).toBe(completed);
        const rerun = { ...task("rerun", "running", "2026-11-15T17:00:00Z"), model };
        expect(latestWorkflowShotTasks([rerun, completed, old], "video").get("shot")).toBe(rerun);
    }
});
