import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Select } from "antd";
import { LockKeyhole, UnlockKeyhole, UsersRound, X } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { characterReferenceImage, characterReferenceNeedsReview, characterSelectionShots, referenceAssetId } from "@/lib/character-look-selection";
import { captureUserScope } from "@/lib/user-scope-guard";
import { getCharacterReferenceCatalog, saveCharacterReferenceChoices, type CharacterReferenceChoice } from "@/services/api/project-character-references";
import { getProjectUnitWorkspace, listProjectAssets, type ProjectAsset, type ProjectDetail, type ShotAssetReference } from "@/services/api/projects";
import { resourceStorageKey } from "@/services/api/resources";
import { createAndBindProjectShotCharacter, identifyProjectCharacterReferences } from "@/services/project-character-references";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { ProjectCharacterLooksModal } from "./project-character-looks-modal";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import "./project-character-looks.css";

export function WorkflowCharacterReferences({ detail, projectId, unitId, shotId, dirty, disabled, onRefresh, onBusyChange, onUnlink }: { detail: ProjectDetail; projectId: string; unitId: string; shotId: string; dirty: boolean; disabled: boolean; onRefresh: () => Promise<void>; onBusyChange: (busy: boolean) => void; onUnlink?: (reference: ShotAssetReference) => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const config = useEffectiveConfig();
    const [progress, setProgress] = useState("");
    const [addingCharacter, setAddingCharacter] = useState(false);
    const [creatingCharacter, setCreatingCharacter] = useState(false);
    const [createForm] = Form.useForm<{ name: string; appearance: string }>();
    const [manageAsset, setManageAsset] = useState<ProjectAsset | null>(null);
    const [preview, setPreview] = useState<{ title: string; storageKey: string } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const query = useQuery({ queryKey: ["project", projectId, "character-reference-state", unitId], queryFn: async () => {
        const [workspace, { assets }, catalog] = await Promise.all([queryClient.fetchQuery({ queryKey: ["project", projectId, "unit-workspace", unitId], queryFn: ({ signal }) => getProjectUnitWorkspace(projectId, unitId, signal), staleTime: 30_000 }), listProjectAssets(projectId), getCharacterReferenceCatalog(projectId)]);
        return { workspace, assets, catalog, shots: characterSelectionShots(workspace, assets) };
    } });
    const signature = `${detail.shots.find((shot) => shot.id === shotId)?.currentRevisionId || ""}:${detail.shotReferences.filter((ref) => ref.shotId === shotId).map((ref) => `${ref.id}:${ref.assetVersionId}:${ref.selectionStatus}:${ref.selectionLocked}`).join(",")}`;
    useEffect(() => { void queryClient.invalidateQueries({ queryKey: ["project", projectId, "character-reference-state", unitId] }); }, [signature, projectId, unitId, queryClient]);
    useEffect(() => () => { controller.current?.abort(); }, []);
    useEffect(() => { setAddingCharacter(false); setCreatingCharacter(false); createForm.resetFields(); }, [shotId, createForm]);
    const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["project", projectId] }); await onRefresh(); };
    const identify = useMutation({ mutationFn: (mode: "shot" | "chapter" | "pending") => { controller.current = new AbortController(); return identifyProjectCharacterReferences({ projectId, unitId, shotId: mode === "shot" ? shotId : undefined, pendingOnly: mode === "pending", config, signal: controller.current.signal, onProgress: setProgress }); }, onSuccess: async (result) => { await refresh(); message[result.pending ? "warning" : "success"](`已确定 ${result.resolved} 项造型，${result.pending} 项待确认${result.skippedBusy ? `；跳过 ${result.skippedBusy} 个生成中镜头` : ""}`); }, onError: (error) => { if (error.name !== "AbortError") message.error(error.message); }, onSettled: () => { controller.current = null; setProgress(""); } });
    const manual = useMutation({ mutationFn: async (input: { assetId: string; versionId: string; locked: boolean; status?: "resolved" | "pending" }) => {
        if (dirty) throw new Error("请先保存脚本，再确认角色造型");
        const scope = captureUserScope();
        const [{ revision }, workspace] = await Promise.all([getCharacterReferenceCatalog(projectId, scope), getProjectUnitWorkspace(projectId, unitId)]);
        const shot = workspace.shots.find((item) => item.id === shotId);
        if (!shot?.currentRevisionId) throw new Error("镜头没有可用脚本版本，请先保存脚本");
        if (shot.currentRevisionId !== query.data?.shots.find((item) => item.shotId === shotId)?.revisionId || revision !== query.data?.catalog.revision) throw new Error("项目或镜头已变化，请刷新造型列表后重选");
        const choice: CharacterReferenceChoice = { shotId, assetId: input.assetId, versionId: input.versionId, status: input.status || "resolved", source: "manual", locked: input.locked, reason: input.locked ? input.status === "pending" ? "用户手动指定出镜角色并锁定，待补参考图" : "用户手动指定并锁定造型" : "用户解除造型锁定，允许重新识别", expectedShotRevisionId: shot.currentRevisionId };
        return saveCharacterReferenceChoices(projectId, unitId, { expectedRevision: revision, choices: [choice] }, scope);
    }, onSuccess: async () => { setAddingCharacter(false); await refresh(); }, onError: (error) => { message.error(error.message); void refresh(); } });
    const create = useMutation({ mutationFn: async (values: { name: string; appearance: string }) => {
        if (dirty || disabled) throw new Error("请先保存脚本，再新增出镜角色");
        return createAndBindProjectShotCharacter({ projectId, unitId, shotId, expectedShotRevisionId: query.data?.shots.find((item) => item.shotId === shotId)?.revisionId || "", name: values.name, appearance: values.appearance || "" });
    }, onSuccess: async (result) => {
        setCreatingCharacter(false); createForm.resetFields(); await refresh();
        if (result.bindingError) { setAddingCharacter(true); message.warning(result.bindingError, 8); }
        else message.success("已新增并绑定本镜，可在角色卡片中补参考图");
    }, onError: (error) => { message.error(error.message); } });
    const busy = identify.isPending || manual.isPending || create.isPending;
    useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
    const shot = query.data?.shots.find((item) => item.shotId === shotId);
    const currentShot = query.data?.workspace.shots.find((item) => item.id === shotId);
    const currentRevision = query.data?.workspace.shotRevisions.find((item) => item.id === currentShot?.currentRevisionId);
    const closeUp = /特写|近景|close/iu.test(currentRevision?.shotSize || "");
    const unboundVersions = query.data?.catalog.versions.filter((version) => !shot?.references.some((reference) => referenceAssetId(reference) === version.assetId)) || [];
    return <section className="workflow-character-references" aria-label="角色造型参考">
        <div className="workflow-character-reference-toolbar"><span className="inline-flex items-center gap-1 text-xs"><UsersRound className="size-3.5" />角色造型</span><div className="flex flex-wrap gap-1"><Button size="small" disabled={disabled || dirty || busy || query.isPending || query.isError} onClick={() => identify.mutate("shot")}>识别本镜</Button><Button size="small" disabled={disabled || dirty || busy || query.isPending || query.isError} onClick={() => identify.mutate("chapter")}>识别本章</Button><Button size="small" disabled={disabled || dirty || busy || query.isPending || query.isError} onClick={() => identify.mutate("pending")}>仅待确认</Button></div></div>
        <div className="mb-2"><div className="flex flex-wrap gap-1"><Button size="small" disabled={disabled || dirty || busy || !shot || shot.busy || query.isError || !unboundVersions.length} aria-expanded={addingCharacter} onClick={() => setAddingCharacter((value) => !value)}>手动绑定角色</Button><Button size="small" disabled={disabled || dirty || busy || !shot || shot.busy || query.isError} onClick={() => { create.reset(); setCreatingCharacter(true); }}>新增角色</Button></div>{addingCharacter ? <Select<string | undefined> className="mt-2 w-full" aria-label="从项目资产绑定角色" placeholder="选择角色与造型；缺图也可先绑定" value={undefined} showSearch optionFilterProp="label" disabled={disabled || dirty || busy || shot?.busy} options={unboundVersions.map((version) => ({ value: version.versionId, label: `${query.data?.assets.find((asset) => asset.id === version.assetId)?.title || version.title} · ${version.referenceProfile?.name || "角色参考图"} · v${version.version}${!characterReferenceImage(version) ? " · 待补图" : ""}` }))} onChange={(versionId) => { const version = unboundVersions.find((item) => item.versionId === versionId); if (version) manual.mutate({ assetId: version.assetId, versionId: version.versionId, locked: true, status: characterReferenceImage(version) ? "resolved" : "pending" }); }} /> : null}</div>
        {dirty ? <p className="mb-2 text-xs text-foreground/55">先保存脚本，再按最新内容识别造型。</p> : null}
        {identify.isPending ? <div className="mb-2 text-xs text-foreground/60">{progress || "正在读取剧情与造型目录…"}<Button type="link" size="small" onClick={() => controller.current?.abort()}>停止并保留原绑定</Button></div> : null}
        {manual.isError || identify.isError ? <Alert type="error" title="造型更新失败" description={(manual.error || identify.error)?.message} /> : null}
        {query.isError ? <Alert type="error" title="造型目录读取失败" description={query.error.message} action={<Button size="small" onClick={() => void query.refetch()}>重试</Button>} /> : query.isPending ? <p className="text-xs text-foreground/55">正在读取造型…</p> : !shot?.assetIds.length ? <p className="text-xs text-foreground/55">本镜暂无出镜角色，可手动绑定项目角色，或新增遗漏角色后补图。</p> : <div className="workflow-character-reference-grid">{shot.assetIds.map((assetId) => {
            const asset = query.data.assets.find((item) => item.id === assetId);
            const refs = shot.references.filter((ref) => referenceAssetId(ref) === assetId);
            const ref = refs[0];
            const versions = query.data.catalog.versions.filter((version) => version.assetId === assetId);
            const selected = versions.find((version) => version.versionId === ref?.assetVersionId);
            const image = selected && characterReferenceImage(selected, closeUp);
            const review = ref && characterReferenceNeedsReview(ref, shot.revisionId);
            const label = refs.length > 1 ? "多个版本冲突" : !image && ref?.selectionSource === "manual" ? "缺参考图 · 已手动绑定" : review ? "待确认" : ref?.selectionLocked ? "已锁定" : ref?.selectionStatus === "resolved" ? ref.selectionSource === "manual" ? "手动确认" : "自动选择" : "已有绑定 · 可重新识别";
            return <div key={assetId} className="workflow-character-reference-card">
                {image ? <button className="workflow-character-reference-preview" type="button" aria-label={`预览 ${asset?.title || selected?.title || assetId}`} onClick={() => setPreview({ title: asset?.title || selected?.title || assetId, storageKey: resourceStorageKey(image.resourceId) })}><CachedResourceImage storageKey={resourceStorageKey(image.resourceId)} alt={`${asset?.title}参考图`} /></button> : null}
                <div className="workflow-character-reference-copy"><div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{asset?.title || selected?.title || assetId}</strong><span className={review || refs.length > 1 ? "text-amber-600" : "text-foreground/50"}>{label}</span>{ref && onUnlink ? <button type="button" aria-label={`取消引用 ${asset?.title || assetId}`} disabled={disabled || busy} onClick={() => onUnlink(ref)}><X className="size-3" /></button> : null}</div>
                <small className="workflow-bound-asset-id" title={assetId}>资产 ID：{assetId}</small>
                <Select className="w-full min-w-0" size="small" aria-label={`${asset?.title || assetId}造型版本`} placeholder="手动选择造型" value={ref?.assetVersionId} disabled={disabled || dirty || busy || shot.busy} showSearch optionFilterProp="label" options={versions.filter((version) => characterReferenceImage(version) || version.versionId === ref?.assetVersionId).map((version) => ({ value: version.versionId, label: `${version.referenceProfile?.name || "角色参考图"} · v${version.version}${version.referenceProfile?.preferred ? " · 定稿" : ""}${!characterReferenceImage(version) ? " · 缺图" : ""}`, disabled: !characterReferenceImage(version) }))} onChange={(versionId) => manual.mutate({ assetId, versionId, locked: true })} />
                <div className="flex flex-wrap gap-1">{asset ? <Button size="small" type="text" disabled={busy} onClick={() => setManageAsset(asset)}>{image ? "管理造型" : "补参考图"}</Button> : null}{ref ? <Button size="small" type="text" icon={ref.selectionLocked ? <LockKeyhole className="size-3" /> : <UnlockKeyhole className="size-3" />} disabled={disabled || dirty || busy || shot.busy || !image} onClick={() => manual.mutate({ assetId, versionId: ref.assetVersionId, locked: !ref.selectionLocked, status: ref.selectionLocked ? ref.selectionStatus || "resolved" : "resolved" })}>{ref.selectionLocked ? "解锁" : review ? "确认并锁定" : "锁定"}</Button> : null}</div>
                <details className="text-foreground/55"><summary>选择依据</summary><p className="m-0 whitespace-pre-wrap break-words">{review && ref?.selectionStatus !== "pending" ? "脚本已更新，请重新识别或手动确认。" : ref?.selectionReason || "已有镜头绑定，尚未记录自动识别依据。"}</p></details></div>
            </div>;
        })}</div>}
        <AppModal open={creatingCharacter} title="新增出镜角色" okText="新增并绑定本镜" confirmLoading={create.isPending} cancelButtonProps={{ disabled: create.isPending }} closable={!create.isPending} maskClosable={!create.isPending} keyboard={!create.isPending} onCancel={() => setCreatingCharacter(false)} onOk={() => createForm.submit()}>
            <p className="text-sm text-foreground/60">先检查项目中是否已有同名角色。新增后只绑定当前镜头，参考图可稍后生成、上传或从素材库选择。</p>
            <Form form={createForm} layout="vertical" onFinish={(values) => create.mutate(values)} disabled={create.isPending}>
                <Form.Item name="name" label="角色名称" rules={[{ required: true, whitespace: true, message: "请填写角色名称" }]}><Input autoComplete="off" /></Form.Item>
                <Form.Item name="appearance" label="外貌与服装"><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="按原文填写角色外貌、年龄与服装；也可稍后完善" /></Form.Item>
            </Form>
            {create.isError ? <Alert type="error" title={create.error.message} /> : null}
        </AppModal>
        {manageAsset ? <ProjectCharacterLooksModal key={`${shotId}:${manageAsset.id}`} project={detail.project} asset={manageAsset} currentVersionId={shot?.references.find((ref) => referenceAssetId(ref) === manageAsset.id)?.assetVersionId} applyDisabled={disabled || dirty || busy || Boolean(shot?.busy) || !shot || query.isError} onApplyVersion={async (versionId) => { await manual.mutateAsync({ assetId: manageAsset.id, versionId, locked: true }); setManageAsset(null); message.success("已用于当前镜头并锁定，其他镜头绑定不变"); }} onClose={() => setManageAsset(null)} onSaved={refresh} /> : null}
        <AppModal open={Boolean(preview)} title={preview?.title || "角色参考图"} footer={null} centered width="min(960px, calc(100vw - 32px))" onCancel={() => setPreview(null)}>{preview ? <CachedResourceImage eager storageKey={preview.storageKey} alt={preview.title} className="max-h-[75vh] w-full object-contain" /> : null}</AppModal>
    </section>;
}
