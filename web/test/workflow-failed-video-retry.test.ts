import { expect, test } from "bun:test";
import { failedUnitVideoTasks, retryFailedUnitVideos } from "../src/pages/projects/detail/workflow-failed-video-retry";
import type { ProjectDetail, ProjectUnitWorkspace } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";

function fixture() {
    const task = (id: string, shotId: string, status: GenerationTask["status"], hour = 1): GenerationTask => ({ id, type: "canvas_video", status, prompt: `人工修改的最终提示词-${shotId}`, attempts: 1, createdAt: `2026-11-16T0${hour}:00:00Z`, updatedAt: `2026-11-16T0${hour}:00:00Z`, clientContext: { shotId, chapterId: "unit", artifactType: "video" } });
    const detail = { project: { id: "project" }, units: [{ id: "unit" }], shots: ["failed", "success", "running", "cancelled", "new"].map((name, position) => ({ id: name, unitId: "unit", position })), shotArtifacts: [], tasks: [task("failed-task", "failed", "failed"), task("old-failure", "success", "failed"), task("success-task", "success", "succeeded", 2), task("running-old-failure", "running", "failed"), task("running-task", "running", "running", 2), task("cancelled-task", "cancelled", "cancelled"), task("other-unit", "outside", "failed")] } as unknown as ProjectDetail;
    const api = {
        getWorkspace: async () => ({ ...detail, unit: { id: "unit" } } as unknown as ProjectUnitWorkspace),
        queryTask: async (id: string) => detail.tasks!.find((item) => item.id === id)!,
        retryTask: async (id: string) => ({ ...detail.tasks!.find((item) => item.id === id)!, status: "queued" as const }),
        recoverTask: async (id: string) => ({ task: { ...detail.tasks!.find((item) => item.id === id)!, status: "running" as const }, providerStatus: "running", recovered: false }),
    };
    return { detail, api };
}

test("only the latest failed video of the selected episode is eligible", () => {
    const { detail } = fixture();
    expect(failedUnitVideoTasks(detail, "unit").map((task) => task.id)).toEqual(["failed-task"]);
    expect(failedUnitVideoTasks(detail, "unit", new Set(["failed"]))).toEqual([]);
});

test("retry rechecks live task state, uses the original retry endpoint and reports partial failures", async () => {
    const { detail, api } = fixture();
    detail.shots.push({ ...detail.shots[0]!, id: "second", position: 8 });
    detail.tasks!.push({ ...detail.tasks![0]!, id: "second-task", clientContext: { shotId: "second", artifactType: "video" } });
    const attempted: string[] = [];
    const progress: number[] = [];
    const result = await retryFailedUnitVideos(detail, "unit", { onProgress: (value) => progress.push(value.completed) }, { ...api, retryTask: async (id) => { attempted.push(id); if (id === "failed-task") throw new Error("上游凭据不可用"); return api.retryTask(id); } });
    expect(attempted).toEqual(["failed-task", "second-task"]);
    expect(result.submitted.map((item) => item.id)).toEqual(["second-task"]);
    expect(result.failures).toEqual([{ shotId: "failed", taskId: "failed-task", message: "上游凭据不可用" }]);
    expect(progress.at(-1)).toBe(2);
    expect(detail.tasks![0]!.prompt).toBe("人工修改的最终提示词-failed");
});

test("a task that became running after the click is skipped instead of submitted twice", async () => {
    const { detail, api } = fixture();
    let calls = 0;
    const result = await retryFailedUnitVideos(detail, "unit", {}, { ...api, queryTask: async (id) => ({ ...await api.queryTask(id), status: "running" }), retryTask: async (id) => { calls++; return api.retryTask(id); } });
    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
});

test("unconfirmed submission and completed local failures recover the original task without billing another video", async () => {
    for (const change of [{ stage: "submission_unknown" }, { failureDiagnostics: { source: "local_result" as const, executionResult: "completed" } }]) {
        const { detail, api } = fixture();
        Object.assign(detail.tasks![0]!, change);
        const retried: string[] = [], recovered: string[] = [];
        const result = await retryFailedUnitVideos(detail, "unit", {}, { ...api, retryTask: async (id) => { retried.push(id); return api.retryTask(id); }, recoverTask: async (id) => { recovered.push(id); return api.recoverTask(id); } });
        expect(retried).toEqual([]);
        expect(recovered).toEqual(["failed-task"]);
        expect(result.recovered).toHaveLength(1);
    }
});

test("a failed original-task lookup cannot be reported as recovered or create another paid task", async () => {
    const { detail, api } = fixture();
    detail.tasks![0]!.stage = "submission_unknown";
    let submissions = 0;
    const result = await retryFailedUnitVideos(detail, "unit", {}, { ...api, retryTask: async (id) => { submissions++; return api.retryTask(id); }, recoverTask: async (id) => ({ task: { ...await api.queryTask(id), status: "failed", error: "原任务查询仍未恢复" }, providerStatus: "failed", recovered: false }) });
    expect(submissions).toBe(0);
    expect(result.recovered).toEqual([]);
    expect(result.failures[0]?.message).toBe("原任务查询仍未恢复");
});

test("one slow recovery does not queue other failed video submissions", async () => {
    const { detail, api } = fixture();
    detail.tasks![0]!.stage = "submission_unknown";
    detail.shots.push({ ...detail.shots[0]!, id: "second", position: 8 });
    detail.tasks!.push({ ...detail.tasks![0]!, id: "second-task", stage: "生成失败", clientContext: { shotId: "second", artifactType: "video" } });
    let finishRecovery!: () => void;
    const waiting = new Promise<void>((resolve) => { finishRecovery = resolve; });
    const submitted: string[] = [];
    const pending = retryFailedUnitVideos(detail, "unit", {}, { ...api, recoverTask: async (id) => { await waiting; return api.recoverTask(id); }, retryTask: async (id) => { submitted.push(id); return api.retryTask(id); } });
    try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(submitted).toEqual(["second-task"]);
    } finally { finishRecovery(); }
    const result = await pending;
    expect(result.submitted).toHaveLength(1);
    expect(result.recovered).toHaveLength(1);
});
