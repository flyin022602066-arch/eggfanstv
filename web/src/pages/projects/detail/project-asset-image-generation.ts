import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { listProjectAssets, listProjectAssetsPage, type Project, type ProjectAsset } from "@/services/api/projects";
import { listGenerationTasks } from "@/services/api/task-center";
import { resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { logicalModelIDForConfig, resolveModelRequestConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { activeProjectAssetImageIds, canGenerateProjectAssetImage } from "./project-asset-image";
import { generateCharacterTurnaround } from "./project-character-media";

export type ProjectAssetImageSubmission = { asset: ProjectAsset; config: AiConfig; prompt: string };

export async function submitProjectAssetImage(project: Project, { asset, config, prompt }: ProjectAssetImageSubmission) {
    if (!useConfigStore.getState().isAiConfigReady(config, config.model)) throw new Error("请先在设置中配置可用的图片模型");
    const projectStyle = resolveProjectCanvasStyle(project.stylePresetId, project.styleProfileJson);
    if (asset.character) return generateCharacterTurnaround({ projectId: project.id, assetId: asset.id, versionId: asset.character.versionId, name: asset.title, definition: { ...asset.character.definition, multiViewPrompt: [asset.character.definition.multiViewPrompt, prompt].filter(Boolean).join("\n") }, projectStyle, config });
    if (!canGenerateProjectAssetImage(asset)) throw new Error("请选择已确认的场景或道具设定");
    const request = resolveModelRequestConfig(config, config.model);
    const styleExecutionPlan = projectStyle?.profile ? resolveStyleExecutionPlan(projectStyle.profile, { mode: "image", model: request.model, interfaceType: request.interfaceType || request.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(config)) throw new Error(`当前图片模型无法执行项目画风：${styleExecutionPlan.warnings.join("；")}`);
    return submitBackendGenerationTask({ projectId: project.id, mode: "image", prompt: [prompt.trim(), projectStyle?.prompt].filter(Boolean).join("\n\n"), config, metadata: { nodeId: `project-asset-image:${asset.id}`, operation: "project_asset_image", assetId: asset.id, assetVersionId: asset.primaryVersionId, domainProjectId: project.id, stylePresetId: projectStyle?.id, styleProfileJson: projectStyle?.profile ? serializeStyleProfile(projectStyle.profile) : undefined, styleExecutionPlan } });
}

export async function loadProjectAssetImageBatch(projectId: string, unitId = "") {
    const loadAssets = async () => {
        if (!unitId) return listProjectAssets(projectId);
        const assets: ProjectAsset[] = [];
        for (let page = 1; ; page++) {
            const result = await listProjectAssetsPage(projectId, { page, pageSize: 80, unitId });
            assets.push(...result.assets);
            if (!result.hasMore) return { assets };
        }
    };
    const [result, tasks] = await Promise.all([loadAssets(), listGenerationTasks(100, { projectId, activeOnly: true })]);
    if (tasks.length === 100) throw new Error("当前项目活动任务较多，请等待部分任务完成后再批量提交");
    return { assets: result.assets, activeIds: activeProjectAssetImageIds(tasks) };
}

export async function submitProjectAssetImageBatch(assets: ProjectAsset[], submit: (asset: ProjectAsset) => Promise<unknown>, onProgress: (completed: number) => void) {
    const submittedIds: string[] = [];
    const failures: { asset: ProjectAsset; message: string }[] = [];
    for (const asset of assets) {
        try { await submit(asset); submittedIds.push(asset.id); }
        catch (error) { failures.push({ asset, message: error instanceof Error ? error.message : "提交失败" }); }
        onProgress(submittedIds.length + failures.length);
    }
    return { submittedIds, failures };
}
