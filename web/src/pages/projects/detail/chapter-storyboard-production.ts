import type { StoryboardRow } from "@/types/canvas";
import { formatShotOrdinal } from "@/lib/shot-label";
import { resolveShotCameraLanguage } from "@/lib/shot-camera-language";
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

export type StoryboardCharacterReferenceIssue = {
    key: string;
    shotLabel: string;
    characterName: string;
    assetId: string;
    versionId: string;
    reason: string;
    candidates: CharacterReferenceVersion[];
};

export class StoryboardCharacterReferenceError extends Error {
    constructor(public issues: StoryboardCharacterReferenceIssue[]) {
        super(issues.map((issue) => `${issue.shotLabel} · 角色“${issue.characterName}”（资产 ID：${issue.assetId}）· 返回版本 ID：${issue.versionId}：${issue.reason}。请在核对窗口选择该角色的正确版本，无需重新生成。`).join("\n"));
        this.name = "StoryboardCharacterReferenceError";
    }
}

export function repairStoryboardCharacterReferences(rows: StoryboardRow[], detail: ProjectDetail, versions: CharacterReferenceVersion[]) {
    const repairs: Array<{ shotLabel: string; characterName: string; previousVersionId: string; versionId: string }> = [];
    const repairedRows = reviewStoryboardCharacterReferences(rows, detail, versions).rows.map((row, rowIndex) => ({
        ...row,
        characters: (row.characters || []).map((character) => {
            const assetId = character.characterAssetId;
            if (!assetId || !detail.assets.some((asset) => asset.id === assetId && asset.category === "character")) return character;
            if (versions.some((version) => version.versionId === character.characterVersionId)) return character;
            const candidates = versions.filter((version) => version.assetId === assetId && version.referenceProfile?.enabled !== false);
            const text = [row.plotDescription, row.performanceBlocking, row.imageGenerationPrompt, row.videoMotionPrompt].filter(Boolean).join("\n").normalize("NFKC");
            const named = candidates.filter((version) => {
                const profile = version.referenceProfile;
                const name = profile?.name.normalize("NFKC").trim();
                return profile?.preferred && name && name.length >= 2 && !["默认造型", "基础造型"].includes(name) && text.includes(name)
                    && !profile.excludeHints.split(/[，,、；;\n]/u).map((hint) => hint.trim()).filter(Boolean).some((hint) => text.includes(hint));
            });
            const selected = candidates.length === 1 ? candidates[0] : named.length === 1 ? named[0] : undefined;
            if (!selected) return character;
            repairs.push({ shotLabel: formatShotOrdinal(rowIndex), characterName: character.characterName, previousVersionId: character.characterVersionId || "", versionId: selected.versionId });
            return { ...character, characterVersionId: selected.versionId };
        }),
    }));
    const review = reviewStoryboardCharacterReferences(repairedRows, detail, versions);
    return { ...review, repairs };
}

