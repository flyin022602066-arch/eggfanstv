import { isAutomaticShotAssetReference, matchProjectShotCharacters, matchProjectShotSequenceAssets, missingProjectShotAssets, shotAssetContext, type MatchedShotAsset, type ShotAssetMatchInput } from "@/lib/project-shot-asset-matching";
import { createProjectAssetCandidates, getProjectUnitWorkspace, linkShotAsset, listProjectAssets, unlinkShotAsset, type ProjectAsset, type ProjectUnitWorkspace } from "@/services/api/projects";

const defaultApi = { getProjectUnitWorkspace, linkShotAsset, listProjectAssets, unlinkShotAsset, createProjectAssetCandidates };
type AssetPreparationApi = Omit<typeof defaultApi, "createProjectAssetCandidates"> & Partial<Pick<typeof defaultApi, "createProjectAssetCandidates">>;

export function projectUnitShotAssetPlan(workspace: ProjectUnitWorkspace, assets: ProjectAsset[], override?: { shotId: string; script: ShotAssetMatchInput }, options: { includeUnlistedProps?: boolean; unitId?: string } = {}) {
    const unitId = options.unitId || workspace.unit?.id;
    const ordered = workspace.shots.filter((shot) => !unitId || !shot.unitId || shot.unitId === unitId).sort((left, right) => left.position - right.position);
    const shots = override ? ordered.slice(0, ordered.findIndex((shot) => shot.id === override.shotId) + 1) : ordered;
    const inputs = shots.map((shot) => {
        const revisions = (workspace.shotRevisions || []).filter((revision) => revision.shotId === shot.id);
        const revision = revisions.find((item) => item.id === shot.currentRevisionId) || revisions.sort((left, right) => right.version - left.version)[0];
        const script = { ...revision, plotDescription: revision?.plotDescription || shot.description, ...shotAssetContext(revision?.actionBeatsJson), ...(override?.shotId === shot.id ? override.script : {}), ...(workspace.unit?.sourceText?.trim() ? { chapterSourceText: workspace.unit.sourceText } : {}) };
        const existing = workspace.shotReferences.flatMap((reference): MatchedShotAsset[] => {
            if (reference.shotId !== shot.id || reference.status !== "linked" || reference.role !== "reference") return [];
            const asset = reference.asset || assets.find((item) => item.id === reference.referencedVersion?.assetId || item.primaryVersionId === reference.assetVersionId);
            return asset ? [{ asset, assetVersionId: reference.assetVersionId, selectionSource: reference.selectionSource, selectionLocked: reference.selectionLocked }] : [];
        });
        return { script, existing };
    });
    const matches = matchProjectShotSequenceAssets(assets, inputs, options);
    return shots.map((shot, index) => ({ shot, script: inputs[index]!.script, matches: matches[index]! }));
}

export async function prepareProjectShotAssets(input: {
    projectId: string;
    unitId: string;
    shotId: string;
    script: ShotAssetMatchInput;
    generationArtifactType?: "storyboard" | "action_board" | "video";
}, api: AssetPreparationApi = defaultApi) {
    return prepareAssets(input, api);
}

export async function prepareProjectUnitShotAssets(input: { projectId: string; unitId: string }, api: AssetPreparationApi = defaultApi) {
    return prepareAssets(input, api);
}

