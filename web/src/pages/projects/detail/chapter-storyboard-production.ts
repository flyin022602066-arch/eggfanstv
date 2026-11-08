import type { StoryboardRow } from "@/types/canvas";
import { formatShotOrdinal } from "@/lib/shot-label";
import { normalizeProjectAssetMentions } from "@/lib/project-asset-mentions";
import { matchProjectShotSequenceAssets, type ShotAssetMatchOptions } from "@/lib/project-shot-asset-matching";
import { extractChapterSystemInterfaceProps } from "@/lib/chapter-system-interface";
import { systemPresentationRule, type SystemPresentationSettings } from "@/lib/chapter-system-presentation";
import type { ProjectDetail, ShotRevisionInput } from "@/services/api/projects";
import { ensureShotAssetMentionPrompt } from "./workflow-shot-references";
import { characterLookCandidates, referenceVersionDescription } from "@/lib/character-look-selection";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";

export type ChapterStoryboardAsset = {
    id: string;
    title: string;
    type: "image" | "video" | "audio" | "character" | "text";
    category?: string;
    tags: string[];
    prompt: string;
    aliases?: string[];
    characterAssetId?: string;
    characterVersionId?: string;
    characterLooks?: Array<{ versionId: string; lookId: string; name: string; description: string; matchHints: string; excludeHints: string; default: boolean }>;
};

export type ChapterStoryboardCharacter = {
    assetId?: string;
    versionId?: string;
    name: string;
    definition: Record<string, unknown>;
};

export type ProjectShotReplacementInput = {
    title: string;
    description: string;
    durationMs: number;
    revision: ShotRevisionInput;
    assetVersionIds: string[];
};

export type ChapterStoryboardReplaceImpact = {
    shotCount: number;
    revisionCount: number;
    referenceCount: number;
    artifactCount: number;
    candidateCount: number;
};

export function chapterStoryboardCharacters(detail: ProjectDetail, unitId?: string): ChapterStoryboardCharacter[] {
    const confirmed = detail.assets.flatMap((asset): ChapterStoryboardCharacter[] => {
        const card = asset.character;
        if (asset.category !== "character" || !card?.versionId) return [];
        return [{ assetId: asset.id, versionId: card.versionId, name: asset.title, definition: card.definition || {} }];
    });
    const seenNames = new Set(confirmed.map((character) => normalizeCharacterName(character.name)));
    const pending = detail.assetCandidates.flatMap((candidate): ChapterStoryboardCharacter[] => {
        if (candidate.category !== "character" || candidate.status !== "pending_confirmation") return [];
        if (unitId && candidate.unitId && candidate.unitId !== unitId) return [];
        const name = candidate.name.trim();
        const normalizedName = normalizeCharacterName(name);
        if (!normalizedName || seenNames.has(normalizedName)) return [];
        seenNames.add(normalizedName);
        return [{ name, definition: candidateDefinition(candidate.detailsJson) }];
    });
    return [...confirmed, ...pending];
}

export function chapterStoryboardAssets(detail: ProjectDetail, versions: CharacterReferenceVersion[] = []): ChapterStoryboardAsset[] {
    const looks = characterLookCandidates(versions);
    return detail.assets.flatMap((asset): ChapterStoryboardAsset[] => {
        if (!["character", "environment", "prop"].includes(asset.category)) return [];
        const type = storyboardAssetType(asset.mediaType, asset.category);
        if (!type || (type !== "character" && !asset.primaryVersionId)) return [];
        const characterVersionId = asset.character?.versionId;
        if (type === "character" && !characterVersionId) return [];
        const definition = asset.character?.definition || candidateDefinition(asset.definitionJson || "{}");
        const aliases = Array.isArray(definition.aliases) ? definition.aliases.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
        return [{
            id: asset.id,
            title: asset.title,
            type,
            category: asset.category || undefined,
            tags: [],
            prompt: assetPrompt(asset.previewText, asset.character?.definition, asset.title),
            ...(aliases.length ? { aliases } : {}),
            ...(type === "character" ? { characterAssetId: asset.id, characterVersionId } : {}),
            ...(type === "character" && versions.some((version) => version.assetId === asset.id && version.referenceProfile) ? { characterLooks: looks.filter((version) => version.assetId === asset.id).map((version) => ({ versionId: version.versionId, lookId: version.referenceProfile!.lookId, name: version.referenceProfile!.name, description: referenceVersionDescription(version), matchHints: version.referenceProfile!.matchHints, excludeHints: version.referenceProfile!.excludeHints, default: version.referenceProfile!.default })) } : {}),
        }];
    });
}

