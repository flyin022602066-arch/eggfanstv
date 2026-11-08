import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { assertUserScope, captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { updateProject, type Project } from "@/services/api/projects";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";

export type ProjectCoverGenerationInput = {
    project: Project;
    prompt: string;
    config: AiConfig;
    expectedScope?: CapturedUserScope;
    signal?: AbortSignal;
    onTaskUpdate?: (task: GenerationTask) => void;
};

type ProjectCoverGenerationDependencies = {
    submit: typeof submitBackendGenerationTask;
    wait: typeof waitForGenerationTask;
    materialize: typeof materializeGenerationTaskAssets;
    findAsset: (id: string) => ImageAsset | undefined;
    updateAsset: (id: string, patch: { title: string; tags: string[]; source: string; metadata: Record<string, unknown> }) => void;
    saveCover: (projectId: string, resourceId: string, expectedScope: CapturedUserScope) => Promise<unknown>;
};

const defaultDependencies: ProjectCoverGenerationDependencies = {
    submit: submitBackendGenerationTask,
    wait: waitForGenerationTask,
    materialize: materializeGenerationTaskAssets,
    findAsset: (id) => useAssetStore.getState().assets.find((asset): asset is ImageAsset => asset.id === id && asset.kind === "image"),
    updateAsset: (id, patch) => useAssetStore.getState().updateAsset(id, patch),
    saveCover: (projectId, resourceId, expectedScope) => updateProject(projectId, { coverResourceId: resourceId }, expectedScope),
};

function assertCurrent(expectedScope: CapturedUserScope, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("生成会话已结束", "AbortError");
    assertUserScope(expectedScope);
}

export async function generateProjectCover(
    input: ProjectCoverGenerationInput,
    dependencies: ProjectCoverGenerationDependencies = defaultDependencies,
) {
    const expectedScope = input.expectedScope || captureUserScope();
    const { project, config, signal } = input;
    assertCurrent(expectedScope, signal);

    const projectStyle = resolveProjectCanvasStyle(project.stylePresetId, project.styleProfileJson);
    const request = resolveModelRequestConfig(config, config.model);
    const styleExecutionPlan = projectStyle?.profile
        ? resolveStyleExecutionPlan(projectStyle.profile, { mode: "image", model: request.model, interfaceType: request.interfaceType || request.apiFormat })
        : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(config)) {
        throw new Error(`当前图片模型无法执行项目画风：${styleExecutionPlan.warnings.join("；")}`);
    }

    const task = await dependencies.submit({
        projectId: project.id,
        mode: "image",
        prompt: [input.prompt.trim(), projectStyle?.prompt].filter(Boolean).join("\n\n"),
        config,
        signal,
        expectedScope,
        onTaskUpdate: input.onTaskUpdate,
        metadata: {
            source: "project-cover-image",
            nodeId: `project-cover-image:${project.id}`,
            operation: "project_cover_image",
            domainProjectId: project.id,
            stylePresetId: projectStyle?.id,
            styleProfileJson: projectStyle?.profile ? serializeStyleProfile(projectStyle.profile) : undefined,
            styleExecutionPlan,
        },
    });
    assertCurrent(expectedScope, signal);

    const completed = await dependencies.wait(task.id, {
        initialTask: task,
        signal,
        expectedScope,
        onTaskUpdate: input.onTaskUpdate,
    });
    assertCurrent(expectedScope, signal);

    const materialized = await dependencies.materialize(completed, signal);
    assertCurrent(expectedScope, signal);
    const assetId = materialized.outputs?.find((output) => output.mediaType === "image")?.materializedAssetId;
    if (!assetId) throw new Error("图片任务完成，但没有返回封面图");

    const asset = dependencies.findAsset(assetId);
    if (!asset) throw new Error("封面图结果暂不可用，请到任务中心检查输出资源");
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
    if (!resourceId) throw new Error("封面图尚未同步到服务端资源库");

    dependencies.updateAsset(assetId, {
        title: `${project.name} · 项目封面`,
        tags: [...new Set([...asset.tags, "项目封面"])],
        source: "项目设置",
        metadata: { ...asset.metadata, source: "project-cover-image", projectId: project.id, taskId: task.id },
    });
    assertCurrent(expectedScope, signal);
    await dependencies.saveCover(project.id, resourceId, expectedScope);
    assertCurrent(expectedScope, signal);
    return { assetId, resourceId };
}

export function defaultProjectCoverPrompt(project: Pick<Project, "name" | "description" | "aspectRatio">) {
    const description = project.description?.trim();
    return [
        `为短剧项目《${project.name}》创作一张有电影质感、主体鲜明的项目封面。画幅比例 ${project.aspectRatio}，缩略图下仍要清晰易辨。`,
        description ? `项目简介：${description}` : "围绕项目名称设计有记忆点的主题画面。",
        "请将核心人物或场景作为视觉中心，构图完整、光影有层次；不要生成文字、字幕、标志或水印。",
    ].join("\n\n");
}
