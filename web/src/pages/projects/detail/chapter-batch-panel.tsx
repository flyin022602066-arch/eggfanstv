import { useEffect, useState } from "react";
import { App, Button, InputNumber, Segmented } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { createChapterBatch, chapterBatchRange, type ChapterBatch, type ChapterBatchMode, type ChapterBatchRow, type ChapterBatchStep } from "@/lib/chapter-batch";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import type { ProjectUnit } from "@/services/api/projects";
import { chapterBatchIsActive, loadChapterBatch, startChapterBatch, stopChapterBatch, type ChapterBatchSettings } from "./project-chapter-batch";

const statusText: Record<ChapterBatchStep, string> = { pending: "等待", running: "执行中", completed: "完成", skipped: "跳过", failed: "失败" };
function assetStatus(row: ChapterBatchRow) {
    return row.assets === "running" ? ({ extract: "提取中", review: "复核补漏中", confirm: "确认入库中" }[row.phase || "extract"]) : statusText[row.assets];
}
export function ChapterBatchPanel({ projectId, units, disabled, prepare, onProgress, onBusy }: {
    projectId: string; units: ProjectUnit[]; disabled: boolean;
    prepare: () => ChapterBatchSettings;
    onProgress: () => void; onBusy: (busy: boolean) => void;
}) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false), [start, setStart] = useState<number | null>(1), [end, setEnd] = useState<number | null>(Math.min(10, units.length));
    const [mode, setMode] = useState<ChapterBatchMode>("linked");
    const [batch, setBatch] = useState<ChapterBatch | null>(null), [starting, setStarting] = useState(false), [stopping, setStopping] = useState(false), [storageError, setStorageError] = useState("");
    const [replaceOpen, setReplaceOpen] = useState(false);
    const scope = captureUserScope();
    const active = batch?.status === "running";
    useEffect(() => {
        let disposed = false, loading = false, previous = "";
        const expected = captureUserScope();
        setBatch(null);
        const read = async () => {
            if (loading || !userScopeMatches(expected)) return;
            loading = true;
            try {
                const value = await loadChapterBatch(projectId, expected);
                if (disposed) return;
                setBatch(value); setStorageError("");
                const signature = JSON.stringify(value?.rows.map((row) => [row.assets, row.storyboard]));
                if (previous && previous !== signature) onProgress();
                previous = signature;
            } catch (error) { if (!disposed) setStorageError(error instanceof Error ? error.message : "区间任务记录读取失败"); }
            finally { loading = false; }
        };
        void read(); const timer = window.setInterval(() => void read(), 1000);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [projectId, scope.userScope, scope.epoch]);
    useEffect(() => { onBusy(Boolean(active || starting)); }, [active, starting]);
    const launch = async (resume: boolean) => {
        if (starting || chapterBatchIsActive(projectId, scope)) return;
        try {
            if (disabled) throw new Error("请先保存正文并等待当前单集任务结束");
            const settings = prepare();
            const next = resume && batch ? batch : createChapterBatch(projectId, chapterBatchRange(units, start || 0, end || 0), mode);
            setStarting(true); setStopping(false); setStorageError("");
            const result = await startChapterBatch(next, scope, settings, (value) => { if (userScopeMatches(scope)) setBatch(value); }, (text) => { if (userScopeMatches(scope)) { message.success({ content: text, duration: 3 }); onProgress(); } });
            if (!userScopeMatches(scope)) return;
            setBatch(result); onProgress();
            if (result.status === "completed") message.success({ content: "所选区间处理完成，已保留当前页面", duration: 3 });
            else message.info({ content: "区间任务已暂停，已完成结果保留；可查看原因并继续", duration: 4 });
        } catch (error) { if (userScopeMatches(scope)) { const text = error instanceof Error ? error.message : "区间任务启动失败"; setStorageError(text); message.error(text); } }
        finally { setStarting(false); setStopping(false); }
    };
    const finished = batch?.rows.filter((row) => ["completed", "skipped"].includes(row.assets) && ["completed", "skipped"].includes(row.storyboard)).length || 0;
    return <div className="shrink-0 border-b border-border/60 px-2.5 py-2">
        <Button block size="small" disabled={!units.length} onClick={() => setOpen(true)}>{active ? "查看区间任务进度" : "区间批量提取 / 分镜"}</Button>
        {batch ? <p className="mt-1 text-xs text-foreground/55" role="status">区间任务{active ? "执行中" : batch.status === "completed" ? "已完成" : "已暂停"} · {finished}/{batch.rows.length} 集</p> : null}
        <AppModal flush open={open} title={<div className="px-5 pt-4">区间批量提取与分镜</div>} width={720} onCancel={() => setOpen(false)} footer={null}>
            <div className="max-h-[calc(100dvh-10rem)] space-y-4 overflow-y-auto p-5">
                <p className="text-sm leading-6 text-foreground/65">资产按集顺序提取，每集独立复核补漏一次，合并后按现有规则去重、确认入库，再处理下一集。联动模式会在本集资产入库后启动分镜，同时继续下一集资产；不生成图片或视频，不强制跳页。</p>
                <Segmented block disabled={Boolean(active || starting)} value={mode} onChange={(value) => setMode(value as ChapterBatchMode)} options={[{ label: "资产 + 分镜", value: "linked" }, { label: "仅提取资产", value: "assets" }, { label: "仅拆解分镜", value: "storyboards" }]} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label>起始集 <InputNumber aria-label="起始集" min={1} max={units.length} precision={0} value={start} disabled={Boolean(active || starting)} onChange={setStart} /></label>
                    <span>至</span><label>结束集 <InputNumber aria-label="结束集" min={1} max={units.length} precision={0} value={end} disabled={Boolean(active || starting)} onChange={setEnd} /></label>
                </div>
                <Callout tone="info" title="沿用当前项目规则">使用本项目当前选择的文本模型、画风、分镜技能及系统表现设置。集数按左侧章节顺序计算；本集未确认草稿按复核后的最新结果替换，已确认资产保留复用；已有分镜默认跳过，不自动覆盖。暂停后已提交任务会完成并保留结果，点击继续只处理未完成阶段。关闭窗口或切换页面不影响执行；重启软件后需手动继续。</Callout>
                {storageError ? <p role="alert" className="text-sm text-status-error">{storageError}</p> : null}
                <div className="flex flex-wrap gap-2">
                    <Button type="primary" disabled={disabled || Boolean(active || starting)} onClick={() => { if (batch && batch.status !== "completed") setReplaceOpen(true); else void launch(false); }}>开始所选区间</Button>
                    {batch && batch.status !== "completed" ? <Button disabled={disabled || Boolean(active || starting)} onClick={() => void launch(true)}>继续未完成任务</Button> : null}
                    {active ? <Button disabled={stopping} onClick={() => { stopChapterBatch(projectId, scope); setStopping(true); }}>{stopping ? "等待已提交任务结束…" : "暂停后续任务"}</Button> : null}
                </div>
                {batch ? <p className="text-xs text-foreground/65">当前任务：{batch.rows[0]?.title} → {batch.rows.at(-1)?.title} · {batch.mode === "linked" ? "资产 + 分镜" : batch.mode === "assets" ? "仅提取资产" : "仅拆解分镜"}</p> : null}
                {batch ? <div className="max-h-72 overflow-auto rounded-lg border border-border/70" role="region" aria-label="区间任务逐集进度">
                    <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_7rem_6rem] gap-2 border-b border-border/70 bg-background p-2 text-xs font-medium"><span>章节 · {finished}/{batch.rows.length}</span><span>资产</span><span>分镜</span></div>
                    {batch.rows.map((row) => <div key={row.id} className="border-b border-border/50 p-2 text-xs last:border-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] gap-2"><span className="truncate" title={row.title}>{row.title}</span><span>{assetStatus(row)}</span><span>{statusText[row.storyboard]}</span></div>
                        {row.assetError || row.storyboardError ? <p role="alert" className="mt-1 break-words text-status-error">{row.assetError ? "资产：" + row.assetError : ""}{row.storyboardError ? " 分镜：" + row.storyboardError : ""}</p> : null}
                    </div>)}
                </div> : null}
            </div>
        </AppModal>
        <AppModal open={replaceOpen} title="替换未完成的区间任务？" okText="重新开始所选区间" cancelText="保留并返回" onCancel={() => setReplaceOpen(false)} onOk={() => { setReplaceOpen(false); void launch(false); }}>
            <p>当前还有未完成的区间任务。重新开始会替换本地续跑记录，已入库资产和已保存分镜不会删除，但可能重新调用模型并产生费用。要复用已完成的提取结果，请返回并点击“继续未完成任务”。</p>
        </AppModal>
    </div>;
}