export function storyboardRowsToProjectShots(rows: StoryboardRow[], detail?: ProjectDetail, versions?: CharacterReferenceVersion[], matchOptions?: ShotAssetMatchOptions): ProjectShotReplacementInput[] {
    if (versions) for (const row of rows) {
        const seen = new Set<string>();
        for (const character of row.characters || []) {
            if (!character.characterAssetId) continue;
            if (seen.has(character.characterAssetId)) throw new Error("同一镜头出现同一角色的多个版本，请拆镜头后再写入");
            seen.add(character.characterAssetId);
            if (character.characterVersionId && !versions.some((version) => version.assetId === character.characterAssetId && version.versionId === character.characterVersionId)) throw new Error("分镜选择了不属于该角色的版本，请重新生成或修正造型引用");
        }
    }
    rows = rows.map((row) => ({
        ...row,
        sceneAssetId: !row.sceneName?.trim() || detail?.assets.some((asset) => asset.id === row.sceneAssetId && asset.category === "environment" && asset.primaryVersionId) ? row.sceneAssetId : undefined,
        imageGenerationPrompt: normalizeProjectAssetMentions(row.imageGenerationPrompt, detail?.assets || []),
        videoMotionPrompt: normalizeProjectAssetMentions(row.videoMotionPrompt, detail?.assets || []),
    }));
    const mentionReferenceByAssetId = new Map((detail?.assets || []).map((asset) => [asset.id, {
        assetId: asset.id,
        kind: asset.category === "character" ? "character" as const : "image" as const,
        label: asset.title,
        title: asset.title,
    }]));
    const shotMatches = matchProjectShotSequenceAssets(detail?.assets || [], rows.map((row) => ({ script: {
        ...row,
        action: joinStoryboardAction(row, false),
        imagePrompt: row.imageGenerationPrompt,
        videoPrompt: row.videoMotionPrompt,
    } })), matchOptions);
    return rows.map((row, index) => {
        const shotNumber = index + 1;
        const description = row.plotDescription.trim() || `镜头 ${shotNumber}`;
        const durationMs = Math.max(1000, Math.round((Number(row.durationSeconds) || 1) * 1000));
        const matches = shotMatches[index]!;
        const scene = matches.find(({ asset }) => asset.category === "environment")?.asset;
        const assetContext = scene || row.sceneName || row.propNames ? [{
            type: "asset_context",
            sceneAssetId: scene?.id || "",
            sceneName: row.sceneName || scene?.title || "",
            sceneChange: Boolean(row.sceneChange),
            ...(row.propNames ? { propNames: row.propNames } : {}),
        }] : [];
        const systemContext = row.systemElements?.length ? [{
            type: "system_elements",
            elements: row.systemElements,
            ...(row.systemPresentation?.mode === "character" ? { presentation: row.systemPresentation } : {}),
        }] : [];
        const mentionReferences = matches.flatMap(({ asset }) => {
            const reference = mentionReferenceByAssetId.get(asset.id);
            return reference ? [reference] : [];
        });
        return {
            title: formatShotOrdinal(index),
            description,
            durationMs,
            assetVersionIds: matches.map((match) => match.assetVersionId),
            revision: {
                plotDescription: description,
                action: joinStoryboardAction(row),
                dialogue: row.dialogue.trim(),
                shotSize: row.shotSize.trim(),
                cameraAngle: row.camera.trim(),
                cameraMovement: row.motion.trim(),
                durationMs,
                imagePrompt: ensureSystemElementsInPrompt(row.imageGenerationPrompt, row.systemElements, row.systemPresentation),
                videoPrompt: ensureSystemElementsInPrompt(ensureShotAssetMentionPrompt(row.videoMotionPrompt, mentionReferences, detail?.assets), row.systemElements, row.systemPresentation),
                negativePrompt: row.negativePrompt.trim(),
                continuityNotes: row.continuityOut.trim(),
                actionBeats: [...(row.timeBeats.trim() ? [{ description: row.timeBeats.trim() }] : []), ...assetContext, ...systemContext],
            },
        };
    });
}

