import type { ProjectAsset, Project } from "@/services/api/projects";
import { configuredModelMatchesCapability, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import type { GenerationTask } from "@/services/api/task-center";
import type { ProjectAssetImageCategory, ProjectAssetImagePreset } from "@/lib/project-asset-image-preferences";

export function projectAssetImageModel(config: AiConfig, projectDefault?: string) {
    return [projectDefault, config.imageModel, ...selectableModelsByCapability(config, "image")].find((model) => model && configuredModelMatchesCapability(config, model, "image")) || "";
}

export function projectAssetImagePrompt(asset: ProjectAsset) {
    if (asset.character) return "";
    let description = asset.previewText || "";
    if (asset.definitionJson) {
        try { description = JSON.stringify(JSON.parse(asset.definitionJson), null, 2); }
        catch { description = asset.definitionJson; }
    }
    const purpose = asset.category === "environment" ? "生成供后续分镜复用的场景设定图，清晰呈现空间布局、建筑、材质、光线和环境细节，不添加人物。" : "生成供后续分镜复用的道具设定图，主体完整清晰，突出形状、材质、颜色与结构，背景简洁。";
    return `${purpose}\n资产名称：${asset.title}\n原始设定：\n${description || asset.title}`;
}

export function canGenerateProjectAssetImage(asset: ProjectAsset) {
    return Boolean(asset.primaryVersionId) && ["environment", "prop"].includes(asset.category) && ["text", "image"].includes(asset.mediaType);
}

export function projectAssetImageCategory(asset: ProjectAsset): ProjectAssetImageCategory {
    return asset.character ? "character" : asset.category === "environment" ? "environment" : "prop";
}

export function resolveProjectAssetImagePreset(config: AiConfig, project: Project, category: ProjectAssetImageCategory): ProjectAssetImagePreset {
    const saved = config.projectAssetImagePresets?.[category];
    const model = saved?.model || projectAssetImageModel(config, project.defaultImageModel);
    const selection = { size: saved?.size || (category === "character" ? "3:2" : project.aspectRatio || config.size), quality: saved?.quality || config.quality, count: "1" };
    const profile = configuredModelMatchesCapability(config, model, "image") ? modelCapabilityConfigFor(config, model).image : undefined;
    const normalized = profile ? normalizeImageValue(profile, selection) : selection;
    return { model, size: normalized.size, quality: normalized.quality, extraPrompt: saved?.extraPrompt || "" };
}

export function projectAssetImageConfig(config: AiConfig, preset: ProjectAssetImagePreset): AiConfig {
    if (!configuredModelMatchesCapability(config, preset.model, "image")) throw new Error("已保存的图片模型不可用，请在统一生图设置中重新选择");
    const profile = modelCapabilityConfigFor(config, preset.model).image;
    const selection = profile ? normalizeImageValue(profile, { ...preset, count: "1" }) : preset;
    return { ...config, model: preset.model, imageModel: preset.model, size: selection.size, quality: selection.quality, count: "1", taskWorkflowProvider: "model" };
}

export function activeProjectAssetImageIds(tasks: GenerationTask[]) {
    return new Set(tasks.filter((task) => ["queued", "running"].includes(task.status) && /^(project-asset-image|character-turnaround):/.test(task.clientContext?.nodeId || "")).map((task) => task.clientContext!.nodeId!.split(":").slice(1).join(":")));
}

export function projectAssetHasImage(asset: ProjectAsset) {
    return asset.character ? asset.character.representations.some((item) => item.mediaType === "image" || ["primary", "turnaround_sheet", "front", "side", "back"].includes(item.role)) : asset.mediaType === "image" && Boolean(asset.storageKey);
}

export function planProjectAssetImageBatch(assets: ProjectAsset[], category: ProjectAssetImageCategory, activeIds: Set<string>, missingOnly: boolean) {
    const candidates = assets.filter((asset) => projectAssetImageCategory(asset) === category && (asset.character ? Boolean(asset.character.versionId) : canGenerateProjectAssetImage(asset)));
    const eligible = [...new Map(candidates.map((asset) => [asset.id, asset])).values()];
    return {
        assets: eligible.filter((asset) => !activeIds.has(asset.id) && (!missingOnly || !projectAssetHasImage(asset))),
        activeCount: eligible.filter((asset) => activeIds.has(asset.id)).length,
        existingCount: eligible.filter((asset) => !activeIds.has(asset.id) && projectAssetHasImage(asset)).length,
    };
}
