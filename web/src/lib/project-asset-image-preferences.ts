export const PROJECT_ASSET_IMAGE_CATEGORIES = ["character", "environment", "prop"] as const;
export type ProjectAssetImageCategory = (typeof PROJECT_ASSET_IMAGE_CATEGORIES)[number];
export type ProjectAssetImagePreset = { model: string; size: string; quality: string; extraPrompt: string };
export type ProjectAssetImagePresets = Partial<Record<ProjectAssetImageCategory, ProjectAssetImagePreset>>;
export const projectAssetImageCategoryLabels = { character: "角色", environment: "场景", prop: "道具" };

export function normalizeProjectAssetImagePresets(value: unknown): ProjectAssetImagePresets {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: ProjectAssetImagePresets = {};
    for (const category of PROJECT_ASSET_IMAGE_CATEGORIES) {
        const preset = (value as Record<string, unknown>)[category];
        if (!preset || typeof preset !== "object" || Array.isArray(preset)) continue;
        const fields = preset as Record<string, unknown>;
        const text = (key: string) => typeof fields[key] === "string" ? fields[key] as string : "";
        result[category] = { model: text("model"), size: text("size"), quality: text("quality"), extraPrompt: text("extraPrompt") };
    }
    return result;
}
