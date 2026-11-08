import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assetCategoryLabel, normalizeAssetCategory } from "@/lib/asset-category";
import { normalizeProjectAssetMentions, pruneUnboundGeneratedCharacterReferences, unresolvedProjectAssetMentions, type ProjectAssetMentionAsset } from "@/lib/project-asset-mentions";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { ProjectAsset, ProjectDetail, ShotAssetReference } from "@/services/api/projects";
import type { AssetCategory } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";
import { characterReferenceImage, characterReferenceNeedsReview } from "@/lib/character-look-selection";

export type ShotAssetReferenceContext = {
    boundAssetIds?: string[];
    mentionReferences: CanvasResourceReference[];
    referenceImages: ReferenceImage[];
    referenceAudios: ReferenceAudio[];
    assetReferences: ShotPromptAssetReference[];
    resolvedCharacterVersions: Array<{ assetId: string; versionId: string }>;
    missingImageTitles: string[];
    selectionIssues?: string[];
    characterReferenceSnapshot?: Array<{ assetId: string; versionId: string; resourceId: string; lookId?: string; lookName?: string; reason?: string; locked: boolean }>;
    assetCatalog?: Array<{ id: string; title: string; category?: string }>;
};

export type ShotPromptAssetReference = {
    assetId: string;
    title: string;
    category: string;
    imageIndex: number;
    audioIndex?: number;
    voiceDescription?: string;
    dialogue?: string;
    lookDescription?: string;
};

