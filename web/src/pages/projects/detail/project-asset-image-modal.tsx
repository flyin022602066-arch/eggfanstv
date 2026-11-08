import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { getProjectCore, type ProjectAsset, type Project } from "@/services/api/projects";
import { characterFacePresetForAsset, characterFaceRoleLabels } from "@/lib/project-character-face-presets";
import { characterIdentitySource } from "@/lib/character-identity-reference";
import { characterLookImageTargets } from "@/lib/character-look-selection";
import { getCharacterReferenceCatalog } from "@/services/api/project-character-references";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { configuredModelMatchesCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";
import { projectAssetImageCategory, projectAssetImageConfig, projectAssetImagePrompt, resolveProjectAssetImagePreset, resolveProjectAssetImagePrompt } from "./project-asset-image";
import { ProjectAssetImageFields } from "./project-asset-image-fields";
import type { ProjectAssetImageSubmission } from "./project-asset-image-generation";
import { ProjectAssetImageSourcePicker } from "./project-asset-image-source-picker";
import { projectAssetLibraryReference, useLibraryImageForProjectAsset } from "./project-asset-image-source";
import { assetLibraryQueryKey, assetPickerQueryKey } from "@/components/assets/asset-view-session";
import type { ReferenceImage } from "@/types/image";

export type { ProjectAssetImageSubmission } from "./project-asset-image-generation";

export function ProjectAssetImageModal({ asset, project, submitting, generationCount, singleCharacterLook = false, errorMessage, onClose, onGenerate, onFaceSettings }: { asset: ProjectAsset; project: Project; submitting: boolean; generationCount?: number; singleCharacterLook?: boolean; errorMessage?: string; onClose: () => void; onGenerate: (input: ProjectAssetImageSubmission) => void; onFaceSettings?: () => void }) {
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [pickerMode, setPickerMode] = useState<"reference" | "asset" | null>(null);
    const [referenceImage, setReferenceImage] = useState<ReferenceImage>();
    const effectiveConfig = useEffectiveConfig();
    const category = projectAssetImageCategory(asset);
    const [preset, setPreset] = useState(() => resolveProjectAssetImagePreset(effectiveConfig, project, category));
    const [prompt, setPrompt] = useState(() => projectAssetImagePrompt(asset));
    const title = asset.character ? "生成角色三视图" : asset.mediaType === "image" ? "编辑提示词并重绘" : asset.category === "environment" ? "生成场景图" : "生成道具图";
    const faceQuery = useQuery({ queryKey: ["project", project.id, "character-face-reference", asset.id, asset.character?.versionId, singleCharacterLook], enabled: Boolean(asset.character), staleTime: 0, queryFn: async () => {
        const scope = captureUserScope();
        const [{ project: latest }, catalog] = await Promise.all([getProjectCore(project.id, scope), getCharacterReferenceCatalog(project.id, scope)]);
        assertUserScope(scope);
        const versions = catalog.versions.filter((version) => version.assetId === asset.id);
        const missing = characterLookImageTargets(versions);
        const targets = singleCharacterLook ? versions.filter((version) => version.versionId === asset.character!.versionId) : missing.length ? missing : characterLookImageTargets(versions, false);
        if (!targets.length) throw new Error("角色没有可用造型，请刷新后重试");
        const identity = characterIdentitySource(catalog.versions, asset.id, targets[0]!.versionId);
        const preset = characterFacePresetForAsset(latest.characterFacePresetsJson, asset.id);
        if (identity.image) return { targets, resourceId: identity.image.resourceId, description: `继承基础版 v${identity.reference!.version} 的人脸 · 通过图片编辑生成新造型，不重新设计人物` };
        if (!identity.canCreateBase) throw new Error("请先生成或上传基础造型图片，再生成其他形态；不会降级为文生图换脸");
        return { targets, resourceId: preset?.resourceId, description: preset ? `已启用${characterFaceRoleLabels[preset.role]}人脸参考 · 首先建立角色基础版` : "本次建立基础版人脸 · 后续所有形态沿用此图编辑" };
    } });
    const changePreset = (value: ProjectAssetImagePreset) => {
        setPreset(value);
        const store = useConfigStore.getState();
        store.updateConfig("projectAssetImagePresets", { ...store.config.projectAssetImagePresets, [category]: value });
    };
    const count = generationCount ?? faceQuery.data?.targets.length ?? 1;
    const generate = () => {
        changePreset(preset);
        onGenerate({ asset, config: projectAssetImageConfig(effectiveConfig, preset), prompt: resolveProjectAssetImagePrompt(projectAssetImagePrompt(asset), prompt, preset.extraPrompt), referenceImage, ...(!singleCharacterLook && faceQuery.data ? { characterVersions: faceQuery.data.targets, characterPromptSupplement: preset.extraPrompt } : {}) });
    };
    return <AppModal open title={`${title} · ${asset.title}`} onCancel={() => !submitting && onClose()} width={720} footer={<div className="flex justify-end gap-2"><Button disabled={submitting} onClick={onClose}>取消</Button><Button type="primary" loading={submitting} disabled={!configuredModelMatchesCapability(effectiveConfig, preset.model, "image") || (!asset.character && !prompt.trim()) || Boolean(asset.character && (faceQuery.isPending || faceQuery.isError))} onClick={generate}>开始生成</Button></div>}>
        <p className="mb-4 text-xs text-foreground/55">模型、画质、尺寸和通用补充要求会按角色、场景、道具分别记住，重启后仍可复用。生成完成后图片自动绑定资产新版本并保存到素材库，项目画风会自动应用。</p>
        {errorMessage ? <Alert className="mb-4" type="error" title="图片任务未提交" description={errorMessage} /> : null}
        <div className="mb-4 flex flex-wrap items-center gap-2"><Button disabled={submitting} onClick={() => setPickerMode("asset")}>直接使用素材库图片</Button><Button disabled={submitting} onClick={() => setPickerMode("reference")}>选择生图参考</Button><span className="text-xs text-foreground/55">已有图片可直接绑定，无需先生成；参考生成会创建新图。</span></div>
        {referenceImage ? <div className="mb-4 flex items-center gap-3 rounded-lg bg-surface-active p-3"><CachedResourceImage storageKey={referenceImage.storageKey!} alt="本次选定的生图参考" className="h-16 w-16 rounded object-contain" /><span className="min-w-0 flex-1 truncate text-xs">{referenceImage.name}</span><Button size="small" disabled={submitting} onClick={() => setReferenceImage(undefined)}>移除参考</Button></div> : null}
        {count > 1 ? <Alert className="mb-4" type="info" showIcon title={`本次将提交 ${count} 套造型，每套一个独立图片任务`} description="先完成基础版，再以基础图编辑后续造型；共用下面的模型、尺寸、画质和补充要求。基础版失败时不会继续生成其他形态。" /> : null}
        {!singleCharacterLook && faceQuery.data ? <div className="mb-4 text-xs" aria-label="本次生成造型清单">{faceQuery.data.targets.map((version) => <p key={version.versionId}>{version.referenceProfile?.name || "默认造型"} · v{version.version}</p>)}<p className="text-foreground/55">优先补齐缺图造型；全部已有图片时逐套重绘。仅重绘某一套请到“造型与版本”中选择。</p></div> : null}
        {asset.character ? <p className="mb-4 text-xs text-foreground/55">角色设定图固定包含：独立头部特写＋正面、右侧面、背面身体三视图。身体三视图从颈部以下展示至脚底，不包含头部。</p> : null}
        {asset.character ? <div className="mb-4 flex items-center gap-3 rounded-lg bg-surface-active p-3" aria-label="当前角色人脸参考">
            {faceQuery.data?.resourceId ? <div className="h-16 w-16 shrink-0"><CachedResourceImage key={faceQuery.data.resourceId} eager storageKey={`resource:${faceQuery.data.resourceId}`} alt="本次生成的人脸参考" className="h-full w-full rounded object-contain" fallback={<span className="text-xs">参考图读取失败</span>} /></div> : null}
            <div className="min-w-0 flex-1 text-xs">{faceQuery.isPending ? "正在读取基础版人脸参考…" : faceQuery.isError ? faceQuery.error.message : faceQuery.data?.description}</div>
            {onFaceSettings ? <Button size="small" disabled={submitting} onClick={onFaceSettings}>设置人脸参考</Button> : null}
            {faceQuery.isError ? <Alert type="error" title="角色身份参考未就绪" action={<Button size="small" onClick={() => void faceQuery.refetch()}>重试</Button>} /> : null}
        </div> : null}
        {!asset.character ? <Form layout="vertical"><Form.Item label="本次生成提示词（可直接修改）" extra="仅用于当前资产，本次生成以这里修改后的文字为准。通用补充要求和项目画风会另外追加。"><Input.TextArea aria-label="资产图片提示词" autoSize={{ minRows: 8, maxRows: 16 }} showCount value={prompt} disabled={submitting} onChange={(event) => setPrompt(event.target.value)} /></Form.Item></Form> : null}
        <ProjectAssetImageFields config={effectiveConfig} value={preset} onChange={changePreset} disabled={submitting} promptLabel={asset.character ? "头部特写与三视图补充要求（可选）" : undefined} />
        {pickerMode ? <ProjectAssetImageSourcePicker mode={pickerMode} onClose={() => setPickerMode(null)} onSelect={async (source, scope) => {
            assertUserScope(scope);
            if (pickerMode === "reference") { setReferenceImage(projectAssetLibraryReference(source)); return; }
            await useLibraryImageForProjectAsset(project.id, asset, source, scope);
            assertUserScope(scope);
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["project", project.id] }), queryClient.invalidateQueries({ queryKey: assetLibraryQueryKey(scope) }), queryClient.invalidateQueries({ queryKey: assetPickerQueryKey(scope) })]);
            message.success("已直接使用选定素材作为资产新版本，无需生成");
            onClose();
        }} /> : null}
    </AppModal>;
}
