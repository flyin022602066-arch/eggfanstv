import { APP_STATE_STORE_NAME, localForageInstance } from "@/lib/localforage-storage";
import { scopedStorageKey } from "@/lib/user-scope";
import { assertUserScope, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";
import { ChapterBatchReviewRequiredError, chapterBatchRowComplete, runChapterBatch, type ChapterBatch, type ChapterBatchRow } from "@/lib/chapter-batch";
import { parseChapterAssetBreakdown, type ChapterAssetBreakdown } from "@/lib/canvas/chapter-asset-breakdown";
import { confirmProjectAssetCandidate, createProjectAssetCandidates, getProjectCore, getProjectUnitWorkspace, listProjectAssets, listChapterApplyReceipts, replaceProjectUnitShots, type ProjectDetail, type ProjectUnitWorkspace } from "@/services/api/projects";
import { getCharacterReferenceCatalog } from "@/services/api/project-character-references";
import { queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import { ApiError } from "@/services/api/request";
import { extractChapterAssets, reviewChapterAssets, generateChapterStoryboard, chapterStoryboardFromGenerationTask, type ChapterAnalysisInput } from "./project-chapter-ai";
import { chapterStoryboardAssets, chapterStoryboardCharacters, repairStoryboardCharacterReferences, StoryboardCharacterReferenceError, storyboardRowsToProjectShots } from "./chapter-storyboard-production";
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
export async function completeChapterBatchStoryboardReview(projectId: string, chapterId: string, taskId: string, scope: CapturedUserScope) {
    assertUserScope(scope);
    const key = keyFor(projectId, scope), runtime = runtimes.get(key);
    if (runtime?.active) throw new Error("请先暂停区间任务，再核对已生成的结果");
    const batch = await loadChapterBatch(projectId, scope);
    const row = batch?.rows.find((item) => item.id === chapterId && item.taskIds.storyboard === taskId);
    if (!batch || !row) return;
    const { receipts } = await listChapterApplyReceipts(projectId, [taskId], { expectedScope: scope });
    if (!receipts.some((receipt) => receipt.taskId === taskId && receipt.applied && receipt.kind === "storyboard")) throw new Error("尚未确认分镜写入成功，原任务记录保留");
    row.storyboard = "completed"; row.storyboardNeedsReview = false;
    delete row.storyboardError; delete row.storyboardRetryAt;
    batch.status = batch.rows.every((item) => chapterBatchRowComplete(item, batch.mode)) ? "completed" : "paused";
    batch.updatedAt = Date.now();
    assertUserScope(scope); await store.setItem(key, batch); assertUserScope(scope);
    if (runtime) { runtime.batch = snapshot(batch); for (const listener of runtime.listeners) listener(snapshot(batch)); }
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
        if (row.sourceText !== undefined && row.sourceText !== current.unit.sourceText) throw new ChapterBatchReviewRequiredError("本集正文已修改；已保留任务结果，请核对后重新建立区间任务");
    };
    const discardResult = async (row: ChapterBatchRow, phase: "extract" | "review" | "storyboard") => {
        row.attempts ??= {}; row.attempts[phase] = (row.attempts[phase] || 0) + 1;
        delete row.taskIds[phase]; await save();
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
        if (core.project.status === "archived") throw new ChapterBatchReviewRequiredError("项目已归档，请先恢复项目");
        if (!chapterBatchPlainText(current.unit.sourceText)) throw new ChapterBatchReviewRequiredError("本集正文为空，未提交模型");
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
        const parse = (task: GenerationTask) => {
            const result = parseBackendGenerationResult(task);
            if (!result.text?.trim()) throw new Error("已完成任务没有可恢复的资产结果");
            return parseChapterAssetBreakdown(result.text, input.sourceText, settings.systemPresentation);
        };
        const recovered = await observe(row, phase);
        try {
            if (recovered) return parse(recovered);
            return await (first ? reviewChapterAssets(input, first, taskOptions(row, phase)) : extractChapterAssets(input, taskOptions(row, phase)));
        } catch (error) {
            const id = row.taskIds[phase];
            if (id) {
                const task = await queryGenerationTask(id, { expectedScope: scope }).catch(() => null);
                let invalid = task?.status === "failed" || task?.status === "cancelled";
                if (task?.status === "succeeded") { try { parse(task); } catch { invalid = true; } }
                if (invalid) await discardResult(row, phase);
            }
            throw error;
        }
    };
    try {
        for (const row of runtime.batch.rows) {
            if (runtime.batch.mode === "assets" || !["completed", "skipped"].includes(row.storyboard)) continue;
            const current = await workspace(row);
            if (current.shots.length >= 3) continue;
            row.storyboard = "pending"; delete row.approved;
            await discardResult(row, "storyboard");
        }
        await runChapterBatch(runtime.batch, {
            save, shouldStop: () => runtime.stop || !userScopeMatches(scope),
            shouldRetryAssets: (error) => !(error instanceof ChapterBatchReviewRequiredError) && !(error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status || 0)),
            shouldRetryStoryboard: (error) => !(error instanceof ChapterBatchReviewRequiredError) && !(error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status || 0)),
            extract: (row) => extract(row), review: (row, first) => extract(row, first),
            confirm: (row, assets) => write(async () => {
                let current = await workspace(row); assertSource(row, current);
                if (!row.candidateIds) {
                    const candidates = [
                        ...assets.characters.map((item) => ({ unitId: row.id, name: item.name, category: "character" as const, details: { ...item } })),
                        ...assets.scenes.map((item) => ({ unitId: row.id, name: item.name, category: "environment" as const, details: { ...item } })),
                        ...assets.props.map((item) => ({ unitId: row.id, name: item.name, category: "prop" as const, details: { ...item } })),
                    ];
                    if (!candidates.length) {
                        delete row.extracted; delete row.reviewed;
                        await discardResult(row, "extract"); await discardResult(row, "review");
                        throw new Error("复核后仍无可用资产，将重新提取，未标记完成");
                    }
                    const created = await createProjectAssetCandidates(batch.projectId, candidates, "chapter_character_extract", { sourceTaskId: row.taskIds.extract, expectedScope: scope });
                    row.candidateIds = created.candidates.map((candidate) => candidate.id); await save();
                    current = await workspace(row);
                }
                for (const id of row.candidateIds) {
                    const candidate = current.assetCandidates.find((item) => item.id === id);
                    if (!candidate) throw new ChapterBatchReviewRequiredError("本集候选资产已变化，请先核对资产列表");
                    if (candidate.status === "confirmed") continue;
                    if (candidate.status !== "pending_confirmation") throw new ChapterBatchReviewRequiredError("资产“" + candidate.name + "”已被忽略，请手动核对");
                    await confirmProjectAssetCandidate(batch.projectId, id, undefined, scope); await save();
                }
                const confirmed = await workspace(row);
                if (row.candidateIds.some((id) => !confirmed.assetCandidates.some((item) => item.id === id && item.status === "confirmed"))) throw new Error("本集资产尚未全部确认入库");
            }),
            storyboard: async (row) => {
                row.storyboardNeedsReview = false; row.storyboardRepairs = undefined;
                const current = await workspace(row); assertSource(row, current);
                if (!row.approved && current.shots.length >= 3) { row.storyboard = "skipped"; await save(); return; }
                if (!row.approved) {
                    const core = await getProjectCore(batch.projectId, scope);
                    row.sourceText ??= current.unit.sourceText;
                    row.approved = { revision: core.project.revision, shotIds: current.shots.map((shot) => shot.id), fingerprint: chapterBatchShotFingerprint(current) }; await save();
                }
                const generated = await (async () => {
                    const recovered = await observe(row, "storyboard");
                    try {
                        const result = recovered ? { ...chapterStoryboardFromGenerationTask(recovered), taskId: recovered.id } : await (async () => {
                            const [core, { assets }, catalog] = await Promise.all([getProjectCore(batch.projectId, scope), listProjectAssets(batch.projectId, scope), getCharacterReferenceCatalog(batch.projectId, scope)]);
                            if (core.project.status === "archived") throw new ChapterBatchReviewRequiredError("项目已归档，请先恢复项目");
                            if (!chapterBatchPlainText(current.unit.sourceText)) throw new ChapterBatchReviewRequiredError("本集正文为空，未提交模型");
                            const detail: ProjectDetail = { ...current, project: core.project, assets, units: [current.unit], canvases: [], canvasUnitLinks: [], assetFolders: [] };
                            return generateChapterStoryboard({ projectId: batch.projectId, chapterId: row.id, chapterTitle: current.unit.title, sourceText: chapterBatchPlainText(current.unit.sourceText), projectStyle: settings.projectStyle, config: settings.config, characters: chapterStoryboardCharacters(detail, row.id), assets: chapterStoryboardAssets(detail, catalog.versions), skills: settings.skills, selectedSkillIds: settings.selectedSkillIds, storyboardMode: settings.storyboardMode, dialogueConstraintMode: settings.dialogueConstraintMode, systemPresentation: settings.systemPresentation, approvedRevision: row.approved!.revision, approvedShotIds: row.approved!.shotIds }, taskOptions(row, "storyboard"));
                        })();
                        if (result.rows.length < 3) throw new Error(`本次仅返回${result.rows.length}个分镜，未写入，将重新拆解完整章节`);
                        return result;
                    } catch (error) {
                        const id = row.taskIds.storyboard;
                        if (id) {
                            const task = await queryGenerationTask(id, { expectedScope: scope }).catch(() => null);
                            let invalid = task?.status === "failed" || task?.status === "cancelled";
                            if (task?.status === "succeeded") {
                                try { invalid = chapterStoryboardFromGenerationTask(task).rows.length < 3; } catch { invalid = true; }
                            }
                            if (invalid) await discardResult(row, "storyboard");
                        }
                        throw error;
                    }
                })();
                await write(async () => {
                    const { receipts } = await listChapterApplyReceipts(batch.projectId, [generated.taskId], { expectedScope: scope });
                    if (receipts.some((receipt) => receipt.taskId === generated.taskId && receipt.applied && receipt.kind === "storyboard")) return;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const [core, latest, { assets }, catalog] = await Promise.all([getProjectCore(batch.projectId, scope), workspace(row), listProjectAssets(batch.projectId, scope), getCharacterReferenceCatalog(batch.projectId, scope)]);
                        assertSource(row, latest);
                        if (chapterBatchShotFingerprint(latest) !== row.approved!.fingerprint) throw new ChapterBatchReviewRequiredError("本集分镜已被修改；新结果已保留，不能自动覆盖，请核对后写入");
                        const detail: ProjectDetail = { ...latest, project: core.project, assets, units: [latest.unit], canvases: [], canvasUnitLinks: [], assetFolders: [] };
                        const reviewed = repairStoryboardCharacterReferences(generated.rows, detail, catalog.versions);
                        if (reviewed.issues.length) {
                            row.storyboardNeedsReview = true;
                            throw new ChapterBatchReviewRequiredError(new StoryboardCharacterReferenceError(reviewed.issues).message + "\n已保留本次拆解结果，点击本集的「核对引用」后写入；不会反复重试或重新调用模型，后续集数继续处理。");
                        }
                        const shots = storyboardRowsToProjectShots(reviewed.rows, detail, catalog.versions);
                        try {
                            await replaceProjectUnitShots(batch.projectId, row.id, shots, latest.shots.map((shot) => shot.id), core.project.revision, { sourceTaskId: generated.taskId, expectedScope: scope });
                            row.storyboardRepairs = reviewed.repairs;
                            break;
                        }
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
