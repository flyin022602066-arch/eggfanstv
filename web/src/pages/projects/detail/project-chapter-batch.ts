import { APP_STATE_STORE_NAME, localForageInstance } from "@/lib/localforage-storage";
import { scopedStorageKey } from "@/lib/user-scope";
import { assertUserScope, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";
import { runChapterBatch, type ChapterBatch, type ChapterBatchRow } from "@/lib/chapter-batch";
import { parseChapterAssetBreakdown, type ChapterAssetBreakdown } from "@/lib/canvas/chapter-asset-breakdown";
import { confirmProjectAssetCandidate, createProjectAssetCandidates, getProjectCore, getProjectUnitWorkspace, listProjectAssets, listChapterApplyReceipts, replaceProjectUnitShots, type ProjectDetail, type ProjectUnitWorkspace } from "@/services/api/projects";
import { getCharacterReferenceCatalog } from "@/services/api/project-character-references";
import { queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { ApiError } from "@/services/api/request";
import { extractChapterAssets, reviewChapterAssets, generateChapterStoryboard, chapterStoryboardFromGenerationTask, type ChapterAnalysisInput } from "./project-chapter-ai";
import { chapterStoryboardAssets, chapterStoryboardCharacters, storyboardRowsToProjectShots } from "./chapter-storyboard-production";
import type { AiConfig } from "@/stores/use-config-store";
import type { Skill } from "@/services/api/skills";
import type { ChapterDialogueConstraintMode, ChapterStoryboardMode } from "@/lib/chapter-storyboard-mode";
import type { SystemPresentationSettings } from "@/lib/chapter-system-presentation";

export type ChapterBatchSettings = {
    config: AiConfig; skills: Skill[]; selectedSkillIds: string[];
    projectStyle: { presetId: string; title: string; prompt: string; profileJson?: string };
    storyboardMode: ChapterStoryboardMode; dialogueConstraintMode: ChapterDialogueConstraintMode;
    systemPresentation: SystemPresentationSettings;
};
type Listener = (batch: ChapterBatch) => void;
type Runtime = { batch: ChapterBatch; scope: CapturedUserScope; stop: boolean; active: boolean; listeners: Set<Listener>; notify?: (text: string) => void };
const runtimes = new Map<string, Runtime>();
const store = localForageInstance(APP_STATE_STORE_NAME);
const keyFor = (projectId: string, scope: CapturedUserScope) => scopedStorageKey("chapter-batch:" + projectId, scope.userScope);
const snapshot = (batch: ChapterBatch) => structuredClone(batch);
export function chapterBatchTask(task: GenerationTask) {
    if (task.clientContext?.chapterBatchId || task.clientContext?.nodeId?.startsWith("chapter-batch:")) return true;
    try { return Boolean(JSON.parse(task.inputJson || "{}").metadata?.chapterBatchId); } catch { return false; }
}
export async function loadChapterBatch(projectId: string, scope: CapturedUserScope): Promise<ChapterBatch | null> {
    assertUserScope(scope);
    const runtime = runtimes.get(keyFor(projectId, scope));
    if (runtime && userScopeMatches(runtime.scope, scope)) return { ...snapshot(runtime.batch), status: runtime.active ? runtime.batch.status : runtime.batch.status === "completed" ? "completed" : "paused" };
    const saved = await store.getItem<ChapterBatch>(keyFor(projectId, scope));
    assertUserScope(scope);
    if (!saved || saved.projectId !== projectId) return null;
    return { ...saved, status: saved.status === "completed" ? "completed" : "paused" };
}
export function subscribeChapterBatch(projectId: string, scope: CapturedUserScope, listener: Listener) {
    const runtime = runtimes.get(keyFor(projectId, scope));
    if (!runtime || !userScopeMatches(runtime.scope, scope)) return () => {};
    runtime.listeners.add(listener);
    return () => { runtime.listeners.delete(listener); };
}
export function stopChapterBatch(projectId: string, scope: CapturedUserScope) {
    const runtime = runtimes.get(keyFor(projectId, scope));
    if (runtime && userScopeMatches(runtime.scope, scope)) runtime.stop = true;
}
export function chapterBatchIsActive(projectId: string, scope: CapturedUserScope) {
    const runtime = runtimes.get(keyFor(projectId, scope));
    return Boolean(runtime?.active && userScopeMatches(runtime.scope, scope));
}
export async function startChapterBatch(batch: ChapterBatch, scope: CapturedUserScope, settings: ChapterBatchSettings, listener: Listener, notify: (text: string) => void) {
    assertUserScope(scope);
    const key = keyFor(batch.projectId, scope);
    if (runtimes.get(key)?.active) throw new Error("本项目已有区间任务正在执行");
    const runtime: Runtime = { batch: snapshot(batch), scope, stop: false, active: true, listeners: new Set([listener]), notify };
    runtimes.set(key, runtime);
    let saving = Promise.resolve();
    const save = () => {
        assertUserScope(scope);
        const value = snapshot(runtime.batch);
        saving = saving.then(async () => { assertUserScope(scope); await store.setItem(key, value); if (userScopeMatches(scope)) for (const update of runtime.listeners) update(snapshot(value)); });
        return saving;
    };
    let writing = Promise.resolve();
    const write = async <T,>(job: () => Promise<T>) => {
        const previous = writing; let release!: () => void;
        writing = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try { assertUserScope(scope); return await job(); } finally { release(); }
    };
    const workspace = (row: ChapterBatchRow) => getProjectUnitWorkspace(batch.projectId, row.id, undefined, scope);
    const assertSource = (row: ChapterBatchRow, current: ProjectUnitWorkspace) => {
        if (row.sourceText !== undefined && row.sourceText !== current.unit.sourceText) throw new Error("本集正文已修改；已保留任务结果，请核对后重新建立区间任务");
    };
    const observe = async (row: ChapterBatchRow, phase: "extract" | "review" | "storyboard") => {
        const id = row.taskIds[phase];
        if (!id) return null;
        const task = await queryGenerationTask(id, { expectedScope: scope });
        if (task.status === "failed" || task.status === "cancelled") {
            row.attempts ??= {}; row.attempts[phase] = (row.attempts[phase] || 0) + 1;
            delete row.taskIds[phase]; await save(); return null;
        }
        return task.status === "succeeded" ? task : waitForGenerationTask(id, { initialTask: task, useTextEvents: true, expectedScope: scope });
    };
    const taskOptions = (row: ChapterBatchRow, phase: "extract" | "review" | "storyboard") => ({
        expectedScope: scope, batchId: batch.id, taskAttempt: row.attempts?.[phase] || 0,
        onTaskUpdate: (task: GenerationTask) => { if (row.taskIds[phase] === task.id) return; row.taskIds[phase] = task.id; void save().catch(() => { runtime.stop = true; }); },
    });
    const analysisInput = async (row: ChapterBatchRow): Promise<ChapterAnalysisInput> => {
        const [current, core, catalog] = await Promise.all([workspace(row), getProjectCore(batch.projectId, scope), getCharacterReferenceCatalog(batch.projectId, scope)]);
        assertUserScope(scope); assertSource(row, current);
        if (core.project.status === "archived") throw new Error("项目已归档，请先恢复项目");
        if (!chapterBatchPlainText(current.unit.sourceText)) throw new Error("本集正文为空，未提交模型");
        row.sourceText ??= current.unit.sourceText; await save();
        const revisions = new Map(current.shotRevisions.map((revision) => [revision.id, revision]));
        return {
            projectId: batch.projectId, projectName: core.project.name, chapterId: row.id, chapterTitle: current.unit.title,
            sourceText: chapterBatchPlainText(current.unit.sourceText), projectStyle: settings.projectStyle.prompt,
            config: settings.config, systemPresentation: settings.systemPresentation, existingCharacters: catalog.versions,
            storyboardContext: current.shots.map((shot) => ({ title: shot.title, plotDescription: revisions.get(shot.currentRevisionId || "")?.plotDescription || shot.description, videoPrompt: revisions.get(shot.currentRevisionId || "")?.videoPrompt || "" })).map((shot) => JSON.stringify(shot)).join("\n"),
        };
    };
    const extract = async (row: ChapterBatchRow, first?: ChapterAssetBreakdown) => {
        const input = await analysisInput(row), phase = first ? "review" : "extract";
        const recovered = await observe(row, phase);
        if (recovered) {
            const result = parseBackendGenerationResult(recovered);
            if (!result.text?.trim()) throw new Error("已完成任务没有可恢复的资产结果");
            const assets = parseChapterAssetBreakdown(result.text, input.sourceText, settings.systemPresentation);
            return assets;
        }
        return first ? reviewChapterAssets(input, first, taskOptions(row, phase)) : extractChapterAssets(input, taskOptions(row, phase));
    };
    try {
        await runChapterBatch(runtime.batch, {
            save, shouldStop: () => runtime.stop || !userScopeMatches(scope),
            extract: (row) => extract(row), review: (row, first) => extract(row, first),
            confirm: (row, assets) => write(async () => {
                let current = await workspace(row); assertSource(row, current);
                if (!row.candidateIds) {
                    const candidates = [
                        ...assets.characters.map((item) => ({ unitId: row.id, name: item.name, category: "character" as const, details: { ...item } })),
                        ...assets.scenes.map((item) => ({ unitId: row.id, name: item.name, category: "environment" as const, details: { ...item } })),
                        ...assets.props.map((item) => ({ unitId: row.id, name: item.name, category: "prop" as const, details: { ...item } })),
                    ];
                    if (!candidates.length) throw new Error("复核后仍无可用资产，未标记完成");
                    const created = await createProjectAssetCandidates(batch.projectId, candidates, "chapter_character_extract", { sourceTaskId: row.taskIds.extract, expectedScope: scope });
                    row.candidateIds = created.candidates.map((candidate) => candidate.id); await save();
                    current = await workspace(row);
                }
                for (const id of row.candidateIds) {
                    const candidate = current.assetCandidates.find((item) => item.id === id);
                    if (!candidate) throw new Error("本集候选资产已变化，请先核对资产列表");
                    if (candidate.status === "confirmed") continue;
                    if (candidate.status !== "pending_confirmation") throw new Error("资产“" + candidate.name + "”已被忽略，请手动核对");
                    await confirmProjectAssetCandidate(batch.projectId, id, undefined, scope); await save();
                }
                const confirmed = await workspace(row);
                if (row.candidateIds.some((id) => !confirmed.assetCandidates.some((item) => item.id === id && item.status === "confirmed"))) throw new Error("本集资产尚未全部确认入库");
            }),
            storyboard: async (row) => {
                const current = await workspace(row); assertSource(row, current);
                if (!row.approved && current.shots.length) { row.storyboard = "skipped"; await save(); return; }
                if (!row.approved) {
                    const core = await getProjectCore(batch.projectId, scope);
                    row.sourceText ??= current.unit.sourceText;
                    row.approved = { revision: core.project.revision, shotIds: current.shots.map((shot) => shot.id), fingerprint: chapterBatchShotFingerprint(current) }; await save();
                }
                const recovered = await observe(row, "storyboard");
                const generated = recovered ? { ...chapterStoryboardFromGenerationTask(recovered), taskId: recovered.id } : await (async () => {
                    const [core, { assets }, catalog] = await Promise.all([getProjectCore(batch.projectId, scope), listProjectAssets(batch.projectId, scope), getCharacterReferenceCatalog(batch.projectId, scope)]);
                    const detail: ProjectDetail = { ...current, project: core.project, assets, units: [current.unit], canvases: [], canvasUnitLinks: [], assetFolders: [] };
                    return generateChapterStoryboard({ projectId: batch.projectId, chapterId: row.id, chapterTitle: current.unit.title, sourceText: chapterBatchPlainText(current.unit.sourceText), projectStyle: settings.projectStyle, config: settings.config, characters: chapterStoryboardCharacters(detail, row.id), assets: chapterStoryboardAssets(detail, catalog.versions), skills: settings.skills, selectedSkillIds: settings.selectedSkillIds, storyboardMode: settings.storyboardMode, dialogueConstraintMode: settings.dialogueConstraintMode, systemPresentation: settings.systemPresentation, approvedRevision: row.approved!.revision, approvedShotIds: row.approved!.shotIds }, taskOptions(row, "storyboard"));
                })();
                await write(async () => {
                    const { receipts } = await listChapterApplyReceipts(batch.projectId, [generated.taskId], { expectedScope: scope });
                    if (receipts.some((receipt) => receipt.applied && receipt.kind === "storyboard")) return;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const [core, latest, { assets }, catalog] = await Promise.all([getProjectCore(batch.projectId, scope), workspace(row), listProjectAssets(batch.projectId, scope), getCharacterReferenceCatalog(batch.projectId, scope)]);
                        assertSource(row, latest);
                        if (chapterBatchShotFingerprint(latest) !== row.approved!.fingerprint) throw new Error("本集分镜已被修改；新结果已保留，不能自动覆盖，请核对后写入");
                        const shots = storyboardRowsToProjectShots(generated.rows, { ...latest, project: core.project, assets, units: [latest.unit], canvases: [], canvasUnitLinks: [], assetFolders: [] }, catalog.versions);
                        try { await replaceProjectUnitShots(batch.projectId, row.id, shots, latest.shots.map((shot) => shot.id), core.project.revision, { sourceTaskId: generated.taskId, expectedScope: scope }); break; }
                        catch (error) { if (!(error instanceof ApiError) || !["project_revision_conflict", "project_unit_shots_changed"].includes(error.reason || "") || attempt === 2) throw error; }
                    }
                });
                if (generated.promptReview.length) runtime.notify?.(row.title + "分镜已保存，有脚本核对提示，请查看技能调用状态");
            },
            notify: (row, kind) => { if (userScopeMatches(scope)) runtime.notify?.(row.title + (kind === "assets" ? "资产提取、复核并入库完成" : row.storyboard === "skipped" ? "已有分镜，已跳过" : "分镜已生成并写入")); },
        });
    } finally { runtime.active = false; }
    return snapshot(runtime.batch);
}

export function chapterBatchPlainText(source: string) {
    if (typeof DOMParser !== "undefined") return new DOMParser().parseFromString(source.replace(/<\/(?:p|div|h[1-6])>|<br\s*\/?>/gi, "\n"), "text/html").body.textContent?.trim() || "";
    return source.replace(/<[^>]+>/g, " ").trim();
}
export function chapterBatchShotFingerprint(workspace: ProjectUnitWorkspace) {
    return JSON.stringify({ shots: workspace.shots, revisions: workspace.shotRevisions, references: workspace.shotReferences, artifacts: workspace.shotArtifacts });
}
