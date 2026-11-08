import { characterTurnaroundVariables } from "@/lib/character-reference-generation";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { characterFaceDesignConstraint, characterFacePresetForAsset, characterFaceReference, type CharacterFacePresets } from "@/lib/project-character-face-presets";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import type { SunoMusicVideoAsset } from "@/lib/suno-music-video-plan";
import { logicalModelIDForConfig, type AiConfig } from "@/stores/use-config-store";

export type SunoMusicVideoImageSettings = Partial<Pick<AiConfig, "model" | "size" | "quality" | "transparentBackground" | "imageThinkingLevel">>;
export type SunoMusicVideoImagePresets = Partial<Record<SunoMusicVideoAsset["category"], SunoMusicVideoImageSettings>>;

export function resolveSunoMusicVideoImageConfig(current: AiConfig, category: SunoMusicVideoAsset["category"], saved?: SunoMusicVideoImageSettings, ratio = "16:9"): AiConfig {
    const model = saved?.model || current.imageModel || current.model;
    const value = { ...current, ...saved, size: saved?.size || (category === "character" ? "3:2" : category === "scene" ? ratio : "1:1"), count: "1" };
    const profile = modelCapabilityConfigFor(current, model).image;
    return { ...value, ...(profile ? normalizeImageValue(profile, value) : {}), model, imageModel: model, taskWorkflowProvider: "model" };
}

export function sunoMusicVideoAssetRequest(asset: SunoMusicVideoAsset, model: string, visualStyle: string, current: AiConfig, presets: CharacterFacePresets = {}) {
    const config: AiConfig = { ...current, model, imageModel: model, count: "1", taskWorkflowProvider: "model" };
    const metadata = { source: "suno-music-video-asset", assetId: asset.id, assetCategory: asset.category };
    if (asset.category !== "character") return { mode: "image" as const, config, prompt: [asset.imagePrompt, `统一视觉风格：${visualStyle || "电影级 MV 视觉"}`, `资产名称：${asset.name}`, `资产设定：${asset.description}`].join("\n\n"), metadata, referenceImages: [] };
    const preset = characterFacePresetForAsset(JSON.stringify(presets), asset.id);
    if (!preset && Object.values(presets).some((face) => face && !face.assetIds.length)) throw new Error("已上传主角人脸但未绑定角色，请先在角色卡片选择人脸参考，再生成角色图片");
    if (preset && (modelCapabilityConfigFor(config, model).image?.references.maxImages ?? 0) < 1 && !logicalModelIDForConfig(config)) throw new Error("当前图片模型不支持参考图，请切换支持图片编辑或图生图的模型后再使用主角人脸预设");
    const variables = characterTurnaroundVariables(asset.name, { appearance: asset.description }, asset.imagePrompt);
    variables.项目画风 = `MV 统一视觉风格：${visualStyle || "电影级 MV 视觉"}`;
    if (preset) variables.角色设定 += `\n\n${characterFaceDesignConstraint(asset.name, preset.role)}`;
    return { mode: "image" as const, config, prompt: promptTemplateTaskPlaceholder("角色三视图"), referenceImages: preset ? [characterFaceReference(preset)] : [], metadata: { ...metadata, operation: "suno_music_video_asset", promptTemplateOperation: PromptTemplateOperation.CharacterTurnaround, promptTemplateVariables: variables } };
}
