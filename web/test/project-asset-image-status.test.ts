import { expect, test } from "bun:test";
import type { GenerationTask } from "@/services/api/task-center";
import { assetImageTaskStatus, latestAssetImageTasks, assetImageCheckStatus } from "@/pages/projects/detail/project-asset-image-status";

const task = (patch: Partial<GenerationTask> = {}): GenerationTask => ({ id: "task", projectId: "project", type: "canvas_image", status: "running", prompt: "", attempts: 1, createdAt: "2026-11-10T13:00:00Z", updatedAt: "2026-11-10T13:01:00Z", clientContext: { nodeId: "project-asset-image:scene" }, ...patch });

test("image status distinguishes waiting, transfer, saving, interruption and ready without invented progress", () => {
    expect(assetImageTaskStatus(task()).label).toBe("等待上游结果");
    expect(assetImageTaskStatus(task({ stage: "正在取回生成结果" })).label).toBe("正在取回图片");
    expect(assetImageTaskStatus(task({ status: "succeeded", resultState: "PENDING_MATERIALIZATION" })).label).toBe("图片已生成，正在入库");
    expect(assetImageTaskStatus(task({ status: "succeeded", resultState: "FAILED_RETRYABLE" })).label).toBe("图片已生成，入库失败");
    expect(assetImageTaskStatus(task({ status: "succeeded", resultState: "READY" })).label).toBe("图片已取回入库");
    const interrupted = assetImageTaskStatus(task({ status: "failed", stage: "submission_unknown", error: "stream PROTOCOL_ERROR" }));
    expect(interrupted.label).toBe("响应中断，结果未确认");
    expect(interrupted.description).toContain("不会自动重新生成");
    expect(assetImageTaskStatus(task({ status: "failed", failureDiagnostics: { source: "local_result", executionResult: "completed" } })).label).toBe("图片已生成，本地保存失败");
});

test("status list isolates projects and character looks, keeps the latest submitted task rather than a late old update", () => {
    const result = latestAssetImageTasks([
        task({ id: "old", status: "succeeded", updatedAt: "2026-11-10T14:00:00Z" }),
        task({ id: "new", status: "failed", createdAt: "2026-11-10T13:30:00Z" }),
        task({ id: "foreign", projectId: "other" }),
        task({ id: "look-a", clientContext: { nodeId: "character-turnaround:hero", characterVersionId: "a" } }),
        task({ id: "look-b", clientContext: { nodeId: "character-turnaround:hero", characterVersionId: "b" } }),
        task({ id: "video", type: "canvas_video" }),
    ], "project");
    expect(result.map(item => item.id).sort()).toEqual(["look-a", "look-b", "new"]);
});

test("automatic check never claims a connection is live after a failed status request", () => {
    expect(assetImageCheckStatus({ fetching: true, updatedAt: 0 }).label).toBe("正在检测图片任务");
    expect(assetImageCheckStatus({ fetching: false, updatedAt: 0, error: "连接中断" }).label).toBe("状态检测中断");
    expect(assetImageCheckStatus({ fetching: false, updatedAt: 1000 }).label).toBe("图片任务状态已同步");
});
