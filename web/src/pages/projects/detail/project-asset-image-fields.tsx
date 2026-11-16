import { Alert, Form, Input, Select } from "antd";
import { ModelPicker } from "@/components/model-picker";
import { ImageSizePicker } from "@/components/image-size-picker";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import type { ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";
import { configuredModelMatchesCapability, type AiConfig } from "@/stores/use-config-store";
import { CHARACTER_DESIGN_TEMPLATES, CHARACTER_REFERENCE_LAYOUTS, characterDesignTemplate, characterReferenceLayout } from "@/lib/character-reference-templates";

export function ProjectAssetImageFields({ config, value, onChange, promptLabel, promptScope = "category", disabled = false, character = false }: { config: AiConfig; value: ProjectAssetImagePreset; onChange: (value: ProjectAssetImagePreset) => void; promptLabel?: string; promptScope?: "asset" | "category"; disabled?: boolean; character?: boolean }) {
    const available = configuredModelMatchesCapability(config, value.model, "image");
    const profile = available ? modelCapabilityConfigFor(config, value.model).image : undefined;
    return <Form layout="vertical" disabled={disabled}>
        {character ? <>
            <Form.Item label="角色参考图格式" extra={characterReferenceLayout(value.characterLayoutId).description}><Select aria-label="角色参考图格式" value={characterReferenceLayout(value.characterLayoutId).id} options={CHARACTER_REFERENCE_LAYOUTS.map((item) => ({ value: item.id, label: item.name }))} onChange={(characterLayoutId) => onChange({ ...value, characterLayoutId })} /></Form.Item>
            <Form.Item label="角色形象生成模板" extra="仅用于角色图设计，不改变提取范围、模型或剧情；项目明确设定、人脸参考与单套造型优先。群体与非人角色沿用专用规则。"><Select aria-label="角色形象生成模板" value={characterDesignTemplate(value.characterDesignTemplateId).id} options={CHARACTER_DESIGN_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))} onChange={(characterDesignTemplateId) => onChange({ ...value, characterDesignTemplateId })} /></Form.Item>
        </> : null}
        {value.model && !available ? <Alert className="mb-4" type="warning" showIcon title="已保存的模型当前不可用，请重新选择图片模型" /> : null}
        <Form.Item label="图片模型"><div className={disabled ? "pointer-events-none opacity-50" : undefined} inert={disabled}><ModelPicker config={config} value={value.model} capability="image" fullWidth placeholder="请选择可用图片模型" onChange={(model) => {
            const nextProfile = modelCapabilityConfigFor(config, model).image;
            const selection = nextProfile ? normalizeImageValue(nextProfile, { ...value, count: "1" }) : value;
            onChange({ ...value, model, size: selection.size, quality: selection.quality });
        }} /></div></Form.Item>
        {profile?.quality.supported && !imageResolutionUsesQuality(profile) ? <Form.Item label="画质"><Select aria-label="资产生图画质" value={value.quality} options={profile.quality.values.map((quality) => ({ value: quality, label: quality.toUpperCase() }))} onChange={(quality) => onChange({ ...value, quality })} /></Form.Item> : null}
        {profile ? <ImageSizePicker profile={profile} size={value.size} quality={value.quality} onChange={(size, quality) => onChange({ ...value, size, quality: quality || value.quality })} /> : null}
        <Form.Item label={promptLabel || (promptScope === "asset" ? "当前资产补充要求（仅本次）" : "本类资产通用补充要求（记忆）")}><Input.TextArea aria-label={promptScope === "asset" ? "本次资产生图补充要求" : "通用生图补充要求"} rows={3} value={value.extraPrompt} onChange={(event) => onChange({ ...value, extraPrompt: event.target.value })} placeholder={promptScope === "asset" ? "仅用于当前资产本次生成，不会应用到其他资产，也不会保存为通用要求" : "只填写所有同类资产都要遵循的要求；每个资产的原始设定会自动保留"} /></Form.Item>
    </Form>;
}
