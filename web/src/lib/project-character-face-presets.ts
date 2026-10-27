import type { ReferenceImage } from "@/types/image";

export const CHARACTER_FACE_ROLES = ["male", "female"] as const;
export type CharacterFaceRole = typeof CHARACTER_FACE_ROLES[number];
export type CharacterFacePreset = { resourceId: string; fileName?: string; assetIds: string[] };
export type CharacterFacePresets = Partial<Record<CharacterFaceRole, CharacterFacePreset>>;
export const characterFaceRoleLabels: Record<CharacterFaceRole, string> = { male: "男主", female: "女主" };

export function parseCharacterFacePresets(raw?: string): CharacterFacePresets {
    if (!raw?.trim()) return {};
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("主角人脸预设损坏，请重新设置后生成"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("主角人脸预设格式无效，请重新设置");
    const result: CharacterFacePresets = {};
    const bound = new Set<string>();
    for (const [role, item] of Object.entries(value)) {
        if (!CHARACTER_FACE_ROLES.includes(role as CharacterFaceRole) || !item || typeof item !== "object") throw new Error("主角人脸预设格式无效，请重新设置");
        const preset = item as CharacterFacePreset;
        if (typeof preset.resourceId !== "string" || !preset.resourceId.trim() || !Array.isArray(preset.assetIds) || preset.assetIds.some((assetId) => typeof assetId !== "string" || !assetId.trim())) throw new Error("主角人脸参考图或绑定角色无效，请重新设置");
        const assetIds = [...new Set(preset.assetIds.map((assetId) => assetId.trim()))];
        for (const assetId of assetIds) {
            if (bound.has(assetId)) throw new Error("同一角色不能同时绑定男主和女主的人脸");
            bound.add(assetId);
        }
        result[role as CharacterFaceRole] = { resourceId: preset.resourceId.trim(), fileName: typeof preset.fileName === "string" ? preset.fileName : undefined, assetIds };
    }
    return result;
}

export function characterFacePresetForAsset(raw: string | undefined, assetId: string) {
    const presets = parseCharacterFacePresets(raw);
    for (const role of CHARACTER_FACE_ROLES) {
        const preset = presets[role];
        if (preset?.assetIds.includes(assetId)) return { ...preset, role };
    }
    return undefined;
}

export function characterFaceReference(preset: CharacterFacePreset & { role: CharacterFaceRole }): ReferenceImage {
    return { id: `character-face-${preset.resourceId}`, name: `${characterFaceRoleLabels[preset.role]}人脸参考`, type: "image/*", dataUrl: "", storageKey: `resource:${preset.resourceId}` };
}

export function characterFaceDesignConstraint(name: string, role: CharacterFaceRole) {
    return `【主角预设人脸与服装造型设计】\n随请求提供的“${characterFaceRoleLabels[role]}人脸参考”图片是角色“${name}”的面孔身份依据。独立头部特写必须保留该图的脸型、五官比例、眼鼻口和可辨认的面部特征，呈现同一个人；角色设定中的泛化外貌描述不能把参考面孔改成另一个人。只借用人脸身份，不照搬参考照片的服装、饰品、姿势、背景、摄影风格或构图。以小说剧本中的身份、时代、体型、气质和当前角色设定设计服装、发型、配饰与造型；项目画风决定渲染媒介。参考面孔与时代造型共同构成该角色。仅使用当前角色绑定的人脸，不混合男女主，不增加另一位主角。仍严格输出独立头部特写＋不含头部的正、侧、背身体三视图，四区造型一致。`;
}
