import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder } from "@/lib/prompts";
import { storyboardRowsFromTask, storyboardRowsOutputContract } from "@/lib/canvas/canvas-project-domain";
import { parseChapterAssetBreakdown, type ChapterAssetBreakdown } from "@/lib/canvas/chapter-asset-breakdown";
import { extractChapterSystemInterfaceProps } from "@/lib/chapter-system-interface";
import { normalizeSystemPresentationSettings, systemPresentationRule, type SystemPresentationSettings } from "@/lib/chapter-system-presentation";
import { projectCharacterAppearances } from "@/lib/project-asset-mentions";
import type { StoryboardRow } from "@/types/canvas";
import { parseCharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import { backendProviderConfig, parseBackendGenerationResult } from "@/services/api/generation-task";
import type { CapturedUserScope } from "@/lib/user-scope-guard";
import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { Skill } from "@/services/api/skills";
import { skillRuntime, type SkillLoadReport } from "@/services/skill-runtime";
import { logicalModelIDForConfig, type AiConfig } from "@/stores/use-config-store";
import { chapterStoryboardCinematographyRequirements, chapterStoryboardRequirements, chapterStoryboardSourcePrompt, chapterStoryboardReviewPolicy, extractSystemElementBlocks, reviewChapterStoryboardPrompt, reviewChapterDialogueCoverage, type ChapterDialogueConstraintMode, type ChapterStoryboardMode, type ChapterStoryboardReviewPolicy } from "@/lib/chapter-storyboard-mode";

import type { ChapterStoryboardAsset, ChapterStoryboardCharacter } from "./chapter-storyboard-production";
import type { CharacterReferenceVersion } from "@/services/api/project-character-references";

type ChapterAnalysisInput = {
    projectId: string;
    projectName: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: string;
    config: AiConfig;
    systemPresentation?: SystemPresentationSettings;
    storyboardContext?: string;
    existingCharacters?: CharacterReferenceVersion[];
};

type ChapterTaskOptions = {
    onTaskUpdate?: (task: GenerationTask) => void;
    onSkillLoadReport?: (report: SkillLoadReport[]) => void;
    expectedScope?: CapturedUserScope;
};

export type ChapterTaskKind = "characters" | "storyboard";

export type ChapterStoryboardApprovalSnapshot = {
    revision: number;
    shotIds: string[];
};

export type ChapterStoryboardRecoveryDecision =
    | { action: "skip" }
    | { action: "apply" }
    | { action: "review" };

export function chapterTaskIdentity(task: GenerationTask): { chapterId: string; kind: ChapterTaskKind } | null {
    const context = task.clientContext;
    if (context?.chapterId && (context.chapterOperation === "characters" || context.chapterOperation === "storyboard")) {
        return { chapterId: context.chapterId, kind: context.chapterOperation };
    }
    const metadata = generationTaskMetadata(task.inputJson);
    const chapterId = typeof metadata.chapterId === "string" ? metadata.chapterId : "";
    if (!chapterId) return null;
    if (metadata.operation === "chapter_character_breakdown") return { chapterId, kind: "characters" };
    if (metadata.source === "short-drama-chapter-storyboard") return { chapterId, kind: "storyboard" };
    return null;
}

export function chapterAssetsFromGenerationTask(task: GenerationTask) {
    const result = parseBackendGenerationResult(task);
    if (!result.text?.trim()) throw new Error("模型没有返回可用的章节资产提取结果");
    // 历史角色任务的输出契约只有角色；仅按明确的模板操作恢复，不能给新任务缺字段兜底。
    if (generationTaskMetadata(task.inputJson).promptTemplateOperation === PromptTemplateOperation.CharacterExtract) {
        return { characters: parseCharacterBreakdown(result.text), scenes: [], props: [] };
    }
    const variables = generationTaskMetadata(task.inputJson).promptTemplateVariables as Record<string, unknown> | undefined;
    return parseChapterAssetBreakdown(result.text, typeof variables?.章节正文 === "string" ? variables.章节正文 : "", normalizeSystemPresentationSettings({
        mode: variables?.系统表现模式,
        characterName: variables?.系统角色名称,
        characterAppearance: variables?.系统角色形象,
        characterVoice: variables?.系统角色声音,
    }));
}

export function chapterStoryboardFromGenerationTask(task: GenerationTask) {
    const result = storyboardRowsFromTask(task);
    const metadata = generationTaskMetadata(task.inputJson);
    const systemPresentation = normalizeSystemPresentationSettings(metadata.systemPresentation);
    let context: { characters?: ChapterStoryboardCharacter[]; canvasAssets?: ChapterStoryboardAsset[] } = {};
    try { context = JSON.parse(task.inputJson || "{}"); } catch { context = {}; }
    const scoped = scopeChapterStoryboardRows(result.rows, typeof metadata.chapterSourceText === "string" ? metadata.chapterSourceText : "", Array.isArray(context?.characters) ? context.characters : Array.isArray(metadata.storyboardCharacters) ? metadata.storyboardCharacters as ChapterStoryboardCharacter[] : [], Array.isArray(context?.canvasAssets) ? context.canvasAssets : Array.isArray(metadata.storyboardAssets) ? metadata.storyboardAssets as ChapterStoryboardAsset[] : [], systemPresentation);
    const rows = ensureProtectedSystemElements(scoped, Array.isArray(metadata.protectedSystemElements) ? metadata.protectedSystemElements : [], systemPresentation);
    return { ...result, rows, promptReview: metadata.storyboardMode === "continuous_30s" ? [...reviewChapterStoryboardPrompt(rows, chapterStoryboardTaskReviewPolicy(task)), ...reviewChapterDialogueCoverage(typeof metadata.chapterSourceText === "string" ? metadata.chapterSourceText : "", rows)] : [] };
}

function chapterStoryboardTaskReviewPolicy(task: GenerationTask): ChapterStoryboardReviewPolicy {
    const saved = generationTaskMetadata(task.inputJson).storyboardPromptReview as ChapterStoryboardReviewPolicy | undefined;
    if (saved && typeof saved === "object") return {
        ...(saved.maxInternalShotSeconds === 4 ? { maxInternalShotSeconds: 4 } : {}),
        ...(saved.minDirectorScriptChars === 1000 ? { minDirectorScriptChars: 1000 } : {}),
        ...(saved.directorFormat === "shots-v1" ? { directorFormat: "shots-v1" } : {}),
    };
    // 历史任务用当时发送的技能部分核对，不能套用今天的技能选择或正文中的数字。
    const boundary = task.prompt.indexOf("【用户任务】");
    return boundary >= 0 ? chapterStoryboardReviewPolicy(task.prompt.slice(0, boundary)) : {};
}

export function chapterStoryboardAssetPromptContext(assets: ChapterStoryboardAsset[], sourceText: string) {
    const relevant = assets.filter((asset) => asset.type === "character" || asset.category === "character" || [asset.title, ...(asset.aliases || [])].some((name) => name.length >= 2 && sourceText.includes(name)));
    return [
        "【本项目资产白名单】以下紧凑数组每项依次为[id,标准名称,类别,别名数组]。只提供可引用身份，不代表本章出镜；按正文实际地点与可见物件匹配，禁止把资产背景当剧情。",
        JSON.stringify(assets.map((asset) => [asset.id, asset.title, asset.category || asset.type, asset.aliases || []])),
        "【本章相关资产外形参考】仅作外形及造型匹配，剧情、系统数值及动作以本章原文为准。",
        JSON.stringify(relevant.map((asset) => ({
            id: asset.id,
            description: chapterAssetDescription(asset.prompt),
            ...(asset.characterVersionId ? { characterVersionId: asset.characterVersionId } : {}),
            ...(asset.characterLooks?.length ? { characterLooks: asset.characterLooks } : {}),
        }))),
    ].join("\n");
}

function chapterAssetDescription(prompt: string) {
    let description = prompt;
    try {
        const definition = JSON.parse(prompt);
        description = typeof definition?.description === "string" ? definition.description : "";
    } catch { /* 非结构化的旧素材仅提供短外形参考，不传整段制图指令。 */ }
    return description.slice(0, 320);
}

export function chapterStoryboardApprovalSnapshot(inputJson?: string): ChapterStoryboardApprovalSnapshot | null {
    const metadata = generationTaskMetadata(inputJson);
    const revision = metadata.approvedRevision;
    const shotIds = metadata.approvedShotIds;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision <= 0) return null;
    if (!Array.isArray(shotIds) || !shotIds.every((id) => typeof id === "string")) return null;
    return { revision, shotIds: shotIds.slice() };
}