export function chapterStoryboardReplaceImpact(detail: ProjectDetail, unitId: string): ChapterStoryboardReplaceImpact {
    const shots = detail.shots.filter((shot) => shot.unitId === unitId);
    const shotIds = new Set(shots.map((shot) => shot.id));
    return {
        shotCount: shots.length,
        revisionCount: detail.shotRevisions.filter((revision) => shotIds.has(revision.shotId)).length,
        referenceCount: detail.shotReferences.filter((reference) => shotIds.has(reference.shotId)).length,
        artifactCount: detail.shotArtifacts.filter((artifact) => artifact.unitId === unitId).length,
        candidateCount: detail.assetCandidates.filter((candidate) => Boolean(candidate.shotId && shotIds.has(candidate.shotId))).length,
    };
}

function storyboardAssetType(mediaType: string, category: string): ChapterStoryboardAsset["type"] | null {
    if (category === "character") return "character";
    if (["environment", "prop"].includes(category) && mediaType === "text") return "text";
    if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return mediaType;
    return null;
}

function assetPrompt(previewText: string | undefined, definition: Record<string, unknown> | undefined, title: string) {
    const preview = previewText?.replace(/\s+/g, " ").trim();
    if (preview) return preview.slice(0, 600);
    if (definition && Object.keys(definition).length) return JSON.stringify(definition).slice(0, 600);
    return title.trim();
}

function candidateDefinition(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function normalizeCharacterName(value: string) {
    return value.trim().toLocaleLowerCase();
}

function joinStoryboardAction(row: StoryboardRow, includeSystemElements = true) {
    return [
        labeledText("叙事意图", row.narrativeIntent),
        labeledText("表演调度", row.performanceBlocking),
        labeledText("镜头序列", row.timeBeats),
        labeledText("情绪", row.emotion),
        labeledText("光线与氛围", row.lightingAndAtmosphere),
        labeledText("声音", row.audioEffects),
        includeSystemElements && row.systemElements?.length ? `系统/界面元素：\n${row.systemElements.join("\n")}` : "",
    ].filter(Boolean).join("\n");
}

function ensureSystemElementsInPrompt(prompt: string, systemElements?: string[], presentation?: SystemPresentationSettings) {
    const text = prompt.trim();
    const elements = (systemElements || []).map((element) => element.trim()).filter(Boolean);
    if (!elements.length) return text;
    const missingElements = elements.filter((element) => !text.includes(element));
    if (!missingElements.length && text.includes("【系统/界面元素】")) return text;
    return [
        text,
        "【系统/界面元素】",
        ...(missingElements.length ? missingElements : ["以上原文已在提示词中，必须保留其画面表现。"]),
        presentation?.mode === "character" ? systemPresentationRule(presentation) : extractChapterSystemInterfaceProps(elements.join("\n")).length
            ? "将其作为本镜画面内的系统界面、状态面板或提示框表现，不得删除或改写。参考图仅复用外框与布局，不得照抄其中的旧文字、旧数值或主体形态，本镜状态按以上原文更新，未给出的数值留空。"
            : "按原文保留提示音或播报，未明确可见表现时不额外添加画面元素。",
    ].filter(Boolean).join("\n");
}

function labeledText(label: string, value: string) {
    const text = value.trim();
    return text ? `${label}：${text}` : "";
}
