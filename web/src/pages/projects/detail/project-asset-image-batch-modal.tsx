import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Progress, Switch } from "antd";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { projectAssetImageCategoryLabels, type ProjectAssetImageCategory } from "@/lib/project-asset-image-preferences";
import type { Project } from "@/services/api/projects";
import { configuredModelMatchesCapability, modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { planProjectAssetImageBatch, projectAssetImageConfig, projectAssetImagePrompt, resolveProjectAssetImagePreset } from "./project-asset-image";
import { loadProjectAssetImageBatch, submitProjectAssetImage, submitProjectAssetImageBatch } from "./project-asset-image-generation";

export function ProjectAssetImageBatchModal({ project, category, unitId = "", scopeLabel = "全部集数", onClose, onSettings, onTasksChanged }: { project: Project; category: ProjectAssetImageCategory; unitId?: string; scopeLabel?: string; onClose: () => void; onSettings: () => void; onTasksChanged: () => Promise<unknown> }) {
    const config = useEffectiveConfig();
    const preset = resolveProjectAssetImagePreset(config, project, category);
    const label = projectAssetImageCategoryLabels[category];
    const [missingOnly, setMissingOnly] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [completed, setCompleted] = useState(0);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState("");
    const [result, setResult] = useState<Awaited<ReturnType<typeof submitProjectAssetImageBatch>> | null>(null);
    const query = useQuery({ queryKey: ["project", project.id, "asset-image-batch", category, unitId], queryFn: () => loadProjectAssetImageBatch(project.id, unitId), staleTime: 0 });
    const plan = query.data ? planProjectAssetImageBatch(query.data.assets, category, query.data.activeIds, missingOnly) : null;
    const available = configuredModelMatchesCapability(config, preset.model, "image") && useConfigStore.getState().isAiConfigReady(config, preset.model);
    const start = async () => {
        if (submittingRef.current || !plan || result) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError("");
        try {
            const generationConfig = projectAssetImageConfig(config, preset);
            if (!useConfigStore.getState().isAiConfigReady(generationConfig, generationConfig.model)) throw new Error("请先配置此类别图片模型的 Key");
            const requestedIds = new Set(plan.assets.map((asset) => asset.id));
            const latest = await loadProjectAssetImageBatch(project.id, unitId);
            const pending = planProjectAssetImageBatch(latest.assets, category, latest.activeIds, missingOnly).assets.filter((asset) => requestedIds.has(asset.id));
            setTotal(pending.length);
            setCompleted(0);
            const next = await submitProjectAssetImageBatch(pending, (asset) => submitProjectAssetImage(project, { asset, config: generationConfig, prompt: [projectAssetImagePrompt(asset), preset.extraPrompt.trim()].filter(Boolean).join("\n\n") }), setCompleted);
            setResult(next);
            await onTasksChanged();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "批量生图准备失败"); }
        finally { setSubmitting(false); submittingRef.current = false; }
    };
    return <AppModal open title={`一键批量生成${label}图`} width={680} onCancel={() => !submittingRef.current && onClose()} footer={<div className="flex justify-end gap-2"><Button disabled={submitting} onClick={onClose}>{result ? "关闭" : "取消"}</Button>{!result ? <Button type="primary" loading={submitting} disabled={!plan?.assets.length || !available || query.isFetching} onClick={() => void start()}>提交 {plan?.assets.length || 0} 个生图任务</Button> : null}</div>}>
        <p className="mb-4 text-xs text-foreground/55">范围：{scopeLabel}的已确认{label}，包含该范围所有目录和分页，不受搜索关键词影响。每个资产分别提交后台任务，完成后自动绑定新版本。</p>
        {category === "character" ? <p className="mb-4 text-xs text-foreground/55">已绑定主角人脸预设的角色会自动使用对应参考图设计服装和造型；其他角色按原设定生成。可在资产页“主角人脸预设”中设置。</p> : null}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-active p-3 text-xs"><span>模型：{preset.model ? modelDisplayName(config, preset.model) : "未选择"} · 尺寸：{preset.size} · 画质：{preset.quality.toUpperCase()}</span><Button size="small" disabled={submitting} onClick={onSettings}>修改本类参数</Button></div>
        {!available ? <Alert className="mb-4" type="warning" showIcon title="请先在统一生图设置中选择可用图片模型，并配置渠道 Key" /> : null}
        <label className="mb-4 flex items-center gap-3 text-sm"><Switch aria-label="仅生成缺图资产" checked={missingOnly} disabled={submitting || Boolean(result)} onChange={setMissingOnly} />仅生成缺图资产</label>
        {!missingOnly ? <Alert className="mb-4" type="warning" showIcon title="将重新生成已有图片，产生新的模型调用；旧图片版本会保留" /> : null}
        {query.isPending ? <p role="status">正在读取全部资产及生成任务…</p> : query.isError ? <Alert type="error" title="无法读取批量生图清单" description={query.error.message} action={<Button onClick={() => void query.refetch()}>重新读取</Button>} /> : <p className="mb-4 text-sm" role="status">待提交 {plan?.assets.length || 0} 个 · 正在生成跳过 {plan?.activeCount || 0} 个{missingOnly ? ` · 已有图片跳过 ${plan?.existingCount || 0} 个` : ""}</p>}
        {submitting ? <div aria-live="polite"><p className="text-xs">正在提交 {completed} / {total}，请等待本批任务入队。图片将在后台继续生成。</p><Progress percent={total ? Math.round(completed / total * 100) : 0} /></div> : null}
        {error ? <Alert className="mb-3" type="error" showIcon title="批量提交未完成" description={error} /> : null}
        {result ? <div aria-live="polite"><Alert type={result.failures.length ? "warning" : "success"} showIcon title={`已提交 ${result.submittedIds.length} 个，提交失败 ${result.failures.length} 个`} description={result.submittedIds.length ? "已提交任务会继续生成，离开页面不会取消。请勿重复提交已入队资产。" : "没有新增生成任务。"} />{result.failures.length ? <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs">{result.failures.map((failure) => <li key={failure.asset.id}><strong>{failure.asset.title}</strong>：{failure.message}</li>)}</ul> : null}</div> : null}
    </AppModal>;
}
