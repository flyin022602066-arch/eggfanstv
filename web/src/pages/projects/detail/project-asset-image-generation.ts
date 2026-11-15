import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore, listProjectAssets, listProjectAssetsPage, type Project, type ProjectAsset } from "@/services/api/projects";
import { listGenerationTasks } from "@/services/api/task-center";
import { resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { logicalModelIDForConfig, resolveModelRequestConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { activeProjectAssetImageIds, canGenerateProjectAssetImage } from "./project-asset-image";
import { generateCharacterTurnaround } from "./project-character-media";
import { characterAssetType } from "@/lib/character-asset-type";
import { submitCharacterLookImages } from "./project-character-media";
import { characterLookImageTargets } from "@/lib/character-look-selection";
import { characterIdentitySource } from "@/lib/character-identity-reference";
import { getCharacterReferenceCatalog, type CharacterReferenceVersion } from "@/services/api/project-character-references";
import { waitForGenerationTask, type GenerationTask, type WaitForGenerationTaskOptions } from "@/services/api/task-center";
import type { ReferenceImage } from "@/types/image";
import { assertUserScope, captureUserScope, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";
import { characterFacePresetBindingIssue } from "@/lib/project-character-face-presets";

export type ProjectAssetImageSubmission = { asset: ProjectAsset; config: AiConfig; prompt: string; referenceImage?: ReferenceImage; characterVersions?: CharacterReferenceVersion[]; characterPromptSupplement?: string };

const assetImageDependencies = { loadCatalog: getCharacterReferenceCatalog, submit: submitProjectAssetImage };
const pendingImageBatches = new Map<symbol, { projectId: string; scope: CapturedUserScope; assetIds: Set<string> }>();

export function activeProjectAssetImageBatchIds(projectId: string) {
    return new Set([...pendingImageBatches.values()].filter((batch) => batch.projectId === projectId && userScopeMatches(batch.scope)).flatMap((batch) => [...batch.assetIds]));
}

export async function submitProjectAssetImages(project: Project, input: ProjectAssetImageSubmission, dependencies = assetImageDependencies) {
    const scope = captureUserScope();
    if (!input.asset.character || !input.characterVersions?.length) {
        await dependencies.submit(project, input);
        return { submitted: 1, errors: [] as string[] };
    }
    const catalog = await dependencies.loadCatalog(project.id, scope);
    assertUserScope(scope);
    const targets = input.characterVersions.map((version) => {
        const current = catalog.versions.find((item) => item.assetId === input.asset.id && item.versionId === version.versionId);
        if (!current) throw new Error("角色造型已变化，请刷新后重新核对生成清单");
        return current;
    });
    return submitCharacterLookImages(targets, catalog.versions, (version) => {
        assertUserScope(scope);
        const asset = { ...input.asset, primaryVersionId: version.versionId, character: version };
        return dependencies.submit(project, { ...input, asset, prompt: input.characterPromptSupplement ?? input.prompt });
    });
}

export async function submitProjectAssetImage(project: Project, { asset, config, prompt, referenceImage }: ProjectAssetImageSubmission, dependencies = { submitTask: submitBackendGenerationTask }) {
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型");
    const projectStyle = resolveProjectCanvasStyle(project.stylePresetId, project.styleProfileJson);
    if (asset.character) return generateCharacterTurnaround({ projectId: project.id, assetId: asset.id, versionId: asset.character.versionId, name: asset.title, definition: asset.character.definition, promptOverride: prompt, projectStyle, config, referenceImage });
    if (!canGenerateProjectAssetImage(asset)) throw new Error("请选择已确认的场景或道具设定");
    const request = resolveModelRequestConfig(config, config.model);
    const styleExecutionPlan = projectStyle?.profile ? resolveStyleExecutionPlan(projectStyle.profile, { mode: "image", model: request.model, interfaceType: request.interfaceType || request.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(config)) throw new Error(`当前图片模型无法执行项目画风：${styleExecutionPlan.warnings.join("；")}`);
    return dependencies.submitTask({ projectId: project.id, mode: "image", prompt: [prompt.trim(), projectStyle?.prompt].filter(Boolean).join("\n\n"), config, referenceImages: referenceImage ? [referenceImage] : [], metadata: { nodeId: `project-asset-image:${asset.id}`, operation: "project_asset_image", assetId: asset.id, assetVersionId: asset.primaryVersionId, domainProjectId: project.id, stylePresetId: projectStyle?.id, styleProfileJson: projectStyle?.profile ? serializeStyleProfile(projectStyle.profile) : undefined, styleExecutionPlan } });
}

export async function loadProjectAssetImageBatch(projectId: string, unitId = "", category = "") {
    const loadAssets = async () => {
        if (!unitId) return listProjectAssets(projectId);
        const assets: ProjectAsset[] = [];
        for (let page = 1; ; page++) {
            const result = await listProjectAssetsPage(projectId, { page, pageSize: 80, unitId });
            assets.push(...result.assets);
            if (!result.hasMore) return { assets };
        }
    };
    const [result, tasks, catalog, core] = await Promise.all([loadAssets(), listGenerationTasks(100, { projectId, activeOnly: true }), category === "character" ? getCharacterReferenceCatalog(projectId) : undefined, category === "character" ? getProjectCore(projectId) : undefined]);
    if (tasks.length === 100) throw new Error("当前项目活动任务较多，请等待部分任务完成后再批量提交");
    const assets = catalog ? result.assets.flatMap((asset) => asset.character ? characterLookImageTargets(catalog.versions.filter((version) => version.assetId === asset.id), false).map((version) => ({ ...asset, primaryVersionId: version.versionId, character: version })) : [asset]) : result.assets;
    const faceBindingIssue = catalog && core ? characterFacePresetBindingIssue(core.project.characterFacePresetsJson, catalog.versions.map((version) => version.assetId)) : "";
    return { assets, activeIds: new Set([...activeProjectAssetImageIds(tasks), ...activeProjectAssetImageBatchIds(projectId)]), versions: catalog?.versions, faceBindingIssue };
}

export type ProjectAssetImageBatchState = {
    submitted: number;
    failed: number;
    submitting: ProjectAsset[];
    waiting: { asset: ProjectAsset; task: GenerationTask }[];
};

export async function submitProjectAssetImageBatch(assets: ProjectAsset[], submit: (asset: ProjectAsset) => Promise<unknown>, onProgress: (completed: number) => void, options?: { projectId?: string; versions?: CharacterReferenceVersion[]; signal?: AbortSignal; onStateChange?: (state: ProjectAssetImageBatchState) => void; wait?: (task: GenerationTask, options?: WaitForGenerationTaskOptions) => Promise<GenerationTask> }) {
    const expectedScope = captureUserScope();
    const reservation = Symbol();
    const submitted = new Set<number>();
    const failures = new Map<number, { asset: ProjectAsset; message: string }>();
    const cancelled = new Set<number>();
    const submitting = new Map<number, ProjectAsset>();
    const waiting = new Map<number, { asset: ProjectAsset; task: GenerationTask }>();
    let processed = 0;
    const publish = () => options?.onStateChange?.({ submitted: submitted.size, failed: failures.size, submitting: [...submitting.values()], waiting: [...waiting.values()] });
    const groups = new Map<string, { asset: ProjectAsset; index: number; identity?: ReturnType<typeof characterIdentitySource>; issue?: unknown }[]>();
    for (const [index, asset] of assets.entries()) {
        const key = asset.character ? `character:${asset.id}` : `asset:${asset.id}`;
        const group = groups.get(key) || [];
        let identity: ReturnType<typeof characterIdentitySource> | undefined;
        let issue: unknown;
        try {
            if (asset.character && options?.versions) identity = characterIdentitySource(options.versions, asset.id, asset.character.versionId);
        } catch (error) { issue = error; }
        group.push({ asset, index, identity, issue });
        groups.set(key, group);
    }
    if (options?.projectId) pendingImageBatches.set(reservation, { projectId: options.projectId, scope: expectedScope, assetIds: new Set(assets.map((asset) => asset.id)) });
    publish();
    try {
        const results = await Promise.allSettled([...groups.values()].map(async (group) => {
            group.sort((left, right) => Number(Boolean(right.identity?.canCreateBase)) - Number(Boolean(left.identity?.canCreateBase)) || left.index - right.index);
            let blocked = "";
            for (const [position, { asset, index, identity, issue }] of group.entries()) {
                assertUserScope(expectedScope);
                if (options?.signal?.aborted) { cancelled.add(index); continue; }
                const establishingBase = identity && characterAssetType(asset.title, asset.character!.definition) !== "group" && !identity.image && identity.canCreateBase;
                let task: GenerationTask | undefined;
                try {
                    if (issue) throw issue;
                    if (blocked) throw new Error(blocked);
                    submitting.set(index, asset);
                    publish();
                    task = await submit(asset) as GenerationTask;
                    assertUserScope(expectedScope);
                    submitted.add(index);
                } catch (error) {
                    assertUserScope(expectedScope);
                    const message = error instanceof Error ? error.message : "提交失败";
                    failures.set(index, { asset, message });
                    if (establishingBase) blocked = `基础图未提交，未提交此造型：${message}`;
                } finally {
                    submitting.delete(index);
                }
                onProgress(++processed);
                publish();
                if (task && establishingBase && position < group.length - 1 && !options?.signal?.aborted) {
                    const update = (current: GenerationTask) => { waiting.set(index, { asset, task: current }); publish(); };
                    update(task);
                    try {
                        const waitOptions = { initialTask: task, expectedScope, signal: options?.signal, onTaskUpdate: update };
                        const completed = await (options?.wait ? options.wait(task, waitOptions) : waitForGenerationTask(task.id, waitOptions));
                        assertUserScope(expectedScope);
                        if (completed.status !== "succeeded") throw new Error("基础图生成失败，后续造型无法继承人脸");
                    } catch (error) {
                        assertUserScope(expectedScope);
                        blocked = `基础图尚未成功，未提交此造型：${error instanceof Error ? error.message : "等待失败"}`;
                    } finally {
                        waiting.delete(index);
                        publish();
                    }
                }
            }
        }));
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        return { submittedIds: assets.filter((_, index) => submitted.has(index)).map((asset) => asset.id), failures: [...failures.entries()].sort(([left], [right]) => left - right).map(([, failure]) => failure), cancelledAssets: assets.filter((_, index) => cancelled.has(index)) };
    } finally {
        pendingImageBatches.delete(reservation);
    }
}
