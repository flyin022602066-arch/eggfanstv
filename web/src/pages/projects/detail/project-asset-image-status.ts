import type { GenerationTask } from "@/services/api/task-center";

export function latestAssetImageTasks(tasks: readonly GenerationTask[], projectId: string) {
    const latest = new Map<string, GenerationTask>();
    for (const task of tasks) {
        if (task.projectId !== projectId || task.type !== "canvas_image" || !/^(project-asset-image|character-turnaround):/.test(task.clientContext?.nodeId || "")) continue;
        const key = `${task.clientContext!.nodeId}:${task.clientContext?.characterVersionId || ""}`;
        const previous = latest.get(key);
        if (!previous || task.createdAt > previous.createdAt || task.createdAt === previous.createdAt && task.id > previous.id) latest.set(key, task);
    }
    return [...latest.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function assetImageTaskStatus(task: GenerationTask) {
    if (task.status === "queued") return { label: "等待开始", description: "任务已保存在本地队列，尚未开始调用上游。", active: true };
    if (task.status === "running") {
        if (/入库|保存|绑定/.test(task.stage || "")) return { label: "正在保存图片", description: task.stage!, active: true };
        if (/取回|接收|下载/.test(task.stage || "")) return { label: "正在取回图片", description: task.stage!, active: true };
        return { label: "等待上游结果", description: task.stage || "后台正在处理原任务；无需保持本页面打开。", active: true };
    }
    if (task.status === "cancelled") return { label: "本地任务已停止", description: "本地停止不代表上游已取消。", active: false };
    if (task.status === "succeeded") {
        if (task.resultState === "FAILED_RETRYABLE" || task.resultState === "FAILED_PERMANENT") return { label: "图片已生成，入库失败", description: "可检查并取回已保存的原结果，不会重新生成。", active: false };
        if (task.resultState && task.resultState !== "READY") return { label: "图片已生成，正在入库", description: "后台正在保存素材并同步资产；可以手动检查取回。", active: true };
        return { label: "图片已取回入库", description: "生成任务已完成，可检查图片与原资产的绑定。", active: false };
    }
    if (task.stage === "submission_unknown" || task.errorCode === "submission_uncertain") return { label: "响应中断，结果未确认", description: "本地没有收到完整图片。仅检查原结果，不会自动重新生成或重复扣费；同步接口没有任务回执时无法向上游补查。", active: false };
    if (task.failureDiagnostics?.source === "local_result" && /completed|succeeded|完成/.test(task.failureDiagnostics.executionResult || "")) return { label: "图片已生成，本地保存失败", description: task.error || "可检查本地是否保留完整原结果。", active: false };
    return { label: "图片任务失败", description: task.error || task.stage || "请展开失败日志核对上游或本地原因。", active: false };
}

export function assetImageCheckStatus(input: { fetching: boolean; updatedAt: number; error?: string }) {
    if (input.error) return { label: "状态检测中断", description: `${input.error}；当前显示的是上次记录，不能据此判断上游失败。` };
    if (input.fetching) return { label: "正在检测图片任务", description: "正在读取本地后台的原任务状态，不会重新提交生成。" };
    return { label: "图片任务状态已同步", description: input.updatedAt ? `最近检测：${new Date(input.updatedAt).toLocaleTimeString()}。状态来自本地后台，后台按原任务规则继续处理。` : "等待首次检测。" };
}