export function chapterStoryboardRecoveryDecision(input: { alreadyApplied: boolean; approved?: ChapterStoryboardApprovalSnapshot | null; current?: ChapterStoryboardApprovalSnapshot }): ChapterStoryboardRecoveryDecision {
    if (input.alreadyApplied) return { action: "skip" };
    if (input.approved && input.current && input.approved.revision === input.current.revision
        && input.approved.shotIds.length === input.current.shotIds.length
        && input.approved.shotIds.every((id, index) => id === input.current!.shotIds[index])) return { action: "apply" };
    return { action: "review" };
}

export async function extractChapterAssets(input: ChapterAnalysisInput, options?: ChapterTaskOptions): Promise<ChapterAssetBreakdown & { taskId: string }> {
    const systemPresentation = normalizeSystemPresentationSettings(input.systemPresentation);
    const result = await runProjectTextTask(input, "chapter_character_breakdown", {
        项目名称: input.projectName,
        章节名称: input.chapterTitle,
        项目画风: input.projectStyle || "项目尚未指定画风，保持视觉描述中性、可执行。",
        章节正文: input.sourceText,
        章节分镜: input.storyboardContext || "尚无分镜；按正文推定叙事需要，不为普通物件虚构重复出镜。",
        已有角色与造型: JSON.stringify((input.existingCharacters || []).map((character) => ({ assetId:character.assetId, name:character.title, versionId:character.versionId, definition:character.definition, look:character.referenceProfile }))),
        系统表现模式: systemPresentation.mode,
        系统角色名称: systemPresentation.characterName,
        系统角色形象: systemPresentation.characterAppearance,
        系统角色声音: systemPresentation.characterVoice,
    }, options);
    return { ...parseChapterAssetBreakdown(result.text, input.sourceText, systemPresentation), taskId: result.taskId };
}

