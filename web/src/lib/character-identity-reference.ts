import { characterReferenceImage } from "./character-look-selection";
import { hasCombinedCharacterLooks } from "./character-reference-generation";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";

function sameLook(left: CharacterReferenceVersion, right: CharacterReferenceVersion) {
    if (left.referenceProfile?.lookId && right.referenceProfile?.lookId) return left.referenceProfile.lookId === right.referenceProfile.lookId;
    return ["clothing", "ageStage", "age", "hairstyle", "state"].every((key) => String(left.definition[key] || "").trim() === String(right.definition[key] || "").trim());
}

export function characterIdentitySource(versions: CharacterReferenceVersion[], assetId: string, versionId: string) {
    const ordered = versions.filter((version) => version.assetId === assetId).slice().sort((left, right) => left.version - right.version);
    const target = ordered.find((version) => version.versionId === versionId);
    if (target && hasCombinedCharacterLooks(target.definition)) throw new Error("当前设定包含多套造型，请先拆分，再逐套生成图片");
    const base = ordered.find((version) => !hasCombinedCharacterLooks(version.definition));
    if (!base || !target) throw new Error("角色版本已变化，请刷新角色造型后重试");
    const baseGroup = ordered.filter((version) => version.version < base.version || sameLook(version, base));
    const reference = baseGroup.find((version) => characterReferenceImage(version));
    const image = reference && characterReferenceImage(reference);
    return { base, target, reference, image, canCreateBase: sameLook(target, base) };
}

export function characterIdentityConstraint(name: string) {
    return `【基础版身份继承／图片编辑】参考图是${name}的基础版，必须以此图编辑出同一人物的新造型，不得重新设计一个新角色。保留脸型、五官比例、眼鼻口、面部辨识特征与人物身份；服装、姿态、道具和普通伤态变化不构成换脸理由。参考图用于锁定身份，不照搬基础服装、动作或背景，按本次单套设定修改。只有本次剧本或用户设定明确说明头部变化时，才修改明确指定的发型、头饰、疤痕、年龄或变身部位；未说明的面部特征仍沿用基础版，禁止推测、额外换脸或混合其他人物。独立头部特写与正侧背身体三视图保持同一套造型，身体三视图不含头部。`;
}
