import { characterReferenceImage } from "./character-look-selection";
import { hasCombinedCharacterLooks } from "./character-reference-generation";
import { characterAssetType } from "./character-asset-type";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";

function sameLook(left: CharacterReferenceVersion, right: CharacterReferenceVersion) {
    if (left.referenceProfile?.lookId && right.referenceProfile?.lookId) return left.referenceProfile.lookId === right.referenceProfile.lookId;
    return ["clothing", "ageStage", "age", "hairstyle", "state"].every((key) => String(left.definition[key] || "").trim() === String(right.definition[key] || "").trim());
}

export function characterIdentitySource(versions: CharacterReferenceVersion[], assetId: string, versionId: string) {
    const ordered = versions.filter((version) => version.assetId === assetId).slice().sort((left, right) => left.version - right.version);
    const target = ordered.find((version) => version.versionId === versionId);
    if (target && characterAssetType(target.title, target.definition) === "group") return { base: target, target, reference: undefined, image: undefined, canCreateBase: true };
    if (target && hasCombinedCharacterLooks(target.definition)) throw new Error("当前设定包含多套造型，请先拆分，再逐套生成图片");
    const base = ordered.find((version) => !hasCombinedCharacterLooks(version.definition));
    if (!base || !target) throw new Error("角色版本已变化，请刷新角色造型后重试");
    const baseGroup = ordered.filter((version) => version.version < base.version || sameLook(version, base));
    const reference = baseGroup.find((version) => characterReferenceImage(version));
    const image = reference && characterReferenceImage(reference);
    return { base, target, reference, image, canCreateBase: sameLook(target, base) };
}

export function characterIdentityConstraint(name: string) {
    return `【基础版身份继承／图片编辑】参考图是${name}的基础版，必须以此图编辑出同一人物的新造型，不得重新设计一个新角色。保留脸型、五官比例、眼鼻口、面部辨识特征与人物身份；服装、姿态、道具和普通伤态变化不构成换脸理由。参考图用于锁定身份，不照搬基础服装、动作或背景，按本次单套设定修改。只有本次剧本或用户设定明确说明头部变化时，才修改明确指定的发型、头饰、疤痕、年龄或变身部位；未说明的面部特征仍沿用基础版，禁止推测、额外换脸或混合其他人物。所有视图保持同一套造型，具体排版严格使用本次所选角色参考图格式，不照搬基础图的旧排版。`;
}

export function characterLookGenerationDefinition(base: CharacterReferenceVersion, target: CharacterReferenceVersion, definition: Record<string, unknown>) {
    if (sameLook(base, target)) return definition;
    const result = { ...definition };
    const inherited = ["appearance", "props"].flatMap((key) => {
        const value = String(definition[key] || "").trim();
        if (!value || value !== String(base.definition[key] || "").trim()) return [];
        delete result[key];
        return [value];
    });
    for (const key of ["consistencyPrompt", "multiViewPrompt"]) {
        const value = String(definition[key] || "").trim();
        result[key] = value === String(base.definition[key] || "").trim() ? "" : inherited.reduce((prompt, fragment) => {
            const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return prompt.replace(new RegExp(`(^|[：:；;\\n])\\s*${escaped}(?=\\s*(?:[；;。\\n]|$))`, "gu"), "$1");
        }, value);
    }
    return result;
}

export function characterLookEditConstraint(base: CharacterReferenceVersion, target: CharacterReferenceVersion, definition: Record<string, unknown>) {
    const fields = [["appearance", "外观与身体结构"], ["clothing", "服装与配件"], ["state", "当前形态状态"], ["hairstyle", "发型"], ["ageStage", "年龄阶段"], ["age", "年龄"], ["physique", "体型"], ["props", "随身道具"]] as const;
    const changes = fields.flatMap(([key, label]) => {
        const current = String(definition[key] || "").trim();
        const previous = String(base.definition[key] || "").trim();
        if (key === "props" && typeof definition[key] === "string" && !current && previous) return ["随身道具：无；移除基础参考图中的随身道具与外加装备，保留身体固有结构"];
        return current && current !== previous ? [`${label}：${current}`] : [];
    });
    if (!changes.length) return "";
    return `【本次造型编辑清单：${target.referenceProfile?.name || `v${target.version}`}】\n保持基础参考图的同一人物身份与未明确改变的五官；以下是本次必须落实到画面中的变化：\n${changes.join("\n")}\n当前造型的明确设定优先于参考图的旧服装、配件和身体状态，也优先于画风中的常规一致性要求。已去除或替换的旧物必须从全部头部与身体视图移除；新增或重铸的结构须在对应视图清楚展示。保持同一人脸不能成为照抄整张参考图的理由，不得只改变标题或背景而保留旧造型。仅执行上述已明确的变化，不自行添加其他变化。`;
}