type ChapterStoryboardGenerationInput = {
    projectId: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: { presetId: string; title: string; prompt: string; profileJson?: string };
    characters: ChapterStoryboardCharacter[];
    assets: ChapterStoryboardAsset[];
    config: AiConfig;
    skills: Skill[];
    selectedSkillIds: string[];
    storyboardMode?: ChapterStoryboardMode;
    dialogueConstraintMode?: ChapterDialogueConstraintMode;
    systemPresentation?: SystemPresentationSettings;
    approvedRevision: number;
    approvedShotIds: string[];
};

export async function generateChapterStoryboard(input: ChapterStoryboardGenerationInput, options?: ChapterTaskOptions) {
    if (!Number.isInteger(input.approvedRevision) || input.approvedRevision <= 0) {
        throw new Error("请刷新后再生成分镜");
    }
    if (!Array.isArray(input.approvedShotIds) || input.approvedShotIds.some((id) => typeof id !== "string")) {
        throw new Error("请刷新后再生成分镜");
    }
    const model = input.config.textModel || input.config.model;
    const config = { ...input.config, model };
    const mode = input.storyboardMode || "standard";
    const dialogueConstraintMode = input.dialogueConstraintMode || "paced";
    const systemPresentation = normalizeSystemPresentationSettings(input.systemPresentation);
    const identities = chapterCharacterIdentities(input.characters, input.assets);
    const visibleCharacters = new Set(projectCharacterAppearances(input.sourceText, identities));
    const systemName = chapterSystemCharacterName(input.sourceText, systemPresentation);
    const visibleIdentity = (name: string, assetId?: string) => identities.some((identity) => (assetId ? identity.assetId === assetId : identity.name === name) && (visibleCharacters.has(identity) || identity.name === systemName));
    const characters = input.characters.filter((character) => visibleIdentity(character.name, character.assetId));
    const assets = input.assets.filter((asset) => asset.type === "character" || asset.category === "character"
        ? visibleIdentity(asset.title, asset.id)
        : true);
    const protectedSystemElements = extractSystemElementBlocks(input.sourceText).map((text) => {
        const normalizedSource = input.sourceText.replace(/\r\n?/g, "\n");
        const position = normalizedSource.indexOf(text);
        return { text, positionRatio: position < 0 || !normalizedSource.length ? 0 : position / normalizedSource.length };
    });
    const skillExecution = await skillRuntime.prepare({
        profile: "shortDrama",
        prompt: chapterStoryboardSourcePrompt(input.chapterTitle, input.sourceText),
        skills: input.skills,
        selectedSkillIds: input.selectedSkillIds,
    });
    options?.onSkillLoadReport?.(skillExecution.metadata.skillLoadReport || []);
    const skillBoundary = skillExecution.prompt.indexOf("【用户任务】");
    const loadedPolicy = chapterStoryboardReviewPolicy(skillBoundary >= 0 ? skillExecution.prompt.slice(0, skillBoundary) : "");
    const reviewPolicy: ChapterStoryboardReviewPolicy = mode === "continuous_30s" ? {
        minDirectorScriptChars: 1000,
        ...loadedPolicy,
        ...(loadedPolicy.maxInternalShotSeconds === 4 ? { directorFormat: "shots-v1" } : {}),
    } : {};
    const requirements = [
        chapterStoryboardRequirements(mode, dialogueConstraintMode, systemPresentation, reviewPolicy.directorFormat),
        reviewPolicy.directorFormat ? "" : chapterStoryboardCinematographyRequirements(input.skills, input.selectedSkillIds),
    ].filter(Boolean).join("\n\n");
    const prompt = [
        skillBoundary >= 0 ? skillExecution.prompt.slice(0, skillBoundary) : skillExecution.prompt,
        chapterStoryboardAssetPromptContext(assets, input.sourceText),
        "【本章出镜边界】本章正文是角色出镜的唯一事实来源；项目资产、其他章节角色、旧分镜、自动绑定、素材定义和对白提及均不能自证出镜。只为本章实际可见角色规划镜头；characters、人物 assetBindings 与资产 token 也必须有本镜画面行动依据，不编造反打、闪回、照片来安排未出场者。保留真实说话人与原台词，纯画外音只保留声音。",
        "角色若包含 characterLooks，里面的 versionId 才是可用造型定稿。按原文明示的服装、年龄、形态和同场景接戏选择对应 characterVersionId；信息不足不要猜，写入后交由用户识别确认。换装、变身或同人不同年龄同框需拆为独立生成镜头，禁止把其他角色的版本 ID 填入当前角色。",
        `【本章角色定义】\n${JSON.stringify(characters)}`,
        requirements,
        skillBoundary >= 0 ? skillExecution.prompt.slice(skillBoundary) : "",
        storyboardRowsOutputContract("每个生成单元必须能独立用于生成首帧图片和镜头视频。", mode, reviewPolicy),
    ].join("\n\n");
    const task = await createGenerationTask({
        projectId: input.projectId,
        type: "canvas_text",
        operation: "storyboard",
        prompt,
        model,
        ...(logicalModelIDForConfig(config) ? { logicalModelId: logicalModelIDForConfig(config) } : {}),
        input: {
            // 后端只在 video_ 前缀的任务上兜底 mode，文本任务必须显式带上。
            mode: "text",
            canvasAssets: assets,
            requirements,
            projectStyle: input.projectStyle,
            characters,
            shotDurationSeconds: mode === "continuous_30s" ? 30 : 0,
            shotCount: 0,
            config: backendProviderConfig(config, "text"),
            metadata: {
                domainProjectId: input.projectId,
                chapterId: input.chapterId,
                chapterSourceText: input.sourceText,
                storyboardCharacters: characters.map(({ assetId, versionId, name, definition }) => ({ assetId, versionId, name, definition: { aliases: definition.aliases } })),
                storyboardAssets: assets.map(({ id, title, type, category, aliases }) => ({ id, title, type, category, aliases })),
                source: "short-drama-chapter-storyboard",
                storyboardMode: mode,
                storyboardPromptReview: reviewPolicy,
                ...(reviewPolicy.directorFormat === "shots-v1" ? { storyboardExecution: "planned-director-v1" } : {}),
                dialogueConstraintMode,
                systemPresentation,
                protectedSystemElements,
                ...skillExecution.metadata,
                approvedRevision: input.approvedRevision,
                approvedShotIds: input.approvedShotIds.slice(),
            },
        },
    }, options?.expectedScope ? { expectedScope: options.expectedScope } : undefined);
    options?.onTaskUpdate?.(task);
    const completed = await waitForGenerationTask(task.id, { initialTask: task, useTextEvents: true, onTaskUpdate: options?.onTaskUpdate, expectedScope: options?.expectedScope });
    const result = storyboardRowsFromTask(completed);
    const rows = ensureProtectedSystemElements(scopeChapterStoryboardRows(result.rows, input.sourceText, input.characters, input.assets, systemPresentation), protectedSystemElements, systemPresentation);
    return { ...result, rows, promptReview: mode === "continuous_30s" ? [...reviewChapterStoryboardPrompt(rows, reviewPolicy), ...reviewChapterDialogueCoverage(input.sourceText, rows)] : [], skillCount: skillExecution.selectedSkills.length, skillLoadReport: skillExecution.metadata.skillLoadReport || [], taskId: completed.id };
}

