import { Alert, Form, Input, Select } from "antd";
import { ModelPicker } from "@/components/model-picker";
import { ImageSizePicker } from "@/components/image-size-picker";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import type { ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";
import { configuredModelMatchesCapability, type AiConfig } from "@/stores/use-config-store";

export function ProjectAssetImageFields({ config, value, onChange, promptLabel = "本类资产通用补充要求（记忆）", disabled = false }: { config: AiConfig; value: ProjectAssetImagePreset; onChange: (value: ProjectAssetImagePreset) => void; promptLabel?: string; disabled?: boolean }) {
    const available = configuredModelMatchesCapability(config, value.model, "image");
    const profile = available ? modelCapabilityConfigFor(config, value.model).image : undefined;
    return <Form layout="vertical" disabled={disabled}>
        {value.model && !available ? <Alert className="mb-4" type="warning" showIcon title="已保存的模型当前不可用，请重新选择图片模型" /> : null}
        <Form.Item label="图片模型"><div className={disabled ? "pointer-events-none opacity-50" : undefined} inert={disabled}><ModelPicker config={config} value={value.model} capability="image" fullWidth placeholder="请选择可用图片模型" onChange={(model) => {
            const nextProfile = modelCapabilityConfigFor(config, model).image;
            const selection = nextProfile ? normalizeImageValue(nextProfile, { ...value, count: "1" }) : value;
            onChange({ ...value, model, size: selection.size, quality: selection.quality });
        }} /></div></Form.Item>
        {profile?.quality.supported && !imageResolutionUsesQuality(profile) ? <Form.Item label="画质"><Select aria-label="资产生图画质" value={value.quality} options={profile.quality.values.map((quality) => ({ value: quality, label: quality.toUpperCase() }))} onChange={(quality) => onChange({ ...value, quality })} /></Form.Item> : null}
        {profile ? <ImageSizePicker profile={profile} size={value.size} quality={value.quality} onChange={(size, quality) => onChange({ ...value, size, quality: quality || value.quality })} /> : null}
        <Form.Item label={promptLabel}><Input.TextArea aria-label="通用生图补充要求" rows={3} value={value.extraPrompt} onChange={(event) => onChange({ ...value, extraPrompt: event.target.value })} placeholder="只填写所有同类资产都要遵循的要求；每个资产的原始设定会自动保留" /></Form.Item>
    </Form>;
}
