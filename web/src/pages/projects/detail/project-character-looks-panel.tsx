import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button } from "antd";
import { Check, Download, History, ImagePlus, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Star, Trash2, Upload, UserRound } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { assetLibraryQueryKey, assetPickerQueryKey } from "@/components/assets/asset-view-session";
import { activeCharacterLookKeys, characterLookGroups, characterLookKey } from "@/lib/character-look-management";
import { characterLookDraft, characterReferenceImage, missingCharacterLookImages, referenceVersionDescription } from "@/lib/character-look-selection";
import { characterIdentitySource } from "@/lib/character-identity-reference";
import { hasCombinedCharacterLooks } from "@/lib/character-reference-generation";
import { captureUserScope, assertUserScope } from "@/lib/user-scope-guard";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { deleteCharacterLookVersion, extractCharacterLooks, getCharacterReferenceCatalog, saveCharacterReferenceProfile, uploadCharacterLookImage, type CharacterReferenceProfile, type CharacterReferenceVersion } from "@/services/api/project-character-references";
import { listGenerationTasks } from "@/services/api/task-center";
import { uploadMediaFile } from "@/services/file-storage";
import { downloadOwnedOrBrowserMedia, reportOwnedMediaSave } from "@/services/desktop-media-save";
import { sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import type { Project, ProjectAsset } from "@/services/api/projects";
import { ProjectAssetImageModal } from "./project-asset-image-modal";
import { submitProjectAssetImage, type ProjectAssetImageSubmission } from "./project-asset-image-generation";
import { submitCharacterLookImages } from "./project-character-media";
import { ProjectAssetImageSourcePicker } from "./project-asset-image-source-picker";
import { projectAssetLibraryReference } from "./project-asset-image-source";
import { CharacterLookEditor, NewCharacterLook } from "./project-character-look-editor";
import { ProjectCharacterImagePreview } from "./project-character-image-preview";
import "./project-character-looks.css";

export type CharacterLooksPanelProps = { project: Project; asset: ProjectAsset; currentVersionId?: string; onApplyVersion?: (versionId: string) => Promise<unknown>; applyDisabled?: boolean; onSaved: () => Promise<unknown> };
type LookGroup = ReturnType<typeof characterLookGroups>[number];

export function ProjectCharacterLooksPanel({ project, asset, currentVersionId, onApplyVersion, applyDisabled = false, onSaved }: CharacterLooksPanelProps) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [focusedVersionId, setFocusedVersionId] = useState(currentVersionId);
    const [creating, setCreating] = useState(false);
    const [generating, setGenerating] = useState<CharacterReferenceVersion | null>(null);
    const [batchGenerating, setBatchGenerating] = useState(false);
    const [historyKey, setHistoryKey] = useState<string | null>(null);
    const [operationError, setOperationError] = useState("");
    const catalog = useQuery({ queryKey: ["project", project.id, "character-reference-catalog"], queryFn: () => getCharacterReferenceCatalog(project.id) });
    const tasks = useQuery({ queryKey: ["project", project.id, "character-look-tasks", asset.id], queryFn: () => listGenerationTasks(100, { projectId: project.id }), refetchInterval: 2500 });
    const taskSignature = tasks.data?.filter((task) => task.clientContext?.nodeId === `character-turnaround:${asset.id}`).map((task) => `${task.id}:${task.status}`).join(",");
    useEffect(() => { void queryClient.invalidateQueries({ queryKey: ["project", project.id, "character-reference-catalog"] }); }, [taskSignature, project.id, queryClient]);
    const versions = catalog.data?.versions.filter((version) => version.assetId === asset.id) || [];
    const groups = characterLookGroups(versions, focusedVersionId);
    const busyKeys = activeCharacterLookKeys(tasks.data || [], versions);
    const missing = missingCharacterLookImages(versions).filter((version) => !busyKeys.has(characterLookKey(version, versions)));
    const baseVersion = versions.slice().sort((left, right) => left.version - right.version).find((version) => !hasCombinedCharacterLooks(version.definition));
    let baseImage: ReturnType<typeof characterReferenceImage> | undefined;
    let identityError = "";
    try { if (baseVersion) baseImage = characterIdentitySource(versions, asset.id, baseVersion.versionId).image; }
    catch (error) { identityError = error instanceof Error ? error.message : "基础形象读取失败"; }
    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
        const scope = captureUserScope();
        await Promise.all([queryClient.invalidateQueries({ queryKey: assetLibraryQueryKey(scope) }), queryClient.invalidateQueries({ queryKey: assetPickerQueryKey(scope) })]);
        await onSaved();
    };
    const splitSource = versions.find((version) => hasCombinedCharacterLooks(version.definition));
    const split = useMutation({ mutationFn: () => { if (!splitSource) throw new Error("未找到需要拆分的旧设定"); return extractCharacterLooks(project.id, splitSource, captureUserScope()); }, onSuccess: async (result) => { await refresh(); message.success(result.versions.length ? `已拆成 ${result.versions.length} 套独立造型` : "这些造型已存在，不重复创建"); }, onError: (error) => setOperationError(error.message) });
    const generationTargets = batchGenerating ? missing : generating ? [generating] : [];
    const generate = useMutation({ mutationFn: async (input: ProjectAssetImageSubmission) => {
        const targets = generationTargets.slice();
        if (!targets.length) throw new Error("没有待生成造型，请刷新后重试");
        return submitCharacterLookImages(targets, versions, (version) => submitProjectAssetImage(project, { ...input, asset: { ...asset, primaryVersionId: version.versionId, character: version } }));
    }, onSuccess: async (result) => { setGenerating(null); setBatchGenerating(false); setOperationError(result.errors.join("；")); await tasks.refetch(); if (result.submitted) message.success(`已提交 ${result.submitted} 套造型图片任务，完成后请确认选用`); }, onError: (error) => setOperationError(error.message) });
    const submittingKeys = generate.isPending ? new Set(generationTargets.map((version) => characterLookKey(version, versions))) : new Set<string>();
    const pendingCount = groups.filter((group) => group.pending.length).length;
    const historyGroup = groups.find((group) => group.key === historyKey);
    const historyVersions = historyKey === "__all__" ? versions.slice().sort((left, right) => right.version - left.version) : historyGroup?.history || [];
    const generationAsset = generating ? { ...asset, primaryVersionId: generating.versionId, character: generating } : undefined;
    const startGeneration = (version: CharacterReferenceVersion) => { setOperationError(""); setBatchGenerating(false); setGenerating(version); };
    return <section className="character-look-panel" aria-label={`${asset.title}造型管理`}>
        <div className="character-identity-summary">
            <div className="character-identity-face">{baseImage ? <CachedResourceImage eager storageKey={resourceStorageKey(baseImage.resourceId)} alt={`${asset.title}基础人脸参考`} /> : <UserRound className="size-8" />}</div>
            <div className="character-identity-copy"><strong><ShieldCheck className="size-4" />基础身份参考</strong><p>{baseImage ? "后续造型沿用此人脸，服装与形态按各自设定编辑。" : "先完成基础形象，再基于同一人脸生成其他造型。"}</p><span>基础人脸与默认出镜造型分别管理</span></div>
            <details className="character-identity-details"><summary>角色基本设定</summary><p>{baseVersion ? referenceVersionDescription({ ...baseVersion, referenceProfile: undefined }) : String(asset.character?.definition.appearance || "尚未填写")}</p></details>
        </div>
        <div className="character-looks-toolbar"><div><h3>角色造型 <span>{groups.length}</span></h3><p role="status">{groups.filter((group) => group.confirmed).length} 套已确认 · {pendingCount} 套待确认 · {groups.filter((group) => !characterReferenceImage(group.current)).length} 套待补图</p></div><div className="character-looks-actions">
            <Button size="small" icon={<RefreshCw className="size-3.5" />} aria-label="刷新造型" loading={catalog.isFetching} onClick={() => { void catalog.refetch(); void tasks.refetch(); }}>刷新</Button>
            <Button size="small" icon={<History className="size-3.5" />} onClick={() => setHistoryKey("__all__")}>全部历史</Button>
            {missing.length ? <Button size="small" disabled={generate.isPending} onClick={() => { setBatchGenerating(true); setGenerating(missing[0]!); }}>补齐 {missing.length} 套缺图</Button> : null}
            <Button size="small" icon={<Plus className="size-3.5" />} disabled={!baseVersion} onClick={() => setCreating(true)}>新增造型</Button>
        </div></div>
        {onApplyVersion ? <p className="character-look-hint">选择具体图片用于当前镜头；确认造型或切换默认不会替换已有镜头绑定。</p> : null}
        {operationError || identityError ? <Alert type="error" title="造型操作未完成" description={operationError || identityError} closable onClose={() => setOperationError("")} /> : null}
        {catalog.isError ? <Alert type="error" title="造型读取失败" description={catalog.error.message} action={<Button onClick={() => void catalog.refetch()}>重试</Button>} /> : null}
        {tasks.isError ? <Alert type="warning" title="任务状态暂时无法更新" description="请刷新后再提交生成，避免重复任务。其他造型仍可浏览。" /> : null}
        {splitSource ? <div className="character-look-legacy"><span>旧设定中包含多套造型，可直接拆分后逐套管理。</span><Button size="small" loading={split.isPending} onClick={() => split.mutate()}>拆分已有造型设定</Button></div> : null}
        {catalog.isPending ? <p role="status">正在读取角色造型…</p> : !groups.length ? <p>没有可用造型，请刷新项目。</p> : <div className="character-look-grid">{groups.map((group) => <CharacterLookCard key={group.key} group={group} versions={versions} projectId={project.id} busy={busyKeys.has(group.key) || submittingKeys.has(group.key)} generationUnavailable={tasks.isError || tasks.isPending} currentVersionId={currentVersionId} onApplyVersion={onApplyVersion} applyDisabled={applyDisabled} onSaved={refresh} onVersionCreated={setFocusedVersionId} onGenerate={startGeneration} onHistory={() => setHistoryKey(group.key)} />)}</div>}
        {historyKey ? <AppModal open title={historyGroup ? `${characterLookDraft(historyGroup.current, versions).name} · 图片历史` : "全部图片与设定历史"} width={900} footer={null} onCancel={() => setHistoryKey(null)}><p className="character-look-hint">同造型重绘保留在这里。查看图片不会改变定稿；镜头只在点击“用于当前镜头并锁定”后更换。</p><div className="character-look-grid character-look-history-grid">{historyVersions.map((version) => <CharacterLookCard key={version.versionId} group={{ key: characterLookKey(version, versions), current: version, confirmed: version.referenceProfile?.preferred ? version : undefined, pending: [], history: [version] }} versions={versions} projectId={project.id} busy={busyKeys.has(characterLookKey(version, versions))} generationUnavailable={tasks.isError || tasks.isPending} currentVersionId={currentVersionId} onApplyVersion={onApplyVersion} applyDisabled={applyDisabled} onSaved={refresh} onVersionCreated={setFocusedVersionId} onGenerate={(target) => { setHistoryKey(null); startGeneration(target); }} onView={() => { setFocusedVersionId(version.versionId); setHistoryKey(null); }} />)}</div></AppModal> : null}
        {creating && baseVersion ? <NewCharacterLook base={baseVersion} projectId={project.id} onClose={() => setCreating(false)} onCreated={async (id) => { setFocusedVersionId(id); await refresh(); }} /> : null}
        {generationAsset ? <ProjectAssetImageModal key={generationAsset.character.versionId} asset={generationAsset} project={project} submitting={generate.isPending} errorMessage={operationError} singleCharacterLook generationCount={generationTargets.length} onClose={() => { if (!generate.isPending) { setGenerating(null); setBatchGenerating(false); } }} onGenerate={(input) => { setOperationError(""); generate.mutate(input); }} /> : null}
    </section>;
}

