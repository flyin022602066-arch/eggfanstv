import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { listProjectAssets, listProjectAssetsPage, type Project, type ProjectAsset } from "@/services/api/projects";
import { listGenerationTasks } from "@/services/api/task-center";
import { resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { logicalModelIDForConfig, resolveModelRequestConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { activeProjectAssetImageIds, canGenerateProjectAssetImage } from "./project-asset-image";
import { generateCharacterTurnaround } from "./project-character-media";
import { submitCharacterLookImages } from "./project-character-media";
import { characterLookImageTargets } from "@/lib/character-look-selection";
import { characterIdentitySource } from "@/lib/character-identity-reference";
import { getCharacterReferenceCatalog, type CharacterReferenceVersion } from "@/services/api/project-character-references";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { ReferenceImage } from "@/types/image";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";

export type ProjectAssetImageSubmission = { asset: ProjectAsset; config: AiConfig; prompt: string; referenceImage?: ReferenceImage; characterVersions?: CharacterReferenceVersion[]; characterPromptSupplement?: string };

const assetImageDependencies = { loadCatalog: getCharacterReferenceCatalog, submit: submitProjectAssetImage };

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

export async function submitProjectAssetImage(project: Project, { asset, config, prompt, referenceImage }: ProjectAssetImageSubmission) {
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型");
    const projectStyle = resolveProjectCanvasStyle(project.stylePresetId, project.styleProfileJson);
    if (asset.character) return generateCharacterTurnaround({ projectId: project.id, assetId: asset.id, versionId: asset.character.versionId, name: asset.title, definition: asset.character.definition, promptOverride: prompt, projectStyle, config, referenceImage });
    if (!canGenerateProjectAssetImage(asset)) throw new Error("请选择已确认的场景或道具设定");
    const request = resolveModelRequestConfig(config, config.model);
    const styleExecutionPlan = projectStyle?.profile ? resolveStyleExecutionPlan(projectStyle.profile, { mode: "image", model: request.model, interfaceType: request.interfaceType || request.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(config)) throw new Error(`当前图片模型无法执行项目画风：${styleExecutionPlan.warnings.join("；")}`);
    return submitBackendGenerationTask({ projectId: project.id, mode: "image", prompt: [prompt.trim(), projectStyle?.prompt].filter(Boolean).join("\n\n"), config, referenceImages: referenceImage ? [referenceImage] : [], metadata: { nodeId: `project-asset-image:${asset.id}`, operation: "project_asset_image", assetId: asset.id, assetVersionId: asset.primaryVersionId, domainProjectId: project.id, stylePresetId: projectStyle?.id, styleProfileJson: projectStyle?.profile ? serializeStyleProfile(projectStyle.profile) : undefined, styleExecutionPlan } });
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
    const [result, tasks, catalog] = await Promise.all([loadAssets(), listGenerationTasks(100, { projectId, activeOnly: true }), category === "character" ? getCharacterReferenceCatalog(projectId) : undefined]);
    if (tasks.length === 100) throw new Error("当前项目活动任务较多，请等待部分任务完成后再批量提交");
    const assets = catalog ? result.assets.flatMap((asset) => asset.character ? characterLookImageTargets(catalog.versions.filter((version) => version.assetId === asset.id), false).map((version) => ({ ...asset, primaryVersionId: version.versionId, character: version })) : [asset]) : result.assets;
    return { assets, activeIds: activeProjectAssetImageIds(tasks), versions: catalog?.versions };
}

export async function submitProjectAssetImageBatch(assets: ProjectAsset[], submit: (asset: ProjectAsset) => Promise<unknown>, onProgress: (completed: number) => void, options?: { versions: CharacterReferenceVersion[]; wait?: (task: GenerationTask) => Promise<GenerationTask> }) {
    const expectedScope = captureUserScope();
    const submittedIds: string[] = [];
    const failures: { asset: ProjectAsset; message: string }[] = [];
    const blockedCharacters = new Map<string, string>();
    for (const [index, asset] of assets.entries()) {
        assertUserScope(expectedScope);
        const identity = asset.character && options ? characterIdentitySource(options.versions, asset.id, asset.character.versionId) : undefined;
        const establishingBase = identity && !identity.image && identity.canCreateBase;
        try {
            if (blockedCharacters.has(asset.id)) throw new Error(blockedCharacters.get(asset.id));
            const task = await submit(asset);
            submittedIds.push(asset.id);
            if (establishingBase && options && assets.slice(index + 1).some((next) => next.id === asset.id)) {
                try {
                    const completed = await (options.wait ? options.wait(task as GenerationTask) : waitForGenerationTask((task as GenerationTask).id, { initialTask: task as GenerationTask, expectedScope }));
                    assertUserScope(expectedScope);
                    if (completed.status !== "succeeded") throw new Error("基础图生成失败，后续造型无法继承人脸");
                } catch (error) {
                    assertUserScope(expectedScope);
                    blockedCharacters.set(asset.id, `基础图尚未成功，未提交此造型：${error instanceof Error ? error.message : "等待失败"}`);
                }
            }
        }
        catch (error) {
            assertUserScope(expectedScope);
            const message = error instanceof Error ? error.message : "提交失败";
            failures.push({ asset, message });
            if (establishingBase) blockedCharacters.set(asset.id, `基础图未提交，未提交此造型：${message}`);
        }
        onProgress(index + 1);
    }
    return { submittedIds, failures };
}
