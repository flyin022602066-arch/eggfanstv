import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowVideoTaskInfo } from "../src/pages/projects/detail/workflow-video-task-info";
import type { GenerationTask } from "../src/services/api/task-center";

const createdAt = "2026-11-01T01:02:03Z";
const completedAt = "2026-11-01T01:04:05Z";

function renderTask(status: GenerationTask["status"], overrides: Partial<GenerationTask> = {}, showingHistory = false) {
    const task = { id: "local-video-task", providerRequestId: "upstream-video-task", createdAt, completedAt, status, ...overrides } as GenerationTask;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><App><WorkflowVideoTaskInfo projectId="project" taskId={task.id} task={task} showingHistory={showingHistory} /></App></QueryClientProvider>);
    client.clear();
    return html;
}

test("successful preview shows actual task IDs and separate submission/completion timestamps", () => {
    const html = renderTask("succeeded");
    for (const value of ["API Task ID", "upstream-video-task", "本地任务 ID", "local-video-task", "提交时间", "成功时间"]) expect(html).toContain(value);
    expect(html).toContain('dateTime="' + createdAt + '"');
    expect(html).toContain('dateTime="' + completedAt + '"');
});

test("queued and running tasks do not imply success from a stale completion field", () => {
    for (const status of ["queued", "running"] as const) {
        const html = renderTask(status);
        expect(html).toContain("提交时间");
        expect(html).not.toContain("成功时间");
        expect(html).not.toContain(completedAt);
    }
});

test("failed and cancelled task information is hidden", () => {
    for (const status of ["failed", "cancelled"] as const) {
        const html = renderTask(status);
        expect(html).not.toContain("workflow-video-task-info");
        expect(html).not.toContain("upstream-video-task");
        expect(html).not.toContain("提交时间");
        expect(html).not.toContain("成功时间");
    }
});

test("history uses the selected task and missing timestamps are never fabricated", () => {
    const html = renderTask("succeeded", { id: "history-task", providerRequestId: "history-api-id", createdAt: "invalid", completedAt: undefined }, true);
    expect(html).toContain("当前预览任务");
    expect(html).toContain("history-api-id");
    expect(html).not.toContain("提交时间");
    expect(html).not.toContain("成功时间");
    expect(html).not.toContain("Invalid Date");
});