function chapterCharacterIdentities(characters: ChapterStoryboardCharacter[], assets: ChapterStoryboardAsset[]) {
    return [
        ...characters.map((character) => ({ name: character.name, assetId: character.assetId, aliases: character.definition?.aliases })),
        ...assets.filter((asset) => asset.type === "character" || asset.category === "character").map((asset) => ({ name: asset.title, assetId: asset.id, aliases: asset.aliases })),
    ];
}

function chapterSystemCharacterName(sourceText: string, settings: SystemPresentationSettings) {
    if (settings.mode !== "character") return undefined;
    return parseChapterAssetBreakdown('{"characters":[],"scenes":[],"props":[]}', sourceText, settings).characters[0]?.name;
}

function scopeChapterStoryboardRows(rows: StoryboardRow[], sourceText: string, characters: ChapterStoryboardCharacter[], assets: ChapterStoryboardAsset[], settings: SystemPresentationSettings) {
    if (!sourceText.trim()) return rows;
    const identities = [
        ...chapterCharacterIdentities(characters, assets),
        ...rows.flatMap((row) => row.characters.map((character) => typeof character === "string" ? { name: character, assetId: undefined, aliases: undefined } : { name: character.characterName, assetId: character.characterAssetId, aliases: undefined })),
    ];
    const chapterVisible = new Set(projectCharacterAppearances(sourceText, identities));
    const systemName = chapterSystemCharacterName(sourceText, settings);
    const knownAssets = new Set(assets.map((asset) => asset.id));
    return rows.map((row) => {
        const visualText = [row.plotDescription, row.performanceBlocking, row.imageGenerationPrompt, row.videoMotionPrompt, row.timeBeats].filter(Boolean).join("\n");
        const rowVisible = new Set(projectCharacterAppearances(visualText, identities));
        const present = (name: string, assetId?: string) => identities.some((identity) => (assetId ? identity.assetId === assetId : identity.name === name) && ((chapterVisible.has(identity) && rowVisible.has(identity)) || identity.name === systemName && Boolean(row.systemElements?.length)));
        return {
            ...row,
            characters: row.characters.filter((character) => typeof character === "string" ? present(character) : present(character.characterName, character.characterAssetId)),
            assetBindings: row.assetBindings.filter((binding) => {
                const identity = identities.find((character) => character.assetId === binding.nodeId);
                return identity ? present(identity.name, identity.assetId) : binding.role !== "character" && knownAssets.has(binding.nodeId);
            }),
        };
    });
}

