import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { getProjectCore, type ProjectAsset, type Project } from "@/services/api/projects";
import { characterFacePresetForAsset, characterFaceRoleLabels } from "@/lib/project-character-face-presets";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { configuredModelMatchesCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";
import { projectAssetImageCategory, projectAssetImageConfig, projectAssetImagePrompt, resolveProjectAssetImagePreset } from "./project-asset-image";
import { ProjectAssetImageFields } from "./project-asset-image-fields";
import type { ProjectAssetImageSubmission } from "./project-asset-image-generation";

export type { ProjectAssetImageSubmission } from "./project-asset-image-generation";

export function ProjectAssetImageModal({ asset, project, submitting, onClose, onGenerate, onFaceSettings }: { asset: ProjectAsset; project: Project; submitting: boolean; onClose: () => void; onGenerate: (input: ProjectAssetImageSubmission) => void; onFaceSettings?: () => void }) {
    const effectiveConfig = useEffectiveConfig();
    const category = projectAssetImageCategory(asset);
    const [preset, setPreset] = useState(() => resolveProjectAssetImagePreset(effectiveConfig, project, category));
    const [prompt, setPrompt] = useState(() => projectAssetImagePrompt(asset));
    const title = asset.character ? "生成角色三视图" : asset.category === "environment" ? "生成场景图" : "生成道具图";
    const faceQuery = useQuery({ queryKey: ["project", project.id, "character-face-reference", asset.id], enabled: Boolean(asset.character), staleTime: 0, queryFn: async () => {
        const { project: latest } = await getProjectCore(project.id);
        return characterFacePresetForAsset(latest.characterFacePresetsJson, asset.id) ?? null;
    } });
    const changePreset = (value: ProjectAssetImagePreset) => {
        setPreset(value);
        const store = useConfigStore.getState();
        store.updateConfig("projectAssetImagePresets", { ...store.config.projectAssetImagePresets, [category]: value });
    };
    return <AppModal open title={`${title} · ${asset.title}`} onCancel={() => !submitting && onClose()} width={720} footer={<div className="flex justify-end gap-2"><Button disabled={submitting} onClick={onClose}>取消</Button><Button type="primary" loading={submitting} disabled={!configuredModelMatchesCapability(effectiveConfig, preset.model, "image") || (!asset.character && !prompt.trim()) || Boolean(asset.character && (faceQuery.isPending || faceQuery.isError))} onClick={() => { changePreset(preset); onGenerate({ asset, config: projectAssetImageConfig(effectiveConfig, preset), prompt: [prompt.trim(), preset.extraPrompt.trim()].filter(Boolean).join("\n\n") }); }}>开始生成</Button></div>}>
        <p className="mb-4 text-xs text-foreground/55">模型、画质、尺寸和通用补充要求会按角色、场景、道具分别记住，重启后仍可复用。生成完成后图片自动绑定到资产新版本，项目画风会自动应用。</p>
        {asset.character ? <p className="mb-4 text-xs text-foreground/55">角色设定图固定包含：独立头部特写＋正面、右侧面、背面身体三视图。身体三视图从颈部以下展示至脚底，不包含头部。</p> : null}
        {asset.character ? <div className="mb-4 flex items-center gap-3 rounded-lg bg-surface-active p-3" aria-label="当前角色人脸参考">
            {faceQuery.data ? <div className="h-16 w-16 shrink-0"><CachedResourceImage key={faceQuery.data.resourceId} eager storageKey={`resource:${faceQuery.data.resourceId}`} alt="本次生成的人脸参考" className="h-full w-full rounded object-contain" fallback={<span className="text-xs">参考图读取失败</span>} /></div> : null}
            <div className="min-w-0 flex-1 text-xs">{faceQuery.isPending ? "正在读取人脸预设…" : faceQuery.isError ? faceQuery.error.message : faceQuery.data ? `已启用${characterFaceRoleLabels[faceQuery.data.role]}人脸参考 · 保留面孔，按剧本设计服装与造型` : "未绑定主角人脸预设 · 按角色设定生成"}</div>
            {onFaceSettings ? <Button size="small" disabled={submitting} onClick={onFaceSettings}>设置人脸参考</Button> : null}
            {faceQuery.isError ? <Alert type="error" title="人脸预设读取失败" action={<Button size="small" onClick={() => void faceQuery.refetch()}>重试</Button>} /> : null}
        </div> : null}
        {!asset.character ? <Form layout="vertical"><Form.Item label="当前资产图片提示词"><Input.TextArea aria-label="资产图片提示词" rows={5} value={prompt} disabled={submitting} onChange={(event) => setPrompt(event.target.value)} /></Form.Item></Form> : null}
        <ProjectAssetImageFields config={effectiveConfig} value={preset} onChange={changePreset} disabled={submitting} promptLabel={asset.character ? "头部特写与三视图补充要求（可选）" : undefined} />
    </AppModal>;
}
