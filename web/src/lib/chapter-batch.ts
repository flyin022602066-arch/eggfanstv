import type { ChapterAssetBreakdown } from "@/lib/canvas/chapter-asset-breakdown";
import type { CharacterBreakdown, CharacterLookDefinition } from "@/lib/canvas/canvas-character-reference";

export type ChapterBatchMode = "assets" | "storyboards" | "linked";
export type ChapterBatchStep = "pending" | "running" | "retrying" | "completed" | "skipped" | "failed";
export type ChapterBatchRow = {
    id: string; title: string;
    assets: ChapterBatchStep; storyboard: ChapterBatchStep;
    phase?: "extract" | "review" | "confirm";
    assetError?: string; storyboardError?: string;
    assetRetries?: number;
    storyboardRetries?: number; storyboardRetryAt?: number;
    storyboardNeedsReview?: boolean;
    storyboardRepairs?: Array<{ shotLabel: string; characterName: string; previousVersionId: string; versionId: string }>;
    extracted?: ChapterAssetBreakdown; reviewed?: ChapterAssetBreakdown;
    taskIds: Partial<Record<"extract" | "review" | "storyboard", string>>;
    sourceText?: string;
    approved?: { revision: number; shotIds: string[]; fingerprint: string };
    candidateIds?: string[];
    attempts?: Partial<Record<"extract" | "review" | "storyboard", number>>;
};
export type ChapterBatch = {
    id: string; projectId: string; mode: ChapterBatchMode;
    status: "running" | "paused" | "completed";
    rows: ChapterBatchRow[]; updatedAt: number;
};
export class ChapterBatchReviewRequiredError extends Error {}
export function chapterBatchRange<T>(units: T[], start: number, end: number): T[] {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > units.length) throw new Error("请选择有效的起止集数");
    return units.slice(start - 1, end);
}
export function createChapterBatch(projectId: string, units: Array<{ id: string; title: string }>, mode: ChapterBatchMode): ChapterBatch {
    if (!projectId || !units.length || new Set(units.map((unit) => unit.id)).size !== units.length || units.some((unit) => !unit.id)) throw new Error("批量任务的项目或章节无效");
    return { id: crypto.randomUUID(), projectId, mode, status: "paused", updatedAt: Date.now(), rows: units.map((unit) => ({ id: unit.id, title: unit.title, assets: mode === "storyboards" ? "skipped" : "pending", storyboard: mode === "assets" ? "skipped" : "pending", taskIds: {} })) };
}
export function resumeChapterBatch(previous: ChapterBatch, mode: ChapterBatchMode): ChapterBatch {
    const batch = structuredClone(previous);
    for (const row of batch.rows) {
        if (previous.mode === "storyboards" && mode !== "storyboards" && row.assets === "skipped") row.assets = "pending";
        if (previous.mode === "assets" && mode !== "assets" && row.storyboard === "skipped") row.storyboard = "pending";
    }
    return { ...batch, mode, status: "paused", updatedAt: Date.now() };
}
export function chapterBatchRowComplete(row: ChapterBatchRow, mode: ChapterBatchMode): boolean {
    return (mode === "storyboards" || ["completed", "skipped"].includes(row.assets)) && (mode === "assets" || ["completed", "skipped"].includes(row.storyboard));
}

export function mergeChapterBatchAssets(first: ChapterAssetBreakdown, supplement: ChapterAssetBreakdown): ChapterAssetBreakdown {
    const merge = <T extends { name: string; aliases?: string[] }>(left: T[], right: T[], combine: (base: T, addition: T) => T): T[] => {
        const result = left.map((item) => ({ ...item }));
        const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();
        const names = (item: T) => [item.name, ...(item.aliases || [])].map(normalize);
        for (const addition of right) {
            const matches = result.flatMap((item, index) => names(item).includes(normalize(addition.name)) || names(addition).includes(normalize(item.name)) ? [index] : []);
            if (matches.length > 1) throw new ChapterBatchReviewRequiredError(`资产“${addition.name}”对应多个已有身份，请先手动核对`);
            const index = matches[0];
            if (index === undefined) result.push({ ...addition });
            else {
                const base = result[index]!;
                result[index] = { ...combine(base, addition), aliases: [...new Set([...(base.aliases || []), addition.name, ...(addition.aliases || [])])].filter((name) => name !== base.name) };
            }
        }
        return result;
    };
    return {
        characters: merge(first.characters, supplement.characters, (base, addition) => {
            if (!addition.looks?.length) return base;
            const looks: CharacterLookDefinition[] = (base.looks || (base.clothing.trim() ? [{ name: "默认造型", clothing: base.clothing, appearance: base.appearance, physique: base.physique, props: base.props }] : [])).map((look) => ({ ...look }));
            const visualKey = (look: CharacterLookDefinition, owner: CharacterBreakdown) => JSON.stringify([look.clothing, look.appearance || owner.appearance, look.physique || owner.physique, look.props ?? (look.clothing === owner.clothing && !look.state ? owner.props : ""), look.ageStage, look.hairstyle, look.state].map((value) => (value || "").normalize("NFKC").trim()));
            const keys = new Set(looks.map((look) => visualKey(look, base)));
            for (const look of addition.looks || []) {
                const key = visualKey(look, addition);
                if (keys.has(key)) continue;
                let name = look.name;
                for (let suffix = 2; looks.some((existing) => existing.name === name); suffix++) name = look.name.slice(0, 65) + "（" + suffix + "）";
                looks.push({ ...look, name, appearance: look.appearance || addition.appearance, physique: look.physique || addition.physique });
                keys.add(key);
            }
            return { ...base, ...(looks.length ? { looks } : {}) };
        }),
        scenes: merge(first.scenes, supplement.scenes, (base) => base),
        props: merge(first.props, supplement.props, (base) => base),
    };
}