async function prepareAssets(input: { projectId: string; unitId: string; shotId?: string; script?: ShotAssetMatchInput; generationArtifactType?: "storyboard" | "action_board" | "video" }, api: AssetPreparationApi) {
    const workspace = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
    const chapterSourceText = workspace.unit?.sourceText;
    if (workspace.unit?.id && workspace.unit.id !== input.unitId) throw new Error("章节工作区不匹配，请刷新后重试");
    const chapterShots = workspace.shots.filter((shot) => !shot.unitId || shot.unitId === input.unitId);
    if (input.shotId && !chapterShots.some((shot) => shot.id === input.shotId)) throw new Error("当前章节中没有这个镜头，请刷新后重试");
    const activeTasks = (workspace.tasks || []).filter((task) => task.status === "queued" || task.status === "running");
    const activeShotIds = new Set(activeTasks.flatMap((task) => task.clientContext?.shotId ? [task.clientContext.shotId] : []));
    const blockingTask = activeTasks.find((task) => task.clientContext?.shotId === input.shotId && (!input.generationArtifactType || !task.clientContext?.artifactType || task.clientContext.artifactType === input.generationArtifactType));
    const taskLabel = (artifactType?: string) => artifactType === "video" ? "镜头视频" : artifactType === "storyboard" ? "分镜图" : artifactType === "action_board" ? "动作预演" : "生成";
    if (input.shotId && blockingTask) throw new Error(`当前镜头的${taskLabel(blockingTask.clientContext?.artifactType)}任务正在生成，请等待原任务结束，未提交新任务`);
    const { assets } = await api.listProjectAssets(input.projectId);
    const plan = projectUnitShotAssetPlan(workspace, assets, input.shotId ? { shotId: input.shotId, script: input.script || {} } : undefined, { includeUnlistedProps: !input.shotId, unitId: input.unitId })
        .map((entry) => ({ ...entry, matches: entry.matches.map((match) => ({ ...match, assetVersionId: currentAssetVersion(match.asset, match.assetVersionId) })) }))
        .filter(({ shot }) => (!input.shotId || shot.id === input.shotId) && (Boolean(input.shotId && input.generationArtifactType) || !activeShotIds.has(shot.id)));
    const skippedShotIds = chapterShots.filter((shot) => activeShotIds.has(shot.id) && shot.id !== input.shotId).map((shot) => shot.id);
    const unresolvedSceneShotIds = plan.filter(({ matches }) => !matches.some(({ asset }) => asset.category === "environment")).map(({ shot }) => shot.id);
    const gaps = new Map<string, { name: string; category: "environment" | "prop"; shotIds: string[]; description: string }>();
    for (const { shot, script } of plan) {
        for (const gap of missingProjectShotAssets(assets, script)) {
            const key = `${gap.category}:${gap.name.normalize("NFKC").toLocaleLowerCase()}`;
            const existing = gaps.get(key);
            if (existing) existing.shotIds.push(shot.id);
            else gaps.set(key, { ...gap, shotIds: [shot.id], description: script.plotDescription || shot.description || "" });
        }
    }
    const missingAssets = [...gaps.values()];
    if (!input.shotId && missingAssets.length && api.createProjectAssetCandidates) {
        for (let offset = 0; offset < missingAssets.length; offset += 100) {
            await api.createProjectAssetCandidates(input.projectId, missingAssets.slice(offset, offset + 100).map((gap) => ({
                name: gap.name,
                category: gap.category,
                unitId: input.unitId,
                details: {
                    description: gap.description,
                    prompt: `${gap.category === "environment" ? "场景环境设定图，保持地点布局一致，不包含人物" : "独立道具设定图，保持外形与材质一致"}。资产名称：${gap.name}。原分镜依据：${gap.description}`,
                    shotIds: gap.shotIds,
                },
            })), "manual");
        }
    }
    const repairs = plan.flatMap(({ shot, matches }) => {
        const existing = workspace.shotReferences.filter((reference) => reference.shotId === shot.id && reference.status === "linked" && reference.role === "reference");
        const additions = matches.filter((match) => !existing.some((reference) => {
            if (reference.assetVersionId === match.assetVersionId) return true;
            const sameAsset = reference.asset?.id === match.asset.id || reference.referencedVersion?.assetId === match.asset.id;
            return sameAsset;
        }));
        const stale = matches.flatMap((match) => existing.filter((reference) => {
            const sameAsset = reference.asset?.id === match.asset.id || reference.referencedVersion?.assetId === match.asset.id;
            const currentVersionExists = existing.some((candidate) => (candidate.asset?.id === match.asset.id || candidate.referencedVersion?.assetId === match.asset.id) && candidate.assetVersionId === match.assetVersionId);
            return !currentVersionExists && sameAsset && reference.assetVersionId !== match.assetVersionId && assetVersionFollowsPrimary(match.asset);
        }).map((reference) => ({ shotId: shot.id, reference, ...match })));
        return [...additions.map((match) => ({ kind: "add" as const, shotId: shot.id, ...match })), ...stale.map((match) => ({ kind: "replace" as const, ...match }))];
    });
    const missing = repairs.filter((repair) => repair.kind === "add");
    const stale = repairs.filter((repair): repair is Extract<typeof repairs[number], { kind: "replace" }> => repair.kind === "replace");
    const unsupportedCharacters = plan.flatMap(({ shot, script }) => {
        const visible = new Set(matchProjectShotCharacters(assets, { ...script, assetBindings: undefined }).map(({ asset }) => asset.id));
        return workspace.shotReferences.filter((reference) => {
            if (reference.shotId !== shot.id || reference.status !== "linked" || reference.role !== "reference" || !isAutomaticShotAssetReference(reference)) return false;
            const asset = reference.asset || assets.find((item) => item.id === reference.referencedVersion?.assetId || item.primaryVersionId === reference.assetVersionId);
            return asset?.category === "character" && !visible.has(asset.id);
        }).map((reference) => ({ shotId: shot.id, revisionId: shot.currentRevisionId, reference: { ...reference } }));
    });
    if (!missing.length && !stale.length && !unsupportedCharacters.length) return { workspace, assets, boundCount: 0, removedCount: 0, unresolvedSceneShotIds, skippedShotIds, missingAssets };
    const bindingTask = activeTasks.find((task) => task.clientContext?.shotId === input.shotId);
    if (input.shotId && bindingTask) throw new Error(`当前镜头的${taskLabel(bindingTask.clientContext?.artifactType)}任务正在生成，需要补齐资产绑定，请等该任务结束后重试，未提交新任务`);
    const created: Array<{ shotId: string; referenceId: string }> = [];
    const removed: typeof stale = [];
    let updated = workspace;
    let replacedCount = 0;
    try {
        for (const { shotId, asset, assetVersionId } of missing) {
            try {
                const { reference } = await api.linkShotAsset(input.projectId, shotId, { assetVersionId, role: "reference" });
                created.push({ shotId, referenceId: reference.id });
            } catch (error) {
                throw new Error(`绑定资产“${asset.title}”失败：${error instanceof Error ? error.message : "请重试"}`);
            }
        }
        updated = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
        if (missing.some((match) => !updated.shotReferences.some((reference) => reference.shotId === match.shotId && reference.assetVersionId === match.assetVersionId && reference.status === "linked" && reference.role === "reference"))) {
            throw new Error("资产绑定尚未完整保存，请刷新后重试，未提交生成任务");
        }
        for (const repair of stale) {
            const current = updated.shotReferences.find((reference) => reference.id === repair.reference.id);
            if (!current) continue;
            if (current.assetVersionId === repair.assetVersionId) continue;
            if (current.assetVersionId !== repair.reference.assetVersionId) throw new Error(`资产“${repair.asset.title}”的旧绑定已发生变化，请刷新后重试`);
            await api.unlinkShotAsset(input.projectId, repair.shotId, current.id);
            removed.push(repair);
            const { reference } = await api.linkShotAsset(input.projectId, repair.shotId, { assetVersionId: repair.assetVersionId, role: repair.reference.role });
            created.push({ shotId: repair.shotId, referenceId: reference.id });
            replacedCount += 1;
            updated = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
        }
        if (repairs.some((repair) => !updated.shotReferences.some((reference) => reference.shotId === repair.shotId && reference.assetVersionId === repair.assetVersionId && reference.status === "linked" && reference.role === "reference"))) {
            throw new Error("资产版本同步尚未完整保存，请刷新后重试，未提交生成任务");
        }
    } catch (error) {
        const rollback = await Promise.allSettled([
            ...created.map(({ shotId, referenceId }) => api.unlinkShotAsset(input.projectId, shotId, referenceId)),
            ...removed.map(({ shotId, reference }) => api.linkShotAsset(input.projectId, shotId, { assetVersionId: reference.assetVersionId, role: reference.role })),
        ]);
        if (rollback.some((result) => result.status === "rejected")) {
            throw new Error(`${error instanceof Error ? error.message : "资产绑定失败"}；部分绑定未能撤回，请检查镜头资产后重试，未提交生成任务`);
        }
        throw error;
    }
    let removedCount = 0;
    for (const { shotId, revisionId, reference } of unsupportedCharacters) {
        updated = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
        const currentShot = updated.shots.find((item) => item.id === shotId);
        if (updated.unit?.id && updated.unit.id !== input.unitId || updated.unit?.sourceText !== chapterSourceText || !currentShot || currentShot.currentRevisionId !== revisionId || currentShot.unitId && currentShot.unitId !== input.unitId) throw new Error("章节或镜头已变化，请刷新后重新检查资产绑定");
        if ((updated.tasks || []).some((task) => (task.status === "queued" || task.status === "running") && task.clientContext?.shotId === shotId)) throw new Error("镜头正在生成，不能清理自动角色引用，请任务结束后重试");
        const current = updated.shotReferences.find((item) => item.id === reference.id);
        if (!current || !isAutomaticShotAssetReference(current) || current.status !== "linked" || current.role !== "reference" || current.assetVersionId !== reference.assetVersionId) continue;
        await api.unlinkShotAsset(input.projectId, shotId, current.id);
        updated = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
        if (updated.shotReferences.some((item) => item.id === current.id && item.status === "linked")) throw new Error("自动角色引用尚未移除，请刷新后重试，未提交生成任务");
        removedCount += 1;
    }
    return { workspace: updated, assets, boundCount: missing.length + replacedCount, removedCount, unresolvedSceneShotIds, skippedShotIds, missingAssets };
}

function assetVersionFollowsPrimary(asset: ProjectAsset) {
    return asset.category === "environment" || asset.category === "prop";
}

function currentAssetVersion(asset: ProjectAsset, versionId: string) {
    return assetVersionFollowsPrimary(asset) ? asset.primaryVersionId || versionId : versionId;
}
