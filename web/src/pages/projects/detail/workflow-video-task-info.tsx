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
    const browserTask = currentTask?.model?.startsWith("doubao-browser::");
    const providerRequestId = currentTask?.providerRequestId?.trim();
    const submittedAt = formatTaskTime(currentTask?.createdAt);
    const succeededAt = currentTask?.status === "succeeded" ? formatTaskTime(currentTask.completedAt) : "";
    const queryProblem = browserTask && /查询失败|回执缺失|查询暂不可用/u.test(currentTask?.stage || "");
    const repairFailure = currentTask?.status === "failed" && currentTask.failureDiagnostics?.summary?.match(/自动合规润色未提交：(.*)/u)?.[1];
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
        {browserTask ? <div className="workflow-video-task-id"><span>生成渠道</span><span>豆包浏览器</span></div> : null}
        {browserTask && currentTask?.stage ? <div className="workflow-video-task-id" role="status"><span>当前阶段</span><span>{currentTask.stage}</span></div> : null}
        {queryProblem ? <div className="workflow-video-task-id" role="alert"><span>查询原因</span><span>{currentTask?.failureDiagnostics?.summary || currentTask?.error || "尚不能确认上游状态，未重新提交生成"}</span></div> : null}
        {repairFailure ? <div className="workflow-video-task-id" role="alert"><span>自动优化未提交</span><span>{repairFailure}</span></div> : null}
        {queryProblem && currentTask?.failureDiagnostics?.capturedAt ? <div className="workflow-video-task-id"><span>核查时间</span><time>{formatTaskTime(currentTask.failureDiagnostics.capturedAt)}</time></div> : null}
        <div className="workflow-video-task-id">
            <span>API Task ID</span>
            {providerRequestId ? <><code title={providerRequestId}>{providerRequestId}</code><Button type="text" size="small" icon={<Copy className="size-3.5" />} aria-label="复制 API Task ID" onClick={() => void copyId(providerRequestId)} /></> : <small role="status">{taskQuery.isError ? "任务信息读取失败，请刷新重试" : currentTask?.status === "queued" || currentTask?.status === "running" || taskQuery.isFetching ? "等待上游返回任务 ID" : "本地未记录上游任务 ID"}</small>}
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
