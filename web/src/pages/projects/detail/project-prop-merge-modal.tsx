import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select, Spin } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { assertUserScope, captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { getProjectCore, listProjectAssets, mergeProjectProp, type ProjectAsset } from "@/services/api/projects";

export function ProjectPropMergeModal({ projectId, source, onClose, onSaved }: { projectId: string; source: ProjectAsset; onClose: () => void; onSaved: (mergedShots: number) => void }) {
    const queryClient = useQueryClient();
    const [scope] = useState(captureUserScope);
    const [targetId, setTargetId] = useState<string>();
    const [error, setError] = useState("");
    const optionsQuery = useQuery({
        queryKey: ["project", projectId, "assets", "prop-merge-options", scope],
        queryFn: async () => {
            assertUserScope(scope);
            const [result, core] = await Promise.all([listProjectAssets(projectId), getProjectCore(projectId, scope)]);
            assertUserScope(scope);
            return { revision: core.project.revision, assets: result.assets.filter((asset) => asset.category === "prop" && asset.id !== source.id && asset.primaryVersionId) };
        },
        staleTime: 0,
    });
    const targets = optionsQuery.data?.assets || [];
    const target = targets.find((asset) => asset.id === targetId);
    const merge = useMutation({
        mutationFn: async () => {
            assertUserScope(scope);
            if (!target || !optionsQuery.data) throw new Error("请选择保留的道具");
            return mergeProjectProp(projectId, source.id, { targetAssetId: target.id, expectedRevision: optionsQuery.data.revision }, scope);
        },
        onSuccess: (result) => {
            if (!userScopeMatches(scope)) return;
            void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
            onSaved(result.mergedShots);
            onClose();
        },
        onError: (cause) => {
            if (!userScopeMatches(scope)) return;
            setError(cause instanceof Error ? cause.message : "道具合并失败，请重试");
            void optionsQuery.refetch();
        },
    });
    return <AppModal open title="合并道具资产" width={660} onCancel={() => !merge.isPending && onClose()} closable={!merge.isPending} maskClosable={!merge.isPending} keyboard={!merge.isPending} footer={<div className="flex justify-end gap-2"><Button disabled={merge.isPending} onClick={onClose}>取消</Button><Button type="primary" disabled={!target || merge.isPending || optionsQuery.isFetching || optionsQuery.isError} loading={merge.isPending} onClick={() => { setError(""); merge.mutate(); }}>确认合并</Button></div>}>
        <p className="mb-4 text-sm text-foreground/65">将「{source.title}」合并到你选定的道具，章节、镜头绑定和当前提示词引用同步归并。保留目标的图片与设定，原图片仍保存在素材库和历史中。</p>
        <label className="mb-2 block text-xs font-medium" htmlFor="prop-merge-target">保留的道具</label>
        <Select id="prop-merge-target" aria-label="保留的道具" className="w-full" showSearch optionFilterProp="label" placeholder="搜索整个项目的道具名称或 ID" loading={optionsQuery.isPending} disabled={merge.isPending || optionsQuery.isError} value={targetId} onChange={(id) => { setTargetId(id); setError(""); }} options={targets.map((asset) => ({ value: asset.id, label: `${asset.title} · ID ${asset.id}` }))} notFoundContent={optionsQuery.isPending ? <Spin size="small" /> : "当前项目没有其他可合并的道具"} />
        {optionsQuery.isError ? <Alert className="mt-3" type="error" showIcon title="道具列表加载失败" description={<div className="flex flex-wrap items-center gap-2"><span>{optionsQuery.error.message}</span><Button size="small" onClick={() => void optionsQuery.refetch()}>重新加载</Button></div>} /> : null}
        <div className="mt-4 grid grid-cols-2 gap-3">
            <PropPreview asset={source} label="合并的道具预览" caption="待归并" />
            <PropPreview asset={target} label="保留的道具预览" caption="保留图片与设定" />
        </div>
        <p className="mt-3 text-xs text-foreground/50">只影响当前项目。已手动移出的镜头道具保持移出；已有成片保留为历史，后续可按新绑定重新生成。</p>
        {error ? <Alert className="mt-3" type="error" showIcon title={error} /> : null}
    </AppModal>;
}

function PropPreview({ asset, label, caption }: { asset?: ProjectAsset; label: string; caption: string }) {
    return <section aria-label={label} className="min-w-0 overflow-hidden rounded-lg border border-foreground/10 bg-foreground/[.03]">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-foreground/[.04] text-xs text-foreground/45">{asset?.storageKey && asset.mediaType === "image" ? <CachedResourceImage storageKey={asset.storageKey} alt={asset.title} className="h-full w-full object-contain" fallback={<span>图片暂不可用，仍可合并设定</span>} /> : asset ? "尚未生成图片" : "选择保留的道具"}</div>
        <div className="space-y-1 p-3"><p className="text-xs text-foreground/50">{caption}</p><p className="break-words text-sm font-medium">{asset?.title || "未选择"}</p>{asset ? <p className="break-all text-[var(--fs-tiny)] text-foreground/45">ID {asset.id}</p> : null}</div>
    </section>;
}
