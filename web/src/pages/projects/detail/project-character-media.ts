import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore } from "@/services/api/projects";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import { characterFaceDesignConstraint, characterFacePresetForAsset, characterFaceReference } from "@/lib/project-character-face-presets";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { resolveStyleExecutionPlan, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type ProjectStylePrompt = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

const characterGenerationDependencies = { loadProject: getProjectCore, submitTask: submitBackendGenerationTask };

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; projectStyle?: ProjectStylePrompt; config: AiConfig }, dependencies = characterGenerationDependencies) {
    const expectedScope = captureUserScope();
    const latest = await dependencies.loadProject(input.projectId, expectedScope);
    assertUserScope(expectedScope);
    const facePreset = characterFacePresetForAsset(latest.project.characterFacePresetsJson, input.assetId);
    const promptTemplateVariables = characterTurnaroundVariables(input.name, input.definition, input.projectStyle);
    const generationConfig = { ...input.config, model: input.config.imageModel || input.config.model, count: "1" };
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    if (facePreset) {
        const profile = modelCapabilityConfigFor(generationConfig, generationConfig.model).image;
        if (profile && profile.references.maxImages < 1 && !logicalModelIDForConfig(generationConfig)) throw new Error("当前图片模型不支持参考图，请切换支持图片编辑或图生图的模型后再使用主角人脸预设");
        promptTemplateVariables.角色设定 += `\n\n${characterFaceDesignConstraint(input.name, facePreset.role)}`;
    }
    const styleExecutionPlan = input.projectStyle?.profile ? resolveStyleExecutionPlan(input.projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(generationConfig)) throw new Error(`当前图片模型无法完整执行项目画风：${styleExecutionPlan.warnings.join("；")}。请切换图片模型，或在项目设置中停用对应画风资产`);
    return dependencies.submitTask({
        projectId: input.projectId,
        mode: "image",
        prompt: promptTemplateTaskPlaceholder("角色三视图"),
        config: generationConfig,
        expectedScope,
        referenceImages: facePreset ? [characterFaceReference(facePreset)] : [],
        metadata: { nodeId: `character-turnaround:${input.assetId}`, operation: PromptTemplateOperation.CharacterTurnaround, promptTemplateOperation: PromptTemplateOperation.CharacterTurnaround, promptTemplateVariables, characterAssetId: input.assetId, stylePresetId: input.projectStyle?.id, styleProfileJson: input.projectStyle?.profile ? serializeStyleProfile(input.projectStyle.profile) : undefined, styleExecutionPlan, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
}

function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, projectStyle?: ProjectStylePrompt) {
    const visual = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, definition.multiViewPrompt]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("；");
    if (!visual) throw new Error("请先填写剧情定位、角色外貌、体型或服装，再初始化三视图");
    return { 角色名称: name, 项目画风: characterStyleConstraint(projectStyle) || "项目尚未指定画风，保持角色媒介中性。", 角色设定: visual };
}

function characterStyleConstraint(projectStyle?: ProjectStylePrompt) {
    if (!projectStyle) return "";
    // 三视图只继承角色资产相关规范，避免把建筑、运镜等项目规则错误塞进静态设定表。
    const characterSections = new Set(["风格组合", "项目定位", "题材世界观", "视觉媒介", "角色设计系统", "项目色彩与光影", "服饰、材质与场景", "资产一致性", "全局禁用"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => {
        const title = line.match(/^【([^】]+)】/)?.[1];
        return title ? characterSections.has(title) : false;
    });
    return [
        `项目画风：${projectStyle.title}。角色造型、配色、服装材质与最终渲染媒介必须遵循以下规范：`,
        ...rules,
    ].join("\n");
}