function ensureProtectedSystemElements(rows: StoryboardRow[], protectedBlocks: unknown[], systemPresentation: SystemPresentationSettings): StoryboardRow[] {
    if (!rows.length) return rows;
    const blocks = protectedBlocks.flatMap((value) => {
        if (typeof value === "string" && value.trim()) return [{ text: value.trim(), positionRatio: 0 }];
        if (!value || typeof value !== "object") return [];
        const block = value as { text?: unknown; positionRatio?: unknown };
        if (typeof block.text !== "string" || !block.text.trim()) return [];
        const positionRatio = typeof block.positionRatio === "number" && Number.isFinite(block.positionRatio)
            ? Math.min(1, Math.max(0, block.positionRatio))
            : 0;
        return [{ text: block.text.trim(), positionRatio }];
    });
    const next = rows.slice();
    for (const block of blocks) {
        if (next.some((row) => (row.systemElements || []).join("\n").includes(block.text))) continue;
        const rowIndex = Math.min(next.length - 1, Math.floor(block.positionRatio * next.length));
        const row = next[rowIndex]!;
        next[rowIndex] = {
            ...row,
            systemElements: [...(row.systemElements || []), block.text],
        };
    }
    return next.map((row) => {
        if (!row.systemElements?.length) return row;
        const characters = row.characters || [];
        const hasSystemCharacter = characters.some((character) => typeof character === "string" ? character === systemPresentation.characterName : character.characterName === systemPresentation.characterName);
        return {
            ...row,
            systemPresentation,
            characters: systemPresentation.mode === "character" && !hasSystemCharacter ? [...characters, { characterName: systemPresentation.characterName }] : characters,
            imageGenerationPrompt: appendProtectedSystemElement(row.imageGenerationPrompt, row.systemElements.join("\n"), systemPresentation),
            videoMotionPrompt: appendProtectedSystemElement(row.videoMotionPrompt, row.systemElements.join("\n"), systemPresentation),
        };
    });
}

