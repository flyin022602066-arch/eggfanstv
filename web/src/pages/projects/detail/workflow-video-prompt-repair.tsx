import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input } from "antd";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";

type PromptRepairProps = { task?: GenerationTask; draft?: string; ready: boolean; onApply: (prompt: string) => void };
type PreflightRecord = { status: "changed" | "unchanged"; originalPrompt: string; replacements: Array<{ original: string; replacement: string; reason?: string }> };

function readPreflightRecord(task?: GenerationTask): PreflightRecord | undefined {
    try {
        const record = JSON.parse(task?.inputJson || "{}").metadata?.videoPromptPreflight;
        if ((record?.status === "changed" || record?.status === "unchanged") && typeof record.originalPrompt === "string" && Array.isArray(record.replacements) && record.replacements.every((edit: Record<string, unknown>) => edit && typeof edit.original === "string" && typeof edit.replacement === "string" && (edit.reason === undefined || typeof edit.reason === "string"))) return record;
    } catch {}
    return undefined;
}

function WorkflowVideoPromptPreflight({ task, draft, ready, onApply }: PromptRepairProps) {
    const status = task?.clientContext?.videoPromptPreflightStatus;
    const applied = useRef("");
    const result = useQuery({
        queryKey: ["workflow-video-prompt-preflight", task?.id, status],
        enabled: Boolean(task?.id && status),
        queryFn: ({ signal }) => queryGenerationTask(task!.id, { signal }),
        retry: false,
    });
    const actual = result.data;
    const record = readPreflightRecord(actual);
    useEffect(() => {
        if (!ready || !actual?.prompt || !record || record.status !== "changed" || applied.current === actual.id) return;
        applied.current = actual.id;
        if (draft === undefined || draft === record.originalPrompt) onApply(actual.prompt);
    }, [ready, actual, record, draft, onApply]);
    if (!status) return null;
    if (result.isError) return <Alert type="warning" showIcon title="提交前检查结果读取失败" description="原稿未覆盖，可重新读取实际提交稿。" action={<Button size="small" onClick={() => void result.refetch()}>重新读取</Button>} />;
    if (!actual) return <span role="status">正在读取提交前检查结果…</span>;
    if (!record) return <Alert type="warning" showIcon title="提交前检查记录不可用" description="原稿未覆盖，请查看任务详情中的实际提示词。" />;
    if (record.status === "unchanged") return <Alert type="success" showIcon title="提交前检查完成，无需修改，沿用原提示词" />;
    return <Alert type="info" showIcon title="提交前已自动合规检查并完成局部修改" description={<>
        <p>{draft === actual.prompt ? "当前编辑框已同步实际提交稿，资产绑定和生成参数不变。" : "保留你后来修改的手动稿；下方可核对本次实际修改和提交全文。"}</p>
        <details><summary>查看提交前局部修改</summary>{record.replacements.map((edit, index) => <p key={`${index}:${edit.original}`}><del>{edit.original}</del>{" → "}<ins>{edit.replacement || "（删除）"}</ins>{edit.reason ? ` · ${edit.reason}` : ""}</p>)}</details>
        <details><summary>查看本次实际提交全文</summary><Input.TextArea aria-label="提交前检查实际提交提示词" readOnly value={actual.prompt} autoSize={{ minRows: 3, maxRows: 8 }} /></details>
        {draft !== actual.prompt ? <Button size="small" onClick={() => onApply(actual.prompt)}>使用优化稿继续编辑</Button> : null}
    </>} />;
}

export function WorkflowVideoPromptRepair(props: PromptRepairProps) {
    return <><WorkflowVideoPromptPreflight {...props} /><WorkflowVideoPromptRepairAfterFailure {...props} /></>;
}

function WorkflowVideoPromptRepairAfterFailure({ task, draft, ready, onApply }: PromptRepairProps) {
    const parentId = task?.clientContext?.videoPromptRepairParentTaskId;
    const applied = useRef("");
    const result = useQuery({
        queryKey: ["workflow-video-prompt-repair", task?.id, parentId],
        enabled: Boolean(task?.id && parentId),
        queryFn: async ({ signal }) => {
            const [child, parent] = await Promise.all([queryGenerationTask(task!.id, { signal }), queryGenerationTask(parentId!, { signal })]);
            return { child, parent };
        },
        retry: false,
    });
    const child = result.data?.child;
    const canApply = draft === undefined || draft === result.data?.parent.prompt;
    useEffect(() => {
        if (!ready || !child?.prompt || applied.current === child.id) return;
        applied.current = child.id;
        if (canApply) onApply(child.prompt);
    }, [ready, child, canApply, onApply]);
    const failure = task?.failureDiagnostics?.summary?.match(/自动合规润色未提交：(.*)/u)?.[1];
    if (failure) return <Alert type="warning" showIcon title="自动优化未提交" description={failure} />;
    if (!parentId) return null;
    if (result.isError) return <Alert type="warning" showIcon title="自动优化结果读取失败" description="原稿未覆盖，请重试读取实际提交的提示词。" action={<Button size="small" onClick={() => void result.refetch()}>重新读取</Button>} />;
    if (!child) return <span role="status">正在读取自动优化后的实际提交提示词…</span>;
    return <Alert type="info" showIcon title="已自动合规优化并重新提交，资产绑定未改变" description={<>
        <p>{draft === child.prompt ? "当前编辑框已同步优化全文，后续提交使用这版提示词。" : "保留你后来修改的手动稿；下方是自动重提时实际使用的全文。"}</p>
        <details><summary>查看自动重提的实际提示词</summary><Input.TextArea aria-label="自动优化实际提交提示词" readOnly value={child.prompt} autoSize={{ minRows: 3, maxRows: 8 }} /></details>
        {draft !== child.prompt ? <Button size="small" onClick={() => onApply(child.prompt)}>使用优化稿继续编辑</Button> : null}
    </>} />;
}
