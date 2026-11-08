import { isAutomaticShotAssetReference, matchProjectShotCharacters, shotAssetContext } from "./project-shot-asset-matching";
import type { CharacterReferenceChoice, CharacterReferenceVersion } from "@/services/api/project-character-references";
import type { ProjectAsset, ProjectUnitWorkspace, ShotAssetReference } from "@/services/api/projects";

export function characterReferenceImage(version: Pick<CharacterReferenceVersion, "representations">, closeUp = false) {
    const images = version.representations.filter((rep) => rep.resourceId && (rep.mediaType === "image" || rep.mediaType.startsWith("image/")) && !rep.role.includes("expression"));
    const roles = closeUp ? ["front", "primary", "turnaround_sheet", "side", "back"] : ["primary", "front", "turnaround_sheet", "side", "back"];
    return roles.flatMap((role) => images.filter((rep) => rep.role === role))[0] || images[0];
}

export function missingCharacterLookImages(versions: CharacterReferenceVersion[]) {
    return characterLookImageTargets(versions).filter((version) => !characterReferenceImage(version));
}

export function characterLookImageTargets(versions: CharacterReferenceVersion[], missingOnly = true) {
    const firstVersion = (version: CharacterReferenceVersion) => Math.min(...versions.filter((item) => item.assetId === version.assetId && (version.referenceProfile?.lookId ? item.referenceProfile?.lookId === version.referenceProfile.lookId : item.versionId === version.versionId)).map((item) => item.version));
    return characterLookDisplayVersions(versions).filter((version) => !missingOnly || !characterReferenceImage(version)).sort((left, right) => firstVersion(left) - firstVersion(right));
}

export function characterLookDisplayVersions(versions: CharacterReferenceVersion[], includeHistory = false, focusedVersionId?: string) {
    const ordered = versions.slice().sort((left, right) => right.version - left.version);
    if (includeHistory) return ordered;
    const groups = new Map<string, CharacterReferenceVersion[]>();
    for (const version of ordered) {
        if (!version.referenceProfile?.lookId && !characterReferenceImage(version) && version.versionId !== focusedVersionId) continue;
        const key = `${version.assetId}:${version.referenceProfile?.lookId || version.versionId}`;
        const group = groups.get(key) || [];
        group.push(version);
        groups.set(key, group);
    }
    const visible = [...groups.values()].map((group) => group.find((version) => version.versionId === focusedVersionId) || group.find((version) => version.referenceProfile?.preferred && characterReferenceImage(version)) || group.find((version) => characterReferenceImage(version)) || group[0]!);
    return visible.length ? visible : ordered.slice(0, 1);
}

export function referenceVersionDescription(version: CharacterReferenceVersion) {
    const definition = version.definition;
    return version.referenceProfile?.description || ["appearance", "age", "ageStage", "clothing", "hairstyle", "state", "consistencyPrompt"].flatMap((key) => typeof definition[key] === "string" && definition[key] ? [`${key}：${definition[key]}`] : []).join("；");
}

export function characterLookDraft(version: CharacterReferenceVersion, versions: CharacterReferenceVersion[]) {
    if (version.referenceProfile) return version.referenceProfile;
    const keys = ["clothing", "ageStage", "age", "hairstyle", "state"];
    const appearance = keys.map((key) => typeof version.definition[key] === "string" ? String(version.definition[key]).trim() : "");
    const group = appearance.some(Boolean) ? versions.find((other) => other.assetId === version.assetId && other.referenceProfile && keys.every((key, index) => String(other.definition[key] || "").trim() === appearance[index]))?.referenceProfile : undefined;
    return { lookId: group?.lookId || "", name: group?.name || appearance.filter(Boolean).join(" · ").slice(0, 80) || `待确认造型 v${version.version}`, description: referenceVersionDescription(version), matchHints: "", excludeHints: "", enabled: true, preferred: false, default: false };
}

export function characterLookCandidates(versions: CharacterReferenceVersion[]) {
    const candidates = new Map<string, CharacterReferenceVersion>();
    for (const version of versions.slice().sort((a, b) => b.version - a.version)) {
        const profile = version.referenceProfile;
        if (!profile?.enabled || !profile.preferred || !characterReferenceImage(version)) continue;
        const key = `${version.assetId}:${profile.lookId}`;
        if (!candidates.has(key)) candidates.set(key, version);
    }
    return [...candidates.values()];
}

