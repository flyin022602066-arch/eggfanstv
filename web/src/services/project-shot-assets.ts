import { matchProjectShotSequenceAssets, shotAssetContext, type MatchedShotAsset, type ShotAssetMatchInput } from "@/lib/project-shot-asset-matching";
import { getProjectUnitWorkspace, linkShotAsset, listProjectAssets, unlinkShotAsset, type ProjectAsset, type ProjectUnitWorkspace } from "@/services/api/projects";

const defaultApi = { getProjectUnitWorkspace, linkShotAsset, listProjectAssets, unlinkShotAsset };

export function projectUnitShotAssetPlan(workspace: ProjectUnitWorkspace, assets: ProjectAsset[], override?: { shotId: string; script: ShotAssetMatchInput }, options: { includeUnlistedProps?: boolean } = {}) {
    const ordered = workspace.shots.slice().sort((left, right) => left.position - right.position);
    const shots = override ? ordered.slice(0, ordered.findIndex((shot) => shot.id === override.shotId) + 1) : ordered;
    const inputs = shots.map((shot) => {
        const revisions = (workspace.shotRevisions || []).filter((revision) => revision.shotId === shot.id);
        const revision = revisions.find((item) => item.id === shot.currentRevisionId) || revisions.sort((left, right) => right.version - left.version)[0];
        const script = { ...revision, plotDescription: revision?.plotDescription || shot.description, ...shotAssetContext(revision?.actionBeatsJson), ...(override?.shotId === shot.id ? override.script : {}) };
        const existing = workspace.shotReferences.flatMap((reference): MatchedShotAsset[] => {
            if (reference.shotId !== shot.id || reference.status !== "linked" || reference.role !== "reference") return [];
            const asset = reference.asset || assets.find((item) => item.id === reference.referencedVersion?.assetId || item.primaryVersionId === reference.assetVersionId);
            return asset ? [{ asset, assetVersionId: reference.assetVersionId }] : [];
        });
        return { script, existing };
    });
    const matches = matchProjectShotSequenceAssets(assets, inputs, options);
    return shots.map((shot, index) => ({ shot, matches: matches[index]! }));
}

export async function prepareProjectShotAssets(input: {
    projectId: string;
    unitId: string;
    shotId: string;
    script: ShotAssetMatchInput;
    generationArtifactType?: "storyboard" | "action_board" | "video";
}, api = defaultApi) {
    return prepareAssets(input, api);
}

export async function prepareProjectUnitShotAssets(input: { projectId: string; unitId: string }, api = defaultApi) {
    return prepareAssets(input, api);
}

async function prepareAssets(input: { projectId: string; unitId: string; shotId?: string; script?: ShotAssetMatchInput; generationArtifactType?: "storyboard" | "action_board" | "video" }, api: typeof defaultApi) {
    const workspace = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
    if (input.shotId && !workspace.shots.some((shot) => shot.id === input.shotId)) throw new Error("当前章节中没有这个镜头，请刷新后重试");
    const activeTasks = (workspace.tasks || []).filter((task) => task.status === "queued" || task.status === "running");
    const activeShotIds = new Set(activeTasks.flatMap((task) => task.clientContext?.shotId ? [task.clientContext.shotId] : []));
    const blockingTask = activeTasks.find((task) => task.clientContext?.shotId === input.shotId && (!input.generationArtifactType || !task.clientContext?.artifactType || task.clientContext.artifactType === input.generationArtifactType));
    const taskLabel = (artifactType?: string) => artifactType === "video" ? "镜头视频" : artifactType === "storyboard" ? "分镜图" : artifactType === "action_board" ? "动作预演" : "生成";
    if (input.shotId && blockingTask) throw new Error(`当前镜头的${taskLabel(blockingTask.clientContext?.artifactType)}任务正在生成，请等待原任务结束，未提交新任务`);
    const { assets } = await api.listProjectAssets(input.projectId);
    const plan = projectUnitShotAssetPlan(workspace, assets, input.shotId ? { shotId: input.shotId, script: input.script || {} } : undefined, { includeUnlistedProps: !input.shotId }).filter(({ shot }) => (!input.shotId || shot.id === input.shotId) && (Boolean(input.shotId && input.generationArtifactType) || !activeShotIds.has(shot.id)));
    const skippedShotIds = workspace.shots.filter((shot) => activeShotIds.has(shot.id) && shot.id !== input.shotId).map((shot) => shot.id);
    const unresolvedSceneShotIds = plan.filter(({ matches }) => !matches.some(({ asset }) => asset.category === "environment")).map(({ shot }) => shot.id);
    const missing = plan.flatMap(({ shot, matches }) => {
        const existing = workspace.shotReferences.filter((reference) => reference.shotId === shot.id && reference.status === "linked" && reference.role === "reference");
        const additions = matches.filter((match) => !existing.some((reference) => reference.assetVersionId === match.assetVersionId || reference.asset?.id === match.asset.id || reference.referencedVersion?.assetId === match.asset.id));
        return additions.map((match) => ({ shotId: shot.id, ...match }));
    });
    if (!missing.length) return { workspace, boundCount: 0, unresolvedSceneShotIds, skippedShotIds };
    const bindingTask = activeTasks.find((task) => task.clientContext?.shotId === input.shotId);
    if (input.shotId && bindingTask) throw new Error(`当前镜头的${taskLabel(bindingTask.clientContext?.artifactType)}任务正在生成，需要补齐资产绑定，请等该任务结束后重试，未提交新任务`);
    const created: Array<{ shotId: string; referenceId: string }> = [];
    try {
        for (const { shotId, asset, assetVersionId } of missing) {
            try {
                const { reference } = await api.linkShotAsset(input.projectId, shotId, { assetVersionId, role: "reference" });
                created.push({ shotId, referenceId: reference.id });
            } catch (error) {
                throw new Error(`绑定资产“${asset.title}”失败：${error instanceof Error ? error.message : "请重试"}`);
            }
        }
        const updated = await api.getProjectUnitWorkspace(input.projectId, input.unitId);
        if (missing.some((match) => !updated.shotReferences.some((reference) => reference.shotId === match.shotId && reference.assetVersionId === match.assetVersionId && reference.status === "linked" && reference.role === "reference"))) {
            throw new Error("资产绑定尚未完整保存，请刷新后重试，未提交生成任务");
        }
        return { workspace: updated, boundCount: missing.length, unresolvedSceneShotIds, skippedShotIds };
    } catch (error) {
        const rollback = await Promise.allSettled(created.map(({ shotId, referenceId }) => api.unlinkShotAsset(input.projectId, shotId, referenceId)));
        if (rollback.some((result) => result.status === "rejected")) {
            throw new Error(`${error instanceof Error ? error.message : "资产绑定失败"}；部分绑定未能撤回，请检查镜头资产后重试，未提交生成任务`);
        }
        throw error;
    }
}
