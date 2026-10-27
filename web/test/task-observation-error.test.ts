import { expect, test } from "bun:test";
import { waitForGenerationTask, type GenerationTask } from "../src/services/api/task-center";
import { apiClient } from "../src/services/api/request";

const running: GenerationTask = { id: "observation-task", type: "canvas_video", status: "running", prompt: "fixture", attempts: 1, createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };

async function withTaskQuery(operation: () => Promise<GenerationTask>, options: Parameters<typeof waitForGenerationTask>[1]) {
    const adapter = apiClient.defaults.adapter;
    const originalWindow = globalThis.window;
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
    apiClient.defaults.adapter = async (config) => ({ data: { code: 0, data: await operation(), msg: "ok" }, status: 200, statusText: "OK", headers: {}, config });
    try {
        return await waitForGenerationTask(running.id, options).catch((error) => error);
    } finally {
        apiClient.defaults.adapter = adapter;
        globalThis.window = originalWindow;
    }
}

test("status query interruptions preserve the accepted task rather than claiming provider failure", async () => {
    const failure = await withTaskQuery(async () => { throw new Error("query offline"); }, { initialTask: running, intervalMs: 1, timeoutMs: 1000 });
    expect(failure.name).toBe("GenerationTaskObservationError");
    expect(failure.taskId).toBe(running.id);
    expect(failure.latestTask.status).toBe("running");
    expect(failure.reason).toBe("sync");
});

test("local wait deadline retains the task identity and does not imply upstream timeout", async () => {
    const failure = await withTaskQuery(async () => running, { initialTask: running, intervalMs: 1, timeoutMs: 5 });
    expect(failure.name).toBe("GenerationTaskObservationError");
    expect(failure.taskId).toBe(running.id);
    expect(failure.reason).toBe("timeout");
});

test("confirmed provider failure remains a real failure", async () => {
    const failure = await withTaskQuery(async () => ({ ...running, status: "failed", error: "upstream rejected" }), { initialTask: running });
    expect(failure.name).not.toBe("GenerationTaskObservationError");
});

test("aborted observation remains cancellation without changing task state", async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = await withTaskQuery(async () => running, { initialTask: running, signal: controller.signal });
    expect(failure.name).toBe("AbortError");
});