export type CharacterSelectionShot = {
    shotId: string;
    revisionId: string;
    position: number;
    text: string;
    sceneName?: string;
    sceneAssetId?: string;
    sceneChange?: boolean;
    assetIds: string[];
    visibleAssetIds?: string[];
    references: ShotAssetReference[];
    busy: boolean;
};

export function characterSelectionShots(workspace: ProjectUnitWorkspace, assets: ProjectAsset[]): CharacterSelectionShot[] {
    const busy = new Set(workspace.tasks.filter((task) => task.status === "queued" || task.status === "running").map((task) => task.clientContext?.shotId));
    return workspace.shots.filter((shot) => !workspace.unit?.id || !shot.unitId || shot.unitId === workspace.unit.id).sort((a, b) => a.position - b.position).map((shot) => {
        const revision = workspace.shotRevisions.find((item) => item.id === shot.currentRevisionId);
        const context = shotAssetContext(revision?.actionBeatsJson);
        const matched = matchProjectShotCharacters(assets, { ...revision, plotDescription: revision?.plotDescription || shot.description, ...context, chapterSourceText: workspace.unit?.sourceText });
        const visibleAssetIds = matched.map((match) => match.asset.id);
        const refs = workspace.shotReferences.filter((ref) => ref.shotId === shot.id && ref.role === "reference" && ref.status === "linked" && (ref.asset?.category === "character" || assets.some((asset) => asset.id === ref.referencedVersion?.assetId && asset.category === "character")) && (!isAutomaticShotAssetReference(ref) || visibleAssetIds.includes(referenceAssetId(ref) || "")));
        return {
            shotId: shot.id, revisionId: shot.currentRevisionId || "", position: shot.position,
            text: [revision?.plotDescription || shot.description, revision?.action, revision?.imagePrompt, revision?.videoPrompt, revision?.continuityNotes].filter(Boolean).join("\n"),
            ...context,
            visibleAssetIds,
            assetIds: [...new Set([...matched.map((match) => match.asset.id), ...refs.flatMap((ref) => ref.asset?.id || ref.referencedVersion?.assetId || [])])],
            references: refs, busy: busy.has(shot.id),
        };
    });
}

export function referenceAssetId(ref: ShotAssetReference) { return ref.referencedVersion?.assetId || ref.asset?.id; }

export function characterReferenceNeedsReview(ref: ShotAssetReference, revisionId: string) {
    return ref.selectionStatus === "pending" || Boolean(ref.selectionSource === "auto" && !ref.selectionLocked && ref.selectionRevisionId !== revisionId);
}

export function characterSelectionTargets(shots: CharacterSelectionShot[], onlyShotId?: string, pendingOnly = false) {
    return shots.filter((shot) => !shot.busy && (!onlyShotId || shot.shotId === onlyShotId)).flatMap((shot) => shot.assetIds.flatMap((assetId) => {
        if (shot.visibleAssetIds && !shot.visibleAssetIds.includes(assetId)) return [];
        const refs = shot.references.filter((ref) => referenceAssetId(ref) === assetId);
        if (refs.some((ref) => ref.selectionLocked)) return [];
        if (pendingOnly && refs.length === 1 && refs[0]?.selectionStatus === "resolved" && !characterReferenceNeedsReview(refs[0], shot.revisionId)) return [];
        return [{ shot, assetId }];
    }));
}

type ModelChoice = { shotId?: unknown; assetId?: unknown; versionId?: unknown; status?: unknown; reason?: unknown; evidence?: unknown; continuityFromShotId?: unknown; changeWithinShot?: unknown; visible?: unknown };

export function parseCharacterSelectionResponse(text: string): ModelChoice[] {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
    const data: unknown = JSON.parse(trimmed);
    const choices = Array.isArray(data) ? data : data && typeof data === "object" && "choices" in data ? (data as { choices: unknown }).choices : undefined;
    if (!Array.isArray(choices) || choices.length > 1000 || choices.some((value) => !value || typeof value !== "object" || Array.isArray(value))) throw new Error("造型识别返回格式无效，请重试；原绑定未修改");
    return choices as ModelChoice[];
}