export type ChapterBatchAdapter = {
    save(): Promise<void>;
    shouldStop(): boolean;
    extract(row: ChapterBatchRow): Promise<ChapterAssetBreakdown>;
    review(row: ChapterBatchRow, extracted: ChapterAssetBreakdown): Promise<ChapterAssetBreakdown>;
    confirm(row: ChapterBatchRow, assets: ChapterAssetBreakdown): Promise<void>;
    storyboard(row: ChapterBatchRow): Promise<void>;
    shouldRetryAssets?(error: unknown): boolean;
    shouldRetryStoryboard?(error: unknown): boolean;
    waitForRetry?(milliseconds: number): Promise<void>;
    notify?(row: ChapterBatchRow, kind: "assets" | "storyboard"): void;
};

export async function runChapterBatch(batch: ChapterBatch, adapter: ChapterBatchAdapter): Promise<void> {
    let checkpointError: Error | undefined;
    const save = async () => {
        if (checkpointError) throw checkpointError;
        batch.updatedAt = Date.now();
        try { await adapter.save(); }
        catch (error) { checkpointError = error instanceof Error ? error : new Error("区间任务进度保存失败"); throw checkpointError; }
    };
    const stopped = () => Boolean(checkpointError) || adapter.shouldStop();
    const waitForRetry = adapter.waitForRetry || (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    let assetBlocked = false;
    const storyboardQueue: ChapterBatchRow[] = [];
    let storyboardWorker: Promise<void> | undefined;
    const enqueueStoryboard = (row: ChapterBatchRow) => {
        if (batch.mode === "assets" || row.storyboard === "completed" || row.storyboard === "skipped" || stopped()) return;
        storyboardQueue.push(row);
        storyboardWorker ??= (async () => {
            while (storyboardQueue.length && !stopped()) {
                const next = storyboardQueue.shift()!;
                while (!stopped()) {
                    next.storyboard = "running"; next.storyboardRetryAt = undefined; next.storyboardError = undefined;
                    await save();
                    try {
                        await adapter.storyboard(next);
                        if (next.storyboard === "running") next.storyboard = "completed";
                        next.storyboardError = undefined;
                        await save(); adapter.notify?.(next, "storyboard"); break;
                    } catch (error) {
                        if (checkpointError) throw checkpointError;
                        next.storyboardError = error instanceof Error ? error.message : "分镜处理失败";
                        if (stopped() || adapter.shouldRetryStoryboard?.(error) === false) { next.storyboard = "failed"; await save(); break; }
                        next.storyboardRetries = (next.storyboardRetries || 0) + 1;
                        next.storyboard = "retrying";
                        await save(); await waitForRetry(0);
                    }
                }
            }
        })().catch((error) => { checkpointError ??= error instanceof Error ? error : new Error("区间任务进度保存失败"); }).finally(() => { storyboardWorker = undefined; });
    };
    batch.status = "running";
    try {
        await save();
        for (const row of batch.rows) {
            if (stopped()) break;
            if (batch.mode !== "storyboards" && row.assets !== "completed" && row.assets !== "skipped") {
                while (!stopped()) {
                    row.assets = "running"; row.assetError = undefined;
                    try {
                        if (!row.extracted) { row.phase = "extract"; await save(); row.extracted = await adapter.extract(row); await save(); }
                        if (stopped()) break;
                        if (!row.reviewed) { row.phase = "review"; await save(); row.reviewed = await adapter.review(row, row.extracted); await save(); }
                        if (stopped()) break;
                        row.phase = "confirm"; await save();
                        await adapter.confirm(row, mergeChapterBatchAssets(row.extracted, row.reviewed));
                        row.assets = "completed"; row.assetError = undefined;
                        await save(); adapter.notify?.(row, "assets"); break;
                    } catch (error) {
                        if (checkpointError) throw checkpointError;
                        row.assetError = error instanceof Error ? error.message : "资产处理失败";
                        if (stopped() || error instanceof ChapterBatchReviewRequiredError || adapter.shouldRetryAssets?.(error) === false) {
                            row.assets = "failed"; await save(); assetBlocked = true; break;
                        }
                        row.assetRetries = (row.assetRetries || 0) + 1; row.assets = "retrying";
                        await save(); await waitForRetry(0);
                    }
                }
                if (assetBlocked || stopped()) break;
            }
            enqueueStoryboard(row);
        }
        while (storyboardWorker) await storyboardWorker;
    } finally {
        while (storyboardWorker) await storyboardWorker;
        batch.status = !stopped() && !assetBlocked && batch.rows.every((row) => chapterBatchRowComplete(row, batch.mode)) ? "completed" : "paused";
        await save();
    }
}