export function buildShotAssetReferenceContext(detail: ProjectDetail, shotId: string): ShotAssetReferenceContext {
    const assetByVersionId = new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset]));
    const seenAssetIds = new Set<string>();
    const missingImageTitles: string[] = [];
    const selectionIssues: string[] = [];
    const shot = detail.shots?.find((item) => item.id === shotId);
    const shotRevision = detail.shotRevisions?.find((item) => item.id === shot?.currentRevisionId);
    const references = (detail.shotReferences || []).filter((reference) => reference.shotId === shotId && reference.status === "linked" && reference.role === "reference");
    const boundAsset = (reference: ShotAssetReference) => reference.asset || detail.assets.find((asset) => asset.id === reference.referencedVersion?.assetId) || assetByVersionId.get(reference.assetVersionId);
    for (const reference of references) {
        const asset = boundAsset(reference);
        if (asset?.category !== "character") continue;
        if (references.filter((other) => boundAsset(other)?.id === asset.id).length > 1) selectionIssues.push(`${asset.title}绑定了多个造型版本，请确认单一版本；变身或双版本同框请拆镜头`);
        if (characterReferenceNeedsReview(reference, shot?.currentRevisionId || "")) selectionIssues.push(`${asset.title}的造型待确认，请重新识别或手动选择`);
        if (reference.referencedVersion?.referenceProfile && !reference.selectionStatus) selectionIssues.push(`${asset.title}尚未确认造型，请识别或手动选择`);
    }
    const entries = (detail.shotReferences || []).flatMap((reference) => {
        if (!references.includes(reference)) return [];
        const asset = boundAsset(reference);
        if (!asset || seenAssetIds.has(asset.id)) return [];
        seenAssetIds.add(asset.id);
        const image = projectAssetReferenceImage(asset, reference, /特写|近景|close/iu.test(shotRevision?.shotSize || ""));
        if (!image) {
            if (["character", "environment", "prop"].includes(asset.category)) missingImageTitles.push(asset.title);
            return [];
        }
        return [{ asset, image, reference }];
    });

    const referenceAudios: ReferenceAudio[] = [];
    const audioIndexByResourceId = new Map<string, number>();
    const assetReferences = entries.map(({ asset, reference }, index) => {
        const historical = reference.referencedVersion;
        const voice = historical ? historical.voice : reference.assetVersionId === asset.character?.versionId ? asset.character.voice : undefined;
        const sampleResourceId = stringValue(voice?.profile.sampleResourceId);
        let audioIndex: number | undefined;
        if (sampleResourceId) {
            audioIndex = audioIndexByResourceId.get(sampleResourceId);
            if (!audioIndex) {
                audioIndex = referenceAudios.length + 1;
                audioIndexByResourceId.set(sampleResourceId, audioIndex);
                referenceAudios.push({
                    id: `project-character-voice:${asset.id}`,
                    name: `${asset.title}-声音样本`,
                    type: "audio/*",
                    url: resourceFileUrl(sampleResourceId),
                    storageKey: resourceStorageKey(sampleResourceId),
                });
            }
        }
        return {
            assetId: asset.id,
            title: asset.title,
            category: asset.category,
            imageIndex: index + 1,
            ...(audioIndex ? { audioIndex } : {}),
            ...(asset.character ? { voiceDescription: characterVoiceDescription(asset, reference), lookDescription: [historical?.referenceProfile?.name, historical?.referenceProfile?.description].filter(Boolean).join("；") } : {}),
        } satisfies ShotPromptAssetReference;
    });

    return {
        boundAssetIds: [...new Set(references.flatMap((reference) => {
            const assetId = boundAsset(reference)?.id || reference.referencedVersion?.assetId;
            return assetId ? [assetId] : [];
        }))],
        mentionReferences: entries.map(({ asset, image }) => ({
            id: `project-asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind: asset.character ? "character" : "image",
            label: asset.title,
            title: asset.title,
            previewUrl: image.url,
            storageKey: image.storageKey,
            active: true,
            category: projectAssetCategory(asset.category),
        })),
        referenceImages: entries.map(({ image }) => image),
        referenceAudios,
        missingImageTitles,
        selectionIssues: [...new Set(selectionIssues)],
        characterReferenceSnapshot: entries.flatMap(({ asset, reference, image }) => asset.category === "character" ? [{ assetId: asset.id, versionId: reference.assetVersionId, resourceId: resourceIdFromStorageKey(image.storageKey || "") || "", lookId: reference.referencedVersion?.referenceProfile?.lookId, lookName: reference.referencedVersion?.referenceProfile?.name, reason: reference.selectionReason, locked: Boolean(reference.selectionLocked) }] : []),
        assetReferences,
        resolvedCharacterVersions: entries.flatMap(({ asset, reference }) => asset.character ? [{ assetId: asset.id, versionId: reference.referencedVersion?.id || reference.assetVersionId || asset.character.versionId }] : []),
        assetCatalog: detail.assets.map((asset) => ({ id: asset.id, title: asset.title, category: asset.category })),
    };
}

export function resolveShotAssetMentionPrompt(prompt: string, context: ShotAssetReferenceContext, options: { dialogue?: string; interfaceType?: string } = {}) {
    if (context.selectionIssues?.length) throw new Error(context.selectionIssues.join("；"));
    if (context.missingImageTitles.length) throw new Error(`已绑定资产 ${context.missingImageTitles.join("、")} 缺少参考图，请先在角色与资产中生成或上传图片`);
    const useAtMentions = options.interfaceType === "jiasu-video";
    const imageLabelByAssetId = new Map(context.mentionReferences.map((reference, index) => [reference.assetId, `${useAtMentions ? "@" : ""}图片${index + 1}`]));
    const assets = [...(context.assetCatalog || []), ...context.mentionReferences.flatMap((reference) => reference.assetId ? [{ id: reference.assetId, title: reference.title || reference.label }] : [])];
    const normalized = pruneUnboundGeneratedCharacterReferences(normalizeProjectAssetMentions(prompt, assets), assets, context.mentionReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
    const unresolved = unresolvedProjectAssetMentions(normalized, assets, context.mentionReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
    if (unresolved.length) {
        const unresolvedDetails = unresolved.map(({ title, assetId }) => `${title}（资产 ID：${assetId}）`);
        throw new Error(`提示词中的 ${unresolvedDetails.join("、")} 未绑定到当前镜头，请重新选择资产或删除引用`);
    }
    const resolved = normalized.replace(/@\[asset:([^\]]+)\]/gu, (_token, assetId: string) => imageLabelByAssetId.get(assetId)!);
    const dialogueContext = withShotDialogue(context.assetReferences, options.dialogue);
    const assetBlock = compileShotAssetReferencePrompt(dialogueContext.references, useAtMentions);
    const dialogueBlock = dialogueContext.unassignedDialogue ? `【镜头台词】\n\n${dialogueContext.unassignedDialogue}` : "";
    return [resolved.trim(), assetBlock, dialogueBlock].filter(Boolean).join("\n\n");
}

export function ensureShotAssetMentionPrompt(prompt: string, references: Array<Pick<CanvasResourceReference, "assetId" | "kind" | "label" | "title">>, catalog: ProjectAssetMentionAsset[] = [], boundAssetIds = references.flatMap((reference) => reference.assetId ? [reference.assetId] : [])) {
    const assets = [...catalog, ...references.flatMap((reference) => reference.assetId ? [{ id: reference.assetId, title: reference.title || reference.label }] : [])];
    const value = pruneUnboundGeneratedCharacterReferences(normalizeProjectAssetMentions(prompt, assets), assets, boundAssetIds).trim();
    if (!value) return "";
    const mentionedAssetIds = new Set(Array.from(value.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]));
    const missing = references.filter((reference): reference is typeof reference & { assetId: string } => Boolean(reference.assetId && !mentionedAssetIds.has(reference.assetId)));
    if (!missing.length) return value;
    const block = (title: string, items: typeof missing) => items.length
        ? [title, ...items.map((reference) => `${reference.title || reference.label}：@[asset:${reference.assetId}]`)].join("\n")
        : "";
    const characters = missing.filter((reference) => reference.kind === "character");
    const otherAssets = missing.filter((reference) => reference.kind !== "character");
    return [value, block("【角色参考】", characters), block("【场景与道具参考】", otherAssets)].filter(Boolean).join("\n\n");
}

export function compileShotAssetReferencePrompt(references: ShotPromptAssetReference[], useAtMentions = false) {
    if (!references.length) return "";
    const lines = references.flatMap((reference) => {
        const visualLabel = reference.category === "character" ? "人物参考" : `${projectAssetCategoryLabel(reference.category)}参考`;
        const prefix = useAtMentions ? "@" : "";
        const media = [`${visualLabel}：${prefix}图片${reference.imageIndex}`, reference.audioIndex ? `声音参考：${prefix}音频${reference.audioIndex}` : ""].filter(Boolean).join("；");
        return [
            `- ${reference.title}：${media}`,
            reference.lookDescription ? `  本镜造型：${reference.lookDescription}` : "",
            reference.voiceDescription ? `  声音画像：${reference.voiceDescription}` : "",
            reference.dialogue ? `  镜头台词：${reference.dialogue}` : "",
        ].filter(Boolean);
    });
    return ["【资产参考】", "", ...lines].join("\n");
}

function projectAssetReferenceImage(asset: ProjectAsset, reference?: ShotAssetReference, closeUp = false): ReferenceImage | undefined {
    const boundRepresentations = reference?.referencedVersion?.representations;
    const representation = characterReferenceImage({ representations: boundRepresentations || (asset.character && reference?.assetVersionId === asset.character.versionId ? asset.character.representations : []) }, closeUp);
    if (representation) {
        return {
            id: asset.id,
            name: asset.title,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(representation.resourceId),
            storageKey: resourceStorageKey(representation.resourceId),
        };
    }
    if (asset.category === "character" || reference?.assetVersionId !== asset.primaryVersionId || asset.mediaType !== "image" || !asset.storageKey) return undefined;
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return {
        id: asset.id,
        name: asset.title,
        type: "image/*",
        dataUrl: "",
        ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}),
        storageKey: asset.storageKey,
    };
}

function withShotDialogue(references: ShotPromptAssetReference[], dialogue?: string) {
    const value = stringValue(dialogue);
    if (!value) return { references, unassignedDialogue: "" };
    const characters = references.filter((reference) => reference.category === "character");
    if (characters.length === 1 && !/[：:]/u.test(value)) {
        return {
            references: references.map((reference) => reference.assetId === characters[0]?.assetId ? { ...reference, dialogue: value } : reference),
            unassignedDialogue: "",
        };
    }
    const resolved = references.map((reference) => {
        if (reference.category !== "character") return reference;
        const matched = dialogueForCharacter(value, reference.title);
        return matched ? { ...reference, dialogue: matched } : reference;
    });
    return {
        references: resolved,
        unassignedDialogue: value.split(/\r?\n/u).filter((line) => line.trim() && !characters.some((reference) => dialogueForCharacter(line, reference.title))).join("\n"),
    };
}

function dialogueForCharacter(dialogue: string, characterName: string) {
    const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[：:]\\s*([^\\n]+)`, "g");
    return Array.from(dialogue.matchAll(pattern), (match) => match[1]?.trim()).filter(Boolean).join("；");
}

function projectAssetCategory(value: string): AssetCategory {
    return normalizeAssetCategory(value);
}

function projectAssetCategoryLabel(value: string) {
    return assetCategoryLabel(value);
}

function characterVoiceDescription(asset: ProjectAsset, reference: ShotAssetReference) {
    const historical = reference.referencedVersion;
    const current = reference.assetVersionId === asset.character?.versionId ? asset.character : undefined;
    const definition = historical?.definition || current?.definition || {};
    const voice = historical ? historical.voice : current?.voice;
    return [
        stringValue(definition.voiceLanguage) || stringValue(voice?.profile.language),
        stringValue(definition.voiceAge),
        stringValue(definition.voiceTimbre) || stringValue(voice?.profile.timbre),
        stringValue(voice?.instructions),
    ].filter(Boolean).join("；");
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
