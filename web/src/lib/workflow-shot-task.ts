import type { GenerationTask } from "@/services/api/task-center";

export function mergeWorkflowTaskSnapshots(stored: GenerationTask[], incoming: GenerationTask[]) {
    const tasks = new Map(stored.map((task) => [task.id, task]));
    for (const task of incoming) {
        const current = tasks.get(task.id);
        const difference = (Date.parse(task.updatedAt) || 0) - (current ? Date.parse(current.updatedAt) || 0 : 0);
        const terminal = (value: GenerationTask) => value.status !== "queued" && value.status !== "running";
        if (!current || difference > 0 || (difference === 0 && terminal(task) && !terminal(current))) tasks.set(task.id, task);
    }
    return [...tasks.values()];
}

export function workflowBrowserTaskStage(task: Pick<GenerationTask, "status" | "model" | "stage">) {
    if (!task.model?.startsWith("doubao-browser::") || !["queued", "running"].includes(task.status)) return undefined;
    const stage = task.stage || "";
    if (/正在检查最终提示词/u.test(stage)) return "提示词检查中";
    if (/查询失败|查询暂不可用/u.test(stage)) return "查询异常";
    if (/合规润色/u.test(stage)) return "合规润色中";
    if (/下载|取回|正在保存/u.test(stage)) return "取回中";
    if (/中断|待确认|未同步|submission_unknown/u.test(stage)) return "待确认";
    if (/准备|等待.*环境/u.test(stage)) return "准备中";
    if (/上游正在生成|上游生成中/u.test(stage)) return "生成中";
    if (/已提交|查询上游|已保留浏览器回执/u.test(stage)) return "查询中";
    return task.status === "queued" ? "待提交" : "核对进度";
}

export function latestWorkflowShotTasks(tasks: GenerationTask[], artifactType: string) {
    const latest = new Map<string, GenerationTask>();
    const active = (task: GenerationTask) => task.status === "queued" || task.status === "running";
    for (const task of tasks) {
        const shotId = task.clientContext?.shotId;
        if (!shotId || task.clientContext?.artifactType !== artifactType) continue;
        const current = latest.get(shotId);
        const createdAt = Date.parse(task.createdAt) || 0;
        const currentCreatedAt = current ? Date.parse(current.createdAt) || 0 : 0;
        const newer = !current || createdAt > currentCreatedAt || (createdAt === currentCreatedAt && (Date.parse(task.updatedAt) || 0) > (Date.parse(current.updatedAt) || 0));
        if (!current || (artifactType !== "video" && active(task) !== active(current) ? active(task) : newer)) {
            latest.set(shotId, task);
        }
    }
    return latest;
}

export function canStopVideoTaskLocally(task: Pick<GenerationTask, "id" | "type" | "model" | "status" | "stage">) {
    const video = task.type === "canvas_video" || task.type.startsWith("canvas_video_") || task.type.startsWith("video_");
    const uncertain = task.model?.startsWith("doubao-browser::") && task.status === "failed" && ["submission_unknown", "原任务回执缺失", "原任务查询失败"].includes(task.stage || "");
    return !task.id.startsWith("local:") && video && (task.status === "queued" || task.status === "running" || uncertain);
}
