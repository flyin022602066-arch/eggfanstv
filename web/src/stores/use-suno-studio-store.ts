import { create } from "zustand";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import { sunoDefaultValues, sunoOperation } from "@/lib/suno-contract";
import { getActiveUserScope } from "@/lib/user-scope";

export type SunoStudioClip = {
    id: string;
    title: string;
    audioUrl?: string;
    videoUrl?: string;
    imageUrl?: string;
    duration?: number;
    lyrics?: string;
    tags?: string;
    storageKey?: string;
    assetId?: string;
};

export type SunoStudioJob = {
    id: string;
    channelId: string;
    baseUrl: string;
    operationId: string;
    label: string;
    status: "submitting" | "queued" | "running" | "succeeded" | "failed" | "unknown";
    taskId?: string;
    taskIds?: string[];
    createdAt: string;
    updatedAt: string;
    values: Record<string, unknown>;
    clips: SunoStudioClip[];
    result?: unknown;
    error?: string;
    syncError?: string;
    source?: SunoStudioSource;
    canvasSource?: SunoCanvasSource;
};

export type SunoStudioSource = { jobId: string; clipId: string };
export type SunoCanvasSource = { projectId: string; nodeId: string };
export type SunoStudioDraft = { channelId: string; operationId: string; values: Record<string, unknown>; source?: SunoStudioSource; canvasSource?: SunoCanvasSource };
type SunoStudioSnapshot = { draft: SunoStudioDraft; jobs: SunoStudioJob[]; selectedJobId: string | null; operationDrafts?: Record<string, Record<string, unknown>> };
type SunoStudioState = SunoStudioSnapshot & {
    scope: string;
    hydrated: boolean;
    persistenceError?: string;
    hydrate: (scope?: string) => Promise<void>;
    setDraft: (patch: Partial<SunoStudioDraft>) => void;
    selectJob: (id: string | null) => void;
    restoreJob: (id: string) => void;
};

export const SUNO_STUDIO_STORAGE_KEY = "infinite-canvas:suno-studio:v1";
const snapshots = new Map<string, SunoStudioSnapshot>();
const writes = new Map<string, Promise<void>>();
let hydration = 0;

function emptySnapshot(): SunoStudioSnapshot {
    const operationId = "post-suno-submit-music";
    return { draft: { channelId: "", operationId, values: sunoDefaultValues(operationId) }, jobs: [], selectedJobId: null };
}

function snapshotFor(scope: string): SunoStudioSnapshot {
    const snapshot = snapshots.get(scope);
    if (!snapshot) throw new Error("音乐工作区尚未载入");
    return snapshot;
}

function publish(scope: string, snapshot: SunoStudioSnapshot) {
    snapshots.set(scope, snapshot);
    if (useSunoStudioStore.getState().scope === scope) useSunoStudioStore.setState(snapshot);
}

function save(scope: string, snapshot: SunoStudioSnapshot) {
    const serialized = JSON.stringify({ version: 1, ...snapshot });
    const previous = writes.get(scope) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
        await localForageStorageForScope(scope).setItem(SUNO_STUDIO_STORAGE_KEY, serialized);
        if (useSunoStudioStore.getState().scope === scope) useSunoStudioStore.setState({ persistenceError: undefined });
    }).catch((error) => {
        if (useSunoStudioStore.getState().scope === scope) useSunoStudioStore.setState({ persistenceError: "音乐工作区保存失败，请恢复本地存储后重试" });
        throw error;
    });
    writes.set(scope, next);
    void next.catch(() => undefined);
    return next;
}

function change(scope: string, update: (snapshot: SunoStudioSnapshot) => SunoStudioSnapshot) {
    const next = update(snapshotFor(scope));
    publish(scope, next);
    return save(scope, next);
}