function appendProtectedSystemElement(prompt: string | undefined, element: string, systemPresentation: SystemPresentationSettings) {
    const text = prompt?.trim() || "";
    return [
        text,
        "【系统/界面元素】",
        text.includes(element) ? "" : element,
        systemPresentation.mode === "character" ? systemPresentationRule(systemPresentation) : extractChapterSystemInterfaceProps(element).length
            ? "将其作为画面内系统界面、状态面板或提示框呈现，保留原文内容。"
            : "按原文保留提示音或播报，未明确可见表现时不额外添加画面元素。",
    ].filter(Boolean).join("\n");
}

async function runProjectTextTask(input: ChapterAnalysisInput, operation: string, promptTemplateVariables: Record<string, string>, options?: ChapterTaskOptions) {
    const model = input.config.textModel || input.config.model;
    let taskId = "";
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `${operation}:${input.chapterId}`,
        mode: "text",
        prompt: promptTemplateTaskPlaceholder("章节角色、场景与道具提取"),
        streamText: true,
        config: { ...input.config, model },
        metadata: { domainProjectId: input.projectId, chapterId: input.chapterId, operation, promptTemplateOperation: PromptTemplateOperation.ChapterAssetsExtract, promptTemplateVariables },
        onTaskCreated: (task) => {
            taskId = task.id;
            options?.onTaskUpdate?.(task);
        },
        expectedScope: options?.expectedScope,
    });
    if (!result.text?.trim()) throw new Error("模型没有返回可用结果");
    if (!taskId) throw new Error("生成任务身份缺失");
    return { text: result.text, taskId };
}

function generationTaskMetadata(inputJson?: string): Record<string, unknown> {
    if (!inputJson) return {};
    try {
        const input = JSON.parse(inputJson) as { metadata?: unknown };
        return input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : {};
    } catch {
        return {};
    }
}
