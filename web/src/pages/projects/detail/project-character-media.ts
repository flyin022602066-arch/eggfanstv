import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore } from "@/services/api/projects";
import { getCharacterReferenceCatalog, type CharacterReferenceVersion } from "@/services/api/project-character-references";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { characterIdentityConstraint, characterIdentitySource } from "@/lib/character-identity-reference";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import { characterFaceDesignConstraint, characterFacePresetForAsset, characterFaceReference } from "@/lib/project-character-face-presets";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { characterTurnaroundVariables, type CharacterProjectStyle } from "@/lib/character-reference-generation";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export { characterTurnaroundVariables };
type ProjectStylePrompt = CharacterProjectStyle;

const characterGenerationDependencies = { loadProject: getProjectCore, loadCatalog: getCharacterReferenceCatalog, submitTask: submitBackendGenerationTask };

export async function submitCharacterLookImages(targets: CharacterReferenceVersion[], versions: CharacterReferenceVersion[], submit: (version: CharacterReferenceVersion) => Promise<GenerationTask>, wait?: (task: GenerationTask) => Promise<GenerationTask>) {
    const expectedScope = captureUserScope();
    const errors: string[] = [];
    let submitted = 0;
    const ordered = targets.slice().sort((left, right) => Number(characterIdentitySource(versions, right.assetId, right.versionId).canCreateBase) - Number(characterIdentitySource(versions, left.assetId, left.versionId).canCreateBase) || left.version - right.version);
    for (const [index, version] of ordered.entries()) {
        const identity = characterIdentitySource(versions, version.assetId, version.versionId);
        const establishingBase = !identity.image && identity.canCreateBase;
        try {
            assertUserScope(expectedScope);
            const task = await submit(version);
            submitted++;
            if (establishingBase && index < ordered.length - 1) {
                const completed = await (wait ? wait(task) : waitForGenerationTask(task.id, { initialTask: task, expectedScope }));
                assertUserScope(expectedScope);
                if (completed.status !== "succeeded") throw new Error("基础图尚未成功完成，后续形态未提交");
            }
        } catch (error) {
            errors.push(`${version.referenceProfile?.name || `v${version.version}`}：${error instanceof Error ? error.message : "提交失败"}`);
            if (establishingBase) break;
        }
    }
    return { submitted, errors };
}

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; promptOverride?: string; projectStyle?: ProjectStylePrompt; config: AiConfig; referenceImage?: ReferenceImage }, dependencies = characterGenerationDependencies) {
    const expectedScope = captureUserScope();
    const [latest, catalog] = await Promise.all([dependencies.loadProject(input.projectId, expectedScope), dependencies.loadCatalog(input.projectId, expectedScope)]);
    assertUserScope(expectedScope);
    const identity = characterIdentitySource(catalog.versions, input.assetId, input.versionId);
    if (!identity.image && !identity.canCreateBase) throw new Error("请先为基础造型生成或上传图片；其他形态必须基于基础版人脸编辑，不能直接重新生成人物");
    const facePreset = characterFacePresetForAsset(latest.project.characterFacePresetsJson, input.assetId);
    const promptTemplateVariables = characterTurnaroundVariables(input.name, input.definition, input.promptOverride, input.projectStyle);
    const generationConfig = { ...input.config, model: input.config.imageModel || input.config.model, count: "1" };
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    if (identity.image || facePreset || input.referenceImage) {
        const profile = modelCapabilityConfigFor(generationConfig, generationConfig.model).image;
        if (profile && profile.references.maxImages < 1 && !logicalModelIDForConfig(generationConfig)) throw new Error("当前图片模型不支持参考图，请切换支持图片编辑或图生图的模型后再生成角色造型");
        promptTemplateVariables.角色设定 += `\n\n${identity.image ? characterIdentityConstraint(input.name) : input.referenceImage ? "以用户选定素材中的人物作为基础身份，保持其五官、脸型和可辨识特征，按已确认设定设计服装与造型。" : characterFaceDesignConstraint(input.name, facePreset!.role)}`;
        if (input.referenceImage && identity.image) promptTemplateVariables.角色设定 += "\n基础版身份参考为第一张图片，必须保持同一人脸；另外提供的素材仅用于本次造型、服装或构图参考，不得替换基础版身份。";
    }
    const styleExecutionPlan = input.projectStyle?.profile ? resolveStyleExecutionPlan(input.projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(generationConfig)) throw new Error(`当前图片模型无法完整执行项目画风：${styleExecutionPlan.warnings.join("；")}。请切换图片模型，或在项目设置中停用对应画风资产`);
    return dependencies.submitTask({
        projectId: input.projectId,
        mode: "image",
        prompt: promptTemplateTaskPlaceholder("角色三视图"),
        config: generationConfig,
        expectedScope,
        referenceImages: identity.image ? [{ id: `character-identity-${identity.image.resourceId}`, name: `${input.name}基础版身份参考`, type: "image/*", dataUrl: "", storageKey: `resource:${identity.image.resourceId}` }, ...(input.referenceImage && input.referenceImage.storageKey !== `resource:${identity.image.resourceId}` ? [input.referenceImage] : [])] : input.referenceImage ? [input.referenceImage] : facePreset ? [characterFaceReference(facePreset)] : [],
        metadata: { nodeId: `character-turnaround:${input.assetId}`, operation: PromptTemplateOperation.CharacterTurnaround, promptTemplateOperation: PromptTemplateOperation.CharacterTurnaround, promptTemplateVariables, characterAssetId: input.assetId, characterVersionId: input.versionId, characterIdentityVersionId: identity.reference?.versionId, characterIdentityResourceId: identity.image?.resourceId, stylePresetId: input.projectStyle?.id, styleProfileJson: input.projectStyle?.profile ? serializeStyleProfile(input.projectStyle.profile) : undefined, styleExecutionPlan, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
}