export function reviewStoryboardCharacterReferences(rows: StoryboardRow[], detail: ProjectDetail | undefined, versions: CharacterReferenceVersion[], selections: Record<string, string> = {}) {
    const issues: StoryboardCharacterReferenceIssue[] = [];
    const reviewedRows = rows.map((row, rowIndex) => ({
        ...row,
        characters: (row.characters || []).map((character, characterIndex) => {
            if (!character.characterAssetId) return character;
            const assetIds = storyboardCharacterAssetIds(character, detail, versions);
            const assetId = assetIds.length === 1 ? assetIds[0]! : character.characterAssetId;
            if (assetIds.length === 1 && versions.some((version) => version.assetId === assetId && version.versionId === character.characterVersionId)) return assetId === character.characterAssetId ? character : { ...character, characterAssetId: assetId };
            const key = `${rowIndex}:${characterIndex}`;
            const candidates = versions.filter((version) => assetIds.includes(version.assetId) || !assetIds.length && detail?.assets.some((asset) => asset.id === version.assetId && asset.category === "character"));
            const selected = candidates.find((version) => version.versionId === selections[key]);
            if (selected) return { ...character, characterAssetId: selected.assetId, characterVersionId: selected.versionId, ...(!assetIds.length ? { characterName: selected.title } : {}) };
            const owner = versions.find((version) => version.versionId === character.characterVersionId);
            issues.push({
                key,
                shotLabel: formatShotOrdinal(rowIndex),
                characterName: detail?.assets.find((asset) => asset.id === assetId)?.title || character.characterName || assetId,
                assetId,
                versionId: character.characterVersionId || "",
                reason: assetIds.length > 1 ? "角色资产 ID 无效且存在同名角色，请按资产 ID 明确选择本镜头角色及版本" : !assetIds.length ? "角色资产 ID 无效，当前项目没有名称或别名准确匹配的角色，请手动指定角色，不能仅凭版本 ID 绑定其他角色" : assetId !== character.characterAssetId ? "角色资产 ID 无效，已按本项目唯一角色名称定位，请选择该角色的正确版本" : owner ? `该版本属于“${owner.title}”（资产 ID：${owner.assetId}），不属于该角色` : character.characterVersionId ? "该版本不存在或已被移除，可能是模型写错了版本 ID，并非已确认引用了其他角色" : "未指定造型版本，请选择该角色的正确版本",
                candidates,
            });
            return character;
        }),
    }));
    return { rows: reviewedRows, issues };
}

function storyboardCharacterAssetIds(character: StoryboardRow["characters"][number], detail: ProjectDetail | undefined, versions: CharacterReferenceVersion[]) {
    const characters = detail ? detail.assets.filter((asset) => asset.category === "character").map((asset) => ({ id: asset.id, title: asset.title, definition: asset.character?.definition || candidateDefinition(asset.definitionJson || "{}") }))
        : [...new Map(versions.map((version) => [version.assetId, { id: version.assetId, title: version.title, definition: version.definition }])).values()];
    if (characters.some((asset) => asset.id === character.characterAssetId)) return [character.characterAssetId!];
    const name = normalizeCharacterName(character.characterName || "");
    if (!name) return [];
    return characters.filter((asset) => [asset.title, ...(Array.isArray(asset.definition.aliases) ? asset.definition.aliases : [])]
        .some((value) => typeof value === "string" && normalizeCharacterName(value) === name)).map((asset) => asset.id);
}

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
    const referenceReview = versions ? reviewStoryboardCharacterReferences(rows, detail, versions) : undefined;
    const referenceIssues = referenceReview?.issues || [];
    if (referenceIssues.length) throw new Error(referenceIssues.map((issue) => `${issue.shotLabel} · 角色“${issue.characterName}”（资产 ID：${issue.assetId}）· 返回版本 ID：${issue.versionId}：${issue.reason}。请在核对窗口选择该角色的正确版本，无需重新生成。`).join("\n"));
    if (referenceReview) rows = referenceReview.rows;
    if (versions) for (const [rowIndex, row] of rows.entries()) {
        const seen = new Set<string>();
        for (const character of row.characters || []) {
            if (!character.characterAssetId) continue;
            if (seen.has(character.characterAssetId)) throw new Error(`${formatShotOrdinal(rowIndex)} · 角色“${character.characterName || character.characterAssetId}”（资产 ID：${character.characterAssetId}）在同一镜头重复出现多个版本，请核对角色列表或拆镜头后再写入`);
            seen.add(character.characterAssetId);
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
        const assetContext = scene || row.sceneName || row.propNames || row.referenceAssetIds ? [{
            type: "asset_context",
            sceneAssetId: scene?.id || "",
            sceneName: row.sceneName || scene?.title || "",
            sceneChange: Boolean(row.sceneChange),
            ...(row.propNames ? { propNames: row.propNames } : {}),
            ...(row.referenceAssetIds ? { referenceAssetIds: row.referenceAssetIds } : {}),
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
                ...resolveShotCameraLanguage({ shotSize: row.shotSize, cameraAngle: row.camera, cameraMovement: row.motion, videoPrompt: row.videoMotionPrompt, cameraDescriptions: row.directorScript?.shots.map((shot) => shot.camera) }),
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
    return value.normalize("NFKC").trim().toLocaleLowerCase();
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