function parseSnapshot(value: string | null): SunoStudioSnapshot {
    if (!value) return emptySnapshot();
    const parsed = JSON.parse(value) as SunoStudioSnapshot & { version: number };
    if (parsed.version !== 1 || !parsed.draft || !Array.isArray(parsed.jobs) || typeof parsed.draft.operationId !== "string" || !parsed.draft.values || typeof parsed.draft.values !== "object") throw new Error("音乐工作区记录无法读取，未覆盖原记录");
    sunoOperation(parsed.draft.operationId);
    for (const job of parsed.jobs) {
        if (!job.id || !job.channelId || !Array.isArray(job.clips) || !job.values) throw new Error("音乐任务记录不完整，未覆盖原记录");
        sunoOperation(job.operationId);
    }
    return { draft: parsed.draft, operationDrafts: parsed.operationDrafts || {}, jobs: parsed.jobs.map((job) => job.status === "submitting" ? { ...job, status: job.taskId ? "queued" : "unknown", syncError: job.taskId ? undefined : "上次提交结果未确认，请核对渠道任务记录，勿重复提交" } : job), selectedJobId: parsed.selectedJobId || null };
}

export const useSunoStudioStore = create<SunoStudioState>((set, get) => ({
    ...emptySnapshot(),
    scope: "",
    hydrated: false,
    hydrate: async (scope = getActiveUserScope()) => {
        if (get().scope === scope && get().hydrated) return;
        const attempt = ++hydration;
        set({ ...emptySnapshot(), scope, hydrated: false, persistenceError: undefined });
        try {
            await writes.get(scope)?.catch(() => undefined);
            const snapshot = snapshots.get(scope) || parseSnapshot(await localForageStorageForScope(scope).getItem(SUNO_STUDIO_STORAGE_KEY) as string | null);
            snapshots.set(scope, snapshot);
            if (attempt === hydration) set({ ...snapshot, scope, hydrated: true });
        } catch (error) {
            if (attempt === hydration) set({ persistenceError: error instanceof Error ? error.message : "音乐工作区载入失败" });
            throw error;
        }
    },
    setDraft: (patch) => {
        if (!get().hydrated) return;
        const scope = get().scope;
        void change(scope, (snapshot) => {
            const previous = snapshot.draft;
            const next = { ...previous, ...patch };
            if (next.channelId !== previous.channelId && !Object.hasOwn(patch, "source")) next.source = undefined;
            const contextKey = (draft: SunoStudioDraft) => draft.canvasSource ? `canvas:${draft.canvasSource.projectId}:${draft.canvasSource.nodeId}:` : "";
            const previousKey = `${contextKey(previous)}${previous.channelId}:${previous.operationId}`;
            const nextKey = `${contextKey(next)}${next.channelId}:${next.operationId}`;
            const operationDrafts = { ...snapshot.operationDrafts, [previousKey]: previous.values };
            if (nextKey !== previousKey && patch.values === undefined) next.values = operationDrafts[nextKey] || sunoDefaultValues(next.operationId);
            operationDrafts[nextKey] = next.values;
            return { ...snapshot, operationDrafts, draft: next };
        }).catch(() => undefined);
    },
    selectJob: (id) => {
        if (!get().hydrated) return;
        void change(get().scope, (snapshot) => ({ ...snapshot, selectedJobId: id })).catch(() => undefined);
    },
    restoreJob: (id) => {
        const job = get().jobs.find((item) => item.id === id);
        if (!job) return;
        const canvasSource = get().draft.canvasSource || job.canvasSource;
        get().setDraft({ channelId: job.channelId, operationId: job.operationId, values: structuredClone(job.values), source: job.source || get().draft.source, canvasSource });
    },
}));

export function sunoStudioSnapshot(scope: string) { return snapshotFor(scope); }

export function flushSunoStudioPersistence(scope = useSunoStudioStore.getState().scope) {
    return save(scope, snapshotFor(scope));
}

export async function addSunoStudioJob(scope: string, job: SunoStudioJob) {
    await change(scope, (snapshot) => ({ ...snapshot, jobs: [job, ...snapshot.jobs], selectedJobId: job.id }));
}

export async function updateSunoStudioJob(scope: string, id: string, patch: Partial<SunoStudioJob>) {
    await change(scope, (snapshot) => ({ ...snapshot, jobs: snapshot.jobs.map((job) => job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job) }));
}
