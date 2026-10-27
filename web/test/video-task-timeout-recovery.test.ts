import { expect, test } from "bun:test";
import { canvasNodeActiveTaskId, canvasNodeInterruptedTaskId, isCanvasNodeGenerating } from "../src/lib/canvas/canvas-node-task-state";
import { createGenerationTaskSubscriptionService, taskWaitTimeoutMs, type GenerationTask } from "../src/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const running: GenerationTask = {
    id: "timeout-video-task", type: "canvas_video", status: "running", prompt: "fixture",
    attempts: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z",
};
const interruptedNode: CanvasNodeData = {
    id: "video", title: "fixture", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 420, height: 240,
    metadata: { status: "error", taskId: running.id, taskStatus: "running", errorDetails: "任务执行超时，请稍后重试" },
};

test("video waits allow a full hour while other task limits stay unchanged", () => {
    expect(taskWaitTimeoutMs(running)).toBe(60 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, type: "canvas_image" })).toBe(10 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, type: "canvas_text" })).toBe(12 * 60 * 1000);
});

test("Jiasu video observation allows 120 minutes and respects channel isolation", () => {
    expect(taskWaitTimeoutMs({ ...running, model: "jiasu-video::sd-2.5-j2-V" })).toBe(120 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, model: "custom-channel::sd-2.5-j2-V", inputJson: JSON.stringify({ config: { interfaceType: "jiasu-video" } }) })).toBe(120 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, model: "jiasu-video::sd-2.5-j2-V", inputJson: JSON.stringify({ config: { interfaceType: "eggfans-sd2-video" } }) })).toBe(60 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, model: "eggfans-sd2-video::sd-2.5-D" })).toBe(60 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, model: "jiasu-video::dola-sd-2.5", inputJson: "invalid-json" })).toBe(120 * 60 * 1000);
    expect(taskWaitTimeoutMs({ ...running, type: "canvas_image", model: "jiasu-video::model" })).toBe(10 * 60 * 1000);
});

test("a local timeout reconciles the existing task without unlocking live generation", () => {
    expect(canvasNodeInterruptedTaskId(interruptedNode)).toBe(running.id);
    expect(isCanvasNodeGenerating(interruptedNode)).toBe(true);
    for (const status of ["failed", "cancelled", "succeeded"] as const) {
        const reconciled = { ...interruptedNode, metadata: { ...interruptedNode.metadata, taskStatus: status } };
        expect(canvasNodeInterruptedTaskId(reconciled)).toBeUndefined();
        expect(isCanvasNodeGenerating(reconciled)).toBe(false);
    }
    expect(isCanvasNodeGenerating({ ...interruptedNode, metadata: { taskStatus: "failed" } }, interruptedNode.id)).toBe(false);
});

test("live task observation survives recovery from a stale error card", () => {
    expect(canvasNodeActiveTaskId(interruptedNode)).toBe(running.id);
    const resumed = { ...interruptedNode, metadata: { ...interruptedNode.metadata, status: "loading" as const, errorDetails: undefined } };
    expect(canvasNodeActiveTaskId(resumed)).toBe(running.id);
    expect(canvasNodeActiveTaskId({ ...resumed, metadata: { ...resumed.metadata, taskStatus: "failed" } })).toBeUndefined();
});

test("live subscribers recover after repeated observation failures and release the failed node", async () => {
    let queryCalls = 0;
    let waitCalls = 0;
    let node = structuredClone(interruptedNode);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            queryCalls += 1;
            return queryCalls < 3 ? running : { ...running, status: "failed", error: "timeout" };
        },
        async waitTask() {
            waitCalls += 1;
            throw new Error("temporary status synchronization failure");
        },
    });
    const unsubscribe = service.subscribe([running.id], (task) => {
        node = { ...node, metadata: { ...node.metadata, taskStatus: task.status } };
        if (task.status === "failed") finish();
    });
    try {
        await finished;
        expect(queryCalls).toBe(3);
        expect(waitCalls).toBe(2);
        expect(isCanvasNodeGenerating(node)).toBe(false);
        expect(canvasNodeInterruptedTaskId(node)).toBeUndefined();
    } finally { unsubscribe(); }
}, 12_000);

test("the last unsubscribe clears pending reconnection and a new subscriber resumes immediately", async () => {
    let queryCalls = 0;
    let waitCalls = 0;
    const service = createGenerationTaskSubscriptionService({
        async queryTask() {
            queryCalls += 1;
            return queryCalls === 1 ? running : { ...running, status: "failed" };
        },
        async waitTask() { waitCalls += 1; throw new Error("offline"); },
    });
    const disconnect = service.subscribe([running.id], () => undefined);
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    disconnect();
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(queryCalls).toBe(1);
    const statuses: string[] = [];
    const reconnect = service.subscribe([running.id], (task) => statuses.push(task.status));
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    reconnect();
    expect(queryCalls).toBe(2);
    expect(waitCalls).toBe(1);
    expect(statuses.at(-1)).toBe("failed");
}, 5000);

test("published terminal failure does not schedule another observation", async () => {
    let queryCalls = 0;
    const service = createGenerationTaskSubscriptionService({
        async queryTask() { queryCalls += 1; return running; },
        async waitTask(_id, options) {
            options?.onTaskUpdate?.({ ...running, status: "failed" });
            throw new Error("upstream timeout");
        },
    });
    const statuses: string[] = [];
    const disconnect = service.subscribe([running.id], (task) => statuses.push(task.status));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    disconnect();
    expect(statuses).toEqual(["running", "failed"]);
    expect(queryCalls).toBe(1);
}, 5000);