function CharacterLookCard({ group, versions, projectId, busy, generationUnavailable, currentVersionId, onApplyVersion, applyDisabled, onSaved, onVersionCreated, onGenerate, onHistory, onView }: { group: LookGroup; versions: CharacterReferenceVersion[]; projectId: string; busy: boolean; generationUnavailable: boolean; currentVersionId?: string; onApplyVersion?: (versionId: string) => Promise<unknown>; applyDisabled: boolean; onSaved: () => Promise<unknown>; onVersionCreated: (id: string) => void; onGenerate: (version: CharacterReferenceVersion) => void; onHistory?: () => void; onView?: () => void }) {
    const { message, modal } = App.useApp();
    const version = group.current;
    const profile = characterLookDraft(version, versions);
    const image = characterReferenceImage(version);
    const [editing, setEditing] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [operationError, setOperationError] = useState("");
    const save = useMutation({ mutationFn: (next: CharacterReferenceProfile) => saveCharacterReferenceProfile(projectId, version, next, captureUserScope()), onSuccess: async () => { setOperationError(""); await onSaved(); }, onError: (error) => setOperationError(error.message) });
    const upload = useMutation({ mutationFn: async (file: File) => {
        if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
        const scope = captureUserScope();
        const uploaded = await uploadMediaFile(file, "character-image", undefined, scope);
        assertUserScope(scope);
        const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
        if (!resourceId) throw new Error("图片尚未保存到资源库，请重试上传");
        return uploadCharacterLookImage(projectId, version.assetId, version.versionId, resourceId, scope);
    }, onSuccess: async (result) => { setOperationError(""); onVersionCreated(result.character.versionId); await onSaved(); message.success("图片已保存，请核对后确认选用"); }, onError: (error) => setOperationError(error.message) });
    const remove = useMutation({ mutationFn: () => deleteCharacterLookVersion(projectId, version, captureUserScope()), onSuccess: async () => { setOperationError(""); await onSaved(); }, onError: (error) => setOperationError(error.message) });
    const apply = useMutation({ mutationFn: () => { if (!onApplyVersion) throw new Error("请从镜头资产中选图"); return onApplyVersion(version.versionId); }, onError: (error) => setOperationError(error.message) });
    const changing = busy || save.isPending || upload.isPending || remove.isPending || apply.isPending;
    const inheritedDefault = profile.default || versions.some((item) => characterLookKey(item, versions) === group.key && item.referenceProfile?.preferred && item.referenceProfile.default);
    const confirm = () => save.mutate({ ...profile, enabled: true, preferred: true, default: inheritedDefault });
    const requestRemove = () => modal.confirm({ title: `删除“${profile.name}”的这版${image ? "图片" : "设定"}？`, content: "原始素材保留。已被镜头、画布或任务引用的版本需要先解除引用；其他造型不受影响。", okText: "删除此版本", okButtonProps: { danger: true }, cancelText: "取消", onOk: async () => { try { await remove.mutateAsync(); } catch { return; } } });
    const status = busy ? "正在生成" : !image ? "待补图" : profile.preferred ? "已确认选用" : "待确认";
    return <article className="character-look-card" data-look-key={group.key} data-version-id={version.versionId} aria-label={`造型：${profile.name}`}>
        <div className="character-look-card-heading"><span className={`character-look-status${profile.preferred ? " is-confirmed" : ""}`} role="status">{profile.preferred ? <Check className="size-3" /> : null}{status}</span>{profile.default ? <span className="character-look-default"><Star className="size-3" />默认</span> : null}<Button type="text" size="small" aria-label={`删除 ${profile.name} 此版本`} title="删除此版本" danger icon={<Trash2 className="size-3.5" />} disabled={changing} onClick={requestRemove} /></div>
        <button type="button" className="character-look-card-image" disabled={!image} aria-label={`预览造型 ${profile.name}`} onClick={() => setPreviewOpen(true)}>{image ? <CachedResourceImage storageKey={resourceStorageKey(image.resourceId)} alt={`${version.title} ${profile.name}`} /> : <span><ImagePlus className="size-7" />尚未生成图片</span>}</button>
        <div className="character-look-card-copy"><h4 title={profile.name}>{profile.name}</h4><p title={profile.description}>{profile.description || referenceVersionDescription(version) || "尚未填写外观说明"}</p><span className="character-look-version-label">图片 v{version.version} · {group.history.length} 条记录</span></div>
        {onHistory && group.pending.some((item) => item.versionId !== version.versionId) ? <Button className="character-look-review" size="small" onClick={onHistory}>查看 {group.pending.length} 张新图 · 待确认</Button> : null}
        {operationError ? <Alert type="error" title="操作未完成" description={operationError} closable onClose={() => setOperationError("")} /> : null}
        <div className="character-look-card-actions">
            {image && !profile.preferred ? <Button type="primary" size="small" icon={<Check className="size-3.5" />} loading={save.isPending} disabled={changing} onClick={confirm}>确认选用</Button> : null}
            <Button size="small" icon={<Sparkles className="size-3.5" />} disabled={changing || generationUnavailable} onClick={() => onGenerate(version)}>{image ? "重新生成" : "生成图片"}</Button>
            <label className={`character-look-upload${changing ? " is-disabled" : ""}`}><input type="file" accept="image/*" aria-label={`上传 ${profile.name} 图片`} disabled={changing} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload.mutate(file); }} /><Upload className="size-3.5" />{upload.isPending ? "上传中" : "上传"}</label>
            <Button size="small" disabled={changing} onClick={() => setLibraryOpen(true)}>素材库选图</Button>
        </div>
        {onApplyVersion ? <Button size="small" className="character-look-apply" disabled={applyDisabled || changing || !image || version.versionId === currentVersionId} loading={apply.isPending} onClick={() => apply.mutate()}>{version.versionId === currentVersionId ? "当前镜头正在使用此版本" : "用于当前镜头并锁定"}</Button> : null}
        <div className="character-look-card-secondary">
            <Button size="small" type="text" icon={<Pencil className="size-3.5" />} disabled={changing} onClick={() => setEditing(true)}>编辑设定</Button>
            {onHistory ? <Button size="small" type="text" icon={<History className="size-3.5" />} onClick={onHistory}>图片历史</Button> : null}
            {onView ? <Button size="small" type="text" onClick={onView}>返回卡片查看</Button> : null}
            {image && profile.preferred ? <Button size="small" type="text" disabled={changing} onClick={() => save.mutate({ ...profile, preferred: false, default: false })}>取消确认</Button> : null}
            {image && !profile.default ? <Button size="small" type="text" icon={<Star className="size-3.5" />} disabled={changing} onClick={() => save.mutate({ ...profile, enabled: true, preferred: true, default: true })}>设为默认</Button> : null}
        </div>
        {editing ? <CharacterLookEditor version={version} versions={versions} projectId={projectId} onSaved={onSaved} onClose={() => setEditing(false)} /> : null}
        {libraryOpen ? <ProjectAssetImageSourcePicker mode="asset" onClose={() => setLibraryOpen(false)} onSelect={async (source, scope) => {
            const selected = projectAssetLibraryReference(source);
            const resourceId = resourceIdFromStorageKey(selected.storageKey);
            if (!resourceId) throw new Error("选定素材不是可用的本地图片资源");
            const result = await uploadCharacterLookImage(projectId, version.assetId, version.versionId, resourceId, scope);
            assertUserScope(scope);
            onVersionCreated(result.character.versionId);
            await onSaved();
            message.success("已保存选定图片，请核对后确认选用");
        }} /> : null}
        {previewOpen && image ? <AppModal open title={`${version.title} · ${profile.name}`} width={900} onCancel={() => setPreviewOpen(false)} footer={<Button icon={<Download className="size-3.5" />} onClick={() => { void reportOwnedMediaSave({ success: (text: string) => message.success(text), error: (text: string) => setOperationError(text) }, downloadOwnedOrBrowserMedia({ resourceId: image.resourceId, fileName: sanitizeDownloadFileName(`${version.title}-${profile.name}-v${version.version}.png`), browserUrl: resourceFileUrl(image.resourceId) })); }}>下载原图</Button>}><ProjectCharacterImagePreview resourceId={image.resourceId} title={`${version.title} ${profile.name}`} /></AppModal> : null}
    </article>;
}
