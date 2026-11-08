import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import copy from "copy-to-clipboard";
import { Copy } from "lucide-react";

import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";

type Props = {
    projectId: string;
    taskId?: string;
    task?: GenerationTask;
    showingHistory: boolean;
};

export function WorkflowVideoTaskInfo({ projectId, taskId, task, showingHistory }: Props) {
    const { message } = App.useApp();
    const taskQuery = useQuery({
        queryKey: ["project", projectId, "video-preview-task", taskId],
        queryFn: ({ signal }) => queryGenerationTask(taskId!, { signal }),
        enabled: Boolean(taskId) && task?.id !== taskId,
        refetchInterval: (query) => query.state.data && ["queued", "running"].includes(query.state.data.status) ? 5000 : false,
    });
    if (!taskId) return null;

    const currentTask = task?.id === taskId ? task : taskQuery.data;
    if (currentTask?.status === "failed" || currentTask?.status === "cancelled") return null;
    const providerRequestId = currentTask?.providerRequestId?.trim();
    const submittedAt = formatTaskTime(currentTask?.createdAt);
    const succeededAt = currentTask?.status === "succeeded" ? formatTaskTime(currentTask.completedAt) : "";
    const copyId = async (value: string) => {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
            else if (!copy(value)) throw new Error("copy failed");
            message.success("任务 ID 已复制");
        } catch {
            message.error("复制失败，请选中任务 ID 手动复制");
        }
    };

    return <section className="workflow-video-task-info" aria-label={showingHistory ? "当前预览的视频生成任务" : "最新提交的视频生成任务"}>
        <strong>{showingHistory ? "当前预览任务" : "最新提交任务"}</strong>
        <div className="workflow-video-task-id">
            <span>API Task ID</span>
            {providerRequestId ? <><code title={providerRequestId}>{providerRequestId}</code><Button type="text" size="small" icon={<Copy className="size-3.5" />} aria-label="复制 API Task ID" onClick={() => void copyId(providerRequestId)} /></> : <small role="status">{taskQuery.isError ? "任务信息读取失败，请刷新重试" : currentTask?.status === "queued" || currentTask?.status === "running" || taskQuery.isFetching ? "等待上游返回任务 ID" : "上游未返回任务 ID"}</small>}
        </div>
        <div className="workflow-video-task-id">
            <span>本地任务 ID</span><code title={taskId}>{taskId}</code><Button type="text" size="small" icon={<Copy className="size-3.5" />} aria-label="复制本地任务 ID" onClick={() => void copyId(taskId)} />
        </div>
        {submittedAt ? <div className="workflow-video-task-id"><span>提交时间</span><time dateTime={currentTask!.createdAt}>{submittedAt}</time></div> : null}
        {succeededAt ? <div className="workflow-video-task-id"><span>成功时间</span><time dateTime={currentTask!.completedAt}>{succeededAt}</time></div> : null}
    </section>;
}

function formatTaskTime(value?: string) {
    if (!value || !Number.isFinite(Date.parse(value))) return "";
    return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