export function validateCharacterSelections(input: { shots: CharacterSelectionShot[]; versions: CharacterReferenceVersion[]; responses: ModelChoice[]; onlyShotId?: string; pendingOnly?: boolean }): CharacterReferenceChoice[] {
    const candidates = characterLookCandidates(input.versions);
    const targets = characterSelectionTargets(input.shots, input.onlyShotId, input.pendingOnly);
    const result: CharacterReferenceChoice[] = [];
    for (const { shot, assetId } of targets) {
        const responses = input.responses.filter((item) => item.shotId === shot.shotId && item.assetId === assetId);
        const response = responses.length === 1 ? responses[0] : undefined;
        const versions = input.versions.filter((version) => version.assetId === assetId);
        const existing = shot.references.find((ref) => referenceAssetId(ref) === assetId);
        const fallback = versions.find((version) => version.versionId === existing?.assetVersionId) || versions[0];
        if (!fallback) throw new Error("角色版本目录不完整，请刷新后重试");
        const chosen = candidates.find((version) => version.assetId === assetId && version.versionId === response?.versionId);
        let reason = typeof response?.reason === "string" ? response.reason.trim().slice(0, 1000) : "";
        let issue = responses.length > 1 ? "模型对同一角色返回多个版本，请手动确认；变身或同人双版本同框请拆镜头" : !response ? "模型未返回该角色的有效选择" : !chosen ? "未选中可用的造型定稿，请先完善造型与版本" : response.status !== "resolved" ? "模型无法确定角色造型" : response.changeWithinShot === true ? "镜头中包含变身或多造型变化，请拆镜头后绑定" : response.visible !== true ? "角色可能仅在对白或画外音中出现，请核对是否需要画面参考" : !reason ? "缺少选择依据" : "";
        const evidence = typeof response?.evidence === "string" ? response.evidence.trim() : "";
        const previous = result.findLast((item) => item.assetId === assetId && item.shotId === response?.continuityFromShotId && item.status === "resolved")
            || input.shots.flatMap((other) => other.references.filter((ref) => other.shotId === response?.continuityFromShotId && referenceAssetId(ref) === assetId && ref.selectionStatus === "resolved" && !characterReferenceNeedsReview(ref, other.revisionId)).map((ref) => ({ shotId: other.shotId, versionId: ref.assetVersionId })))[0];
        const previousShot = input.shots.find((item) => item.shotId === previous?.shotId);
        const between = input.shots.filter((item) => previousShot && item.position > previousShot.position && item.position <= shot.position);
        const sameScene = previousShot && previousShot.position < shot.position && between.every((item) => !item.sceneChange && Boolean(shot.sceneAssetId ? item.sceneAssetId === shot.sceneAssetId && shot.sceneAssetId === previousShot.sceneAssetId : shot.sceneName && item.sceneName === shot.sceneName && shot.sceneName === previousShot.sceneName));
        const noTransition = between.every((item) => !/(闪回|回忆画面|多年后|数年后|换装|换上|变身|变为|少年时期|幼年时期)/u.test(item.text));
        const continuity = Boolean(previous && previous.versionId === chosen?.versionId && sameScene && noTransition);
        if (!issue && !(evidence.length >= 2 && shot.text.includes(evidence)) && !continuity) issue = "缺少镜头原文证据或可核实的同场景接戏依据";
        if (!issue && chosen?.referenceProfile?.excludeHints.split(/[，,、；;\n]/u).map((value) => value.trim()).filter(Boolean).some((hint) => shot.text.includes(hint))) issue = "镜头内容触发该造型的排除条件";
        result.push({ shotId: shot.shotId, assetId, versionId: issue ? existing?.assetVersionId || fallback.versionId : chosen!.versionId, status: issue ? "pending" : "resolved", source: "auto", locked: false, reason: issue ? `${issue}${reason ? `；模型依据：${reason}` : ""}` : `${reason}${evidence ? `；原文：${evidence}` : `；沿用镜头：${previous!.shotId}`}`, expectedShotRevisionId: shot.revisionId });
    }
    return result;
}
