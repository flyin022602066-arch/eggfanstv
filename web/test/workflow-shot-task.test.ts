import { expect, test } from "bun:test";
import { latestWorkflowShotTasks } from "../src/lib/workflow-shot-task";
import type { GenerationTask } from "../src/services/api/task-center";

function task(id: string, status: GenerationTask["status"], createdAt: string, updatedAt = createdAt, artifactType = "video") {
    return { id, status, createdAt, updatedAt, clientContext: { shotId: "shot", artifactType } } as GenerationTask;
}

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
