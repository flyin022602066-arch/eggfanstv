import { useRef, useState } from "react";
import { Button } from "antd";
import { RefreshCw } from "lucide-react";
import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { explainGenerationError } from "@/lib/generation-error";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import type { ProjectAsset } from "@/services/api/projects";
import { recoverImageTaskResult, type GenerationTask } from "@/services/api/task-center";
import { assetImageCheckStatus, assetImageTaskStatus, latestAssetImageTasks } from "./project-asset-image-status";

export function ProjectAssetImageTasks({ projectId, tasks, assets, fetching, updatedAt, error, onRefresh, onRecovered }: { projectId: string; tasks: GenerationTask[]; assets: ProjectAsset[]; fetching: boolean; updatedAt: number; error?: string; onRefresh: () => Promise<unknown>; onRecovered: () => Promise<unknown> }) {
    const [messages, setMessages] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string[]>([]);
    const inFlight = useRef(new Set<string>());
    const visibleTasks = latestAssetImageTasks(tasks, projectId);
    const check = assetImageCheckStatus({ fetching, updatedAt, error });
    const active = visibleTasks.filter(task => assetImageTaskStatus(task).active).length;
    const failed = visibleTasks.filter(task => task.status === "failed" || task.resultState?.startsWith("FAILED_")).length;
    const recover = async (task: GenerationTask) => {
        if (inFlight.current.has(task.id)) return;
        inFlight.current.add(task.id);
        setBusy([...inFlight.current]);
        const scope = captureUserScope();
        try {
            const result = await recoverImageTaskResult(task.id, scope);
            if (!userScopeMatches(scope)) return;
            setMessages(current => ({ ...current, [task.id]: result.message }));
            await onRecovered();
        } catch (cause) {
            if (userScopeMatches(scope)) setMessages(current => ({ ...current, [task.id]: `检查取回未完成：${cause instanceof Error ? cause.message : "连接异常，请稍后重试"}` }));
        } finally {
            inFlight.current.delete(task.id);
            setBusy([...inFlight.current]);
        }
    };
    return <section className="mb-4 min-w-0 rounded-lg border border-foreground/10 p-3 text-foreground" aria-label="资产图片检测与取回">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="status" aria-live="polite" className="min-w-0 text-xs"><strong>{check.label}</strong><span className="ml-2 text-foreground/60">{active} 项处理中 · {failed} 项异常</span></div>
            <Button size="small" loading={fetching} icon={<RefreshCw className="size-3.5" />} onClick={() => void onRefresh()}>刷新任务状态</Button>
        </div>
        <p className="mt-1 break-words text-xs text-foreground/55">{check.description}</p>
        <details className="mt-2">
            <summary className="cursor-pointer text-xs">图片任务明细与手动取回（最近 100 条中的各资产 / 造型最新任务）</summary>
            <p className="my-2 text-xs text-foreground/55">进入页面及返回窗口会自动检测，有任务时持续刷新。仅恢复已取得的原结果；同步接口断流且没有完整结果时无法补查，不会自动重新生成。</p>
            <div className="max-h-96 space-y-2 overflow-y-auto">{visibleTasks.length ? visibleTasks.map(task => {
                const assetId = task.clientContext!.nodeId!.replace(/^(project-asset-image|character-turnaround):/, "");
                const asset = assets.find(item => item.id === assetId);
                const status = assetImageTaskStatus(task);
                return <article key={task.id} className="min-w-0 rounded border border-foreground/10 p-2" aria-label={`图片任务：${asset?.title || assetId}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-all text-xs">{asset?.title || `资产 ${assetId}`} {task.clientContext?.characterVersionId ? `· 造型 ${task.clientContext.characterVersionId.slice(0, 8)}` : ""}</strong>
                        <Button size="small" loading={busy.includes(task.id)} onClick={() => void recover(task)}>{status.active ? "检查原任务" : "检查并取回"}</Button></div>
                    <p className="mt-1 break-words text-xs"><strong>{busy.includes(task.id) ? "正在检查并取回原图片结果" : status.label}</strong></p>
                    <p className="mt-1 break-words text-xs text-foreground/60">{status.description}</p>
                    <p className="mt-1 break-all text-xs text-foreground/45">任务 {task.id} · 更新 {new Date(task.updatedAt).toLocaleString()}</p>
                    {messages[task.id] ? <p role="status" className="mt-2 break-words text-xs">{messages[task.id]}</p> : null}
                    {task.status === "failed" ? <GenerationFailureNotice compact explanation={explainGenerationError({ code: task.errorCode, message: task.error }, { taskId: task.id, stage: task.stage })} context={{ taskId: task.id, model: task.model, stage: task.stage, createdAt: task.createdAt, updatedAt: task.updatedAt, failureDiagnostics: task.failureDiagnostics }} /> : null}
                </article>;
            }) : <p className="text-xs text-foreground/55">{fetching ? "正在读取任务记录…" : "本次检测范围内没有项目资产图片任务。"}</p>}</div>
        </details>
    </section>;
}
