import { useState } from "react";
import { Alert, Button, Form, Input, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { ImageSizePicker } from "@/components/image-size-picker";
import { ModelPicker } from "@/components/model-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { projectAssetImageConfig, projectAssetImageModel } from "./project-asset-image";
import { defaultProjectCoverPrompt } from "./project-settings-cover-generation";
import type { AiConfig } from "@/stores/use-config-store";
import type { Project } from "@/services/api/projects";

type CoverPreset = { model: string; size: string; quality: string };
type CoverTaskStatus = { status: string; stage?: string; progress?: number };

export function ProjectSettingsCoverGenerationModal({
    open,
    project,
    config,
    preferredModel,
    submitting,
    taskStatus,
    onClose,
    onGenerate,
}: {
    open: boolean;
    project: Project;
    config: AiConfig;
    preferredModel: string;
    submitting: boolean;
    taskStatus: CoverTaskStatus | null;
    onClose: () => void;
    onGenerate: (input: { prompt: string; config: AiConfig }) => void;
}) {
    const [prompt, setPrompt] = useState(() => defaultProjectCoverPrompt(project));
    const [preset, setPreset] = useState<CoverPreset>(() => initialPreset(config, project, preferredModel));
    const available = Boolean(preset.model) && Boolean(modelCapabilityConfigFor(config, preset.model).image);
    const profile = available ? modelCapabilityConfigFor(config, preset.model).image : undefined;

    return <AppModal
        open={open}
        title="AI 生成项目封面"
        width={680}
        closable={!submitting}
        maskClosable={!submitting}
        keyboard={!submitting}
        onCancel={() => { if (!submitting) onClose(); }}
        footer={<div className="flex justify-end gap-2"><Button disabled={submitting} onClick={onClose}>取消</Button><Button type="primary" loading={submitting} disabled={!available || !prompt.trim()} onClick={() => onGenerate({ prompt: prompt.trim(), config: projectAssetImageConfig(config, { ...preset, extraPrompt: "" }) })}>生成并设为主图</Button></div>}
    >
        <Form layout="vertical">
            <Form.Item label="图片模型">
                <ModelPicker config={config} value={preset.model} capability="image" fullWidth placeholder="请选择可用图片模型" onChange={(model) => setPreset(initialPreset(config, project, model))} />
            </Form.Item>
            {profile?.quality.supported && !imageResolutionUsesQuality(profile) ? <Form.Item label="画质"><Select aria-label="封面图片画质" value={preset.quality} options={profile.quality.values.map((quality) => ({ value: quality, label: quality.toUpperCase() }))} onChange={(quality) => setPreset((current) => ({ ...current, quality }))} /></Form.Item> : null}
            {profile ? <ImageSizePicker profile={profile} size={preset.size} quality={preset.quality} onChange={(size, quality) => setPreset((current) => ({ ...current, size, quality: quality || current.quality }))} /> : null}
            <Form.Item label="封面提示词" extra="生成结果会直接保存为项目主图。">
                <Input.TextArea aria-label="项目封面生成提示词" autoSize={{ minRows: 7, maxRows: 14 }} showCount maxLength={12000} value={prompt} disabled={submitting} onChange={(event) => setPrompt(event.target.value)} />
            </Form.Item>
        </Form>
        {!available ? <Alert className="mb-3" type="warning" showIcon title="请先在模型设置中配置可用的图片模型" /> : null}
        {taskStatus ? <Alert type="info" showIcon title="正在生成项目封面" description={`${taskStatus.stage || taskStatus.status}${typeof taskStatus.progress === "number" ? ` · ${Math.round(taskStatus.progress)}%` : ""}`} /> : null}
    </AppModal>;
}

function initialPreset(config: AiConfig, project: Project, preferredModel: string): CoverPreset {
    const model = projectAssetImageModel(config, preferredModel);
    const profile = model ? modelCapabilityConfigFor(config, model).image : undefined;
    const value = profile ? normalizeImageValue(profile, { size: project.aspectRatio || config.size, quality: config.quality, count: "1" }) : { size: project.aspectRatio || config.size, quality: config.quality };
    return { model, size: value.size, quality: value.quality };
}
