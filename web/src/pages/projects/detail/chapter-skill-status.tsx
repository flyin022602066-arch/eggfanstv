import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { StatusBadge } from "@/components/ui/base/badges";
import { listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { SkillLoadReport } from "@/services/skill-runtime";
import { chapterStoryboardFromGenerationTask } from "./project-chapter-ai";

export type ChapterSkillAttempt = {
    report: SkillLoadReport[] | null;
    task?: GenerationTask;
    preparing?: boolean;
    blocked?: boolean;
    submissionFailed?: boolean;
};

export function chapterSkillReportFromTask(task: GenerationTask): SkillLoadReport[] | null {
    try {
        const report: unknown = JSON.parse(task.inputJson || "{}").metadata?.skillLoadReport;
        if (!Array.isArray(report)) return null;
        const valid = report.every((item) => item && typeof item === "object"
            && typeof item.skillId === "string" && item.skillId.trim()
            && typeof item.skillName === "string" && typeof item.version === "string"
            && ["loaded", "failed", "skipped"].includes(item.status)
            && Array.isArray(item.files) && item.files.every((file: unknown) => typeof file === "string")
            && (item.truncated === undefined || typeof item.truncated === "boolean")
            && (item.reason === undefined || Object.hasOwn(failureReasons, item.reason)));
        return valid ? report : null;
    } catch { return null; }
}

export function latestChapterStoryboardTask(tasks: GenerationTask[], chapterId: string) {
    return tasks.filter((task) => {
        if (task.clientContext?.chapterId === chapterId && task.clientContext.chapterOperation === "storyboard") return true;
        try {
            const metadata = JSON.parse(task.inputJson || "{}").metadata;
            return metadata?.chapterId === chapterId && metadata.source === "short-drama-chapter-storyboard";
        } catch { return false; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

const failureReasons: Record<NonNullable<SkillLoadReport["reason"]>, string> = {
    unavailable: "技能未加入、已停用或不存在，请检查技能库并重新选择。",
    selection_limit: "超过本轮技能数量上限，请减少选择后重试。",
    file_read_failed: "文件读取失败，请检查技能包及本地服务后重试。",
    empty_entry: "技能入口为空或不是可用文本，请修复技能包。",
};

export function ChapterSkillStatusReport({ report, task, preparing, blocked, submissionFailed, loading, loadError, onRetry }: {
    report: SkillLoadReport[] | null;
    task?: GenerationTask;
    preparing?: boolean;
    blocked?: boolean;
    submissionFailed?: boolean;
    loading?: boolean;
    loadError?: boolean;
    onRetry?: () => void;
}) {
    const loaded = report?.filter((item) => item.status === "loaded").length || 0;
    const failed = report?.filter((item) => item.status === "failed").length || 0;
    const skipped = report?.filter((item) => item.status === "skipped").length || 0;
    const truncated = report?.some((item) => item.truncated);
    let promptReview: string[] = [];
    if (task?.status === "succeeded" && task.resultJson) {
        try { promptReview = chapterStoryboardFromGenerationTask(task).promptReview; }
        catch { promptReview = ["结果未能解析为完整分镜，请核对任务原始输出。"]; }
    }
    const state = preparing ? "本次拆解准备中" : blocked ? "技能准备失败 · 未提交模型" : submissionFailed ? report === null ? "任务准备失败 · 技能未读取" : "请求提交失败" : task ? ({ queued: "拆解排队中", running: "拆解中", succeeded: promptReview.length ? "脚本待修订" : "拆解完成", failed: "拆解失败", cancelled: "拆解已取消" }[task.status]) : report === null ? "无可核对的调用记录" : "技能准备完成 · 等待提交";
    return (
        <section aria-label="拆解技能调用状态" className="chapter-skill-status min-w-0 rounded-lg border border-border/70 bg-background text-xs">
            <details className="group" key={task?.id || "preparing"}>
                <summary className="cursor-pointer list-none rounded-lg px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/60 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-start gap-2">
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground/85">技能调用</span>
                        <span className={`mt-1 block break-words ${loadError || blocked || submissionFailed || failed ? "text-status-error" : "text-foreground/55"}`}>{loading ? "正在读取调用记录" : loadError ? "调用记录读取失败" : state}</span>
                        {report && !loading && !preparing && !loadError ? <span className="mt-1 block text-foreground/55">已加载 {loaded} 项{failed ? ` · 失败 ${failed} 项` : ""}{skipped ? ` · 跳过 ${skipped} 项` : ""}{truncated ? " · 上下文有截断" : ""}</span> : null}
                        {promptReview.length && !loading && !preparing && !loadError ? <span className="mt-1 block text-status-warning">{promptReview.length} 段脚本需核对，展开查看镜数与导演稿问题</span> : null}
                    </span>
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-foreground/50 group-open:rotate-180" />
                    </span>
                </summary>
                <div className="border-t border-border/50 px-3 pb-2.5">
            {preparing ? <p className="mt-2 text-foreground/55" role="status">正在准备本次章节与技能上下文…</p> : loading ? <p className="mt-2 text-foreground/55" role="status">正在读取本次任务的技能明细…</p> : loadError ? <p className="mt-2 text-status-error" role="alert">暂时无法读取记录。<button type="button" className="ml-2 underline focus-visible:outline" onClick={onRetry}>重新读取</button></p> : blocked && report === null ? <p className="mt-2 text-foreground/55">技能调用尚未开始。</p> : submissionFailed && report === null ? <p className="mt-2 text-foreground/55">本次任务在读取技能之前失败，无法确认技能调用结果。</p> : report === null ? <p className="mt-2 text-foreground/55">此任务未记录技能调用明细，无法确认各项技能是否成功。</p> : !report.length ? <p className="mt-2 text-foreground/55">本次未选择技能，按内置拆解规则生成。</p> : <>
                <p className="mt-2 text-foreground/65">加载成功 {loaded} 项 · 失败 {failed} 项 · 跳过 {skipped} 项</p>
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto thin-scrollbar">
                    {report.map((item) => <li key={item.skillId} className="rounded border border-border/50 px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="break-words font-medium">{item.skillName}</span>
                            {item.version ? <span className="text-foreground/45">v{item.version}</span> : null}
                            <StatusBadge size="sm" tone={item.status === "loaded" ? "success" : item.status === "failed" ? "error" : "warning"} label={item.status === "loaded" ? task ? "已加入拆解请求" : "加载成功" : item.status === "failed" ? "加载失败" : "已跳过"} />
                            {item.truncated ? <StatusBadge size="sm" tone="warning" label="上下文已截断" /> : null}
                        </div>
                        {item.files.length ? <p className="mt-1 break-all text-foreground/50">读取文件：{item.files.join("、")}</p> : null}
                        {item.reason ? <p className="mt-1 text-status-error">{failureReasons[item.reason]}</p> : null}
                        {item.truncated ? <p className="mt-1 text-status-warning">受上下文预算限制，未完整发送全部内容。</p> : null}
                    </li>)}
                </ul>
                <p className="mt-2 leading-5 text-foreground/50">技能以参考文本加入请求；加载成功不代表模型已逐条执行，仍需核对镜头脚本。</p>
            </>}
            {promptReview.length ? <div className="mt-2 text-status-warning" role="status"><p>脚本待修订 · 文本检查发现以下问题：</p><ul className="mt-1 list-disc space-y-1 pl-4">{promptReview.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p className="mt-1 text-foreground/50">此检查只核对脚本文本；结果已保留，不会自动重写或发起生成。</p></div> : null}
            {task ? <p className="mt-2 break-all text-foreground/45">任务 {task.id}{task.model ? " · " + task.model : ""}{task.createdAt ? " · " + new Date(task.createdAt).toLocaleString("zh-CN") : ""}</p> : null}
            {task?.error ? <p className="mt-2 break-words text-status-error">{task.error}</p> : null}
                </div>
            </details>
        </section>
    );
}

export function ChapterSkillStatus({ projectId, chapterId, attempt, hasStoryboard }: { projectId: string; chapterId: string; attempt?: ChapterSkillAttempt; hasStoryboard?: boolean }) {
    const tasks = useQuery({
        queryKey: ["project-chapter-generation-tasks", projectId],
        queryFn: ({ signal }) => listGenerationTasks(100, { projectId }, undefined, signal),
        refetchOnWindowFocus: true,
        refetchInterval: (query) => query.state.data?.some((task) => task.status === "queued" || task.status === "running") ? 2_000 : false,
    });
    const latest = latestChapterStoryboardTask(tasks.data || [], chapterId);
    const localTask = attempt?.task;
    const selectedTask = localTask && (!latest || localTask.createdAt.localeCompare(latest.createdAt) > 0 || localTask.id === latest.id) ? localTask : latest;
    const saved = useQuery({
        queryKey: ["chapter-skill-task", projectId, selectedTask?.id],
        enabled: Boolean(selectedTask),
        queryFn: ({ signal }) => queryGenerationTask(selectedTask!.id, { signal }),
        refetchInterval: (query) => query.state.data?.status === "queued" || query.state.data?.status === "running" ? 2_000 : false,
    });
    if (attempt && !attempt.task) return <ChapterSkillStatusReport {...attempt} />;
    if (!selectedTask && !hasStoryboard && !tasks.isError) return null;
    const task = saved.data && (!selectedTask || saved.data.updatedAt.localeCompare(selectedTask.updatedAt) >= 0) ? saved.data : selectedTask;
    const currentAttempt = localTask?.id === task?.id ? attempt : undefined;
    const report = currentAttempt?.report ?? (saved.data ? chapterSkillReportFromTask(saved.data) : null);
    return <ChapterSkillStatusReport report={report} task={task} loading={!currentAttempt && (tasks.isPending || Boolean(selectedTask && saved.isPending))} loadError={tasks.isError || saved.isError} onRetry={() => { void tasks.refetch(); if (selectedTask) void saved.refetch(); }} />;
}
