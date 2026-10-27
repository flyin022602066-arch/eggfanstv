import { afterEach, beforeEach, expect, test } from "bun:test";
import axios, { AxiosError } from "axios";
import localforage from "localforage";

import { getActiveUserScope } from "../src/lib/user-scope";
import { apiClient } from "../src/services/api/request";
import { downloadSunoClip, refreshSunoStudioJob, recoverSunoStudioJobs, submitSunoStudioOperation } from "../src/services/suno-studio";
import { useConfigStore, type ModelChannel } from "../src/stores/use-config-store";
import { flushSunoStudioPersistence, SUNO_STUDIO_STORAGE_KEY, sunoStudioSnapshot, useSunoStudioStore } from "../src/stores/use-suno-studio-store";

const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalAdapter = axios.defaults.adapter;
const originalApiAdapter = apiClient.defaults.adapter;
const originalWindow = globalThis.window;
const originalConfig = useConfigStore.getState().config;
let storage: Map<string, string>;
let scope: string;
let count = 0;
const channel: ModelChannel = { id: "suno-fixture", name: "Eggfans fixture", baseUrl: "https://api.eggfans.com/v1", apiKey: "fixture-key-not-live", apiFormat: "openai", models: [], enabled: true };

beforeEach(async () => {
    scope = `suno-offline-test-${++count}`;
    storage = new Map();
    globalThis.window = { location: { protocol: "http:", origin: "http://localhost", pathname: "/music" }, localStorage: { getItem: () => scope, setItem: () => {}, removeItem: () => {} } } as unknown as Window & typeof globalThis;
    localforage.getItem = (async (key: string) => storage.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => { storage.set(key, value); return value; }) as typeof localforage.setItem;
    useConfigStore.setState({ config: { ...originalConfig, channels: [channel] } });
    apiClient.defaults.adapter = async () => { throw new Error("Unexpected local API request in offline fixture"); };
    await useSunoStudioStore.getState().hydrate(scope);
    useSunoStudioStore.getState().setDraft({ channelId: channel.id, values: { mode: "description", mv: "chirp-v5", gpt_description_prompt: "Fixture piano" } });
});

afterEach(async () => {
    await flushSunoStudioPersistence().catch(() => undefined);
    localforage.getItem = originalGet;
    localforage.setItem = originalSet;
    axios.defaults.adapter = originalAdapter;
    apiClient.defaults.adapter = originalApiAdapter;
    useConfigStore.setState({ config: originalConfig });
    globalThis.window = originalWindow;
});

function accepted() {
    axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: "1268154180129529857" } });
}

test("each operation and channel remembers its own last parameter draft", async () => {
    const store = useSunoStudioStore.getState;
    store().setDraft({ values: { mode: "custom", mv: "chirp-v6", prompt: "原创歌词", tags: "piano" } });
    store().setDraft({ operationId: "post-suno-submit-fade" });
    store().setDraft({ values: { clip_id: "clip-a", fade_in_s: 1.5 } });
    store().setDraft({ operationId: "post-suno-submit-music" });
    expect(store().draft.values.mv).toBe("chirp-v6");
    expect(store().draft.values.prompt).toBe("原创歌词");
    store().setDraft({ channelId: "other-channel" });
    expect(store().draft.values.prompt).toBeUndefined();
    store().setDraft({ channelId: channel.id, operationId: "post-suno-submit-fade" });
    expect(store().draft.values).toEqual({ clip_id: "clip-a", fade_in_s: 1.5 });
    await flushSunoStudioPersistence();
    expect([...storage.values()].join("")).toContain("chirp-v6");
});

test("music drafts and sources stay isolated between canvas nodes and survive restoration", async () => {
    const store = useSunoStudioStore.getState;
    store().setDraft({ canvasSource: { projectId: "project-a", nodeId: "audio-a" }, values: { mode: "custom", prompt: "歌词 A", mv: "chirp-v6" } });
    store().setDraft({ canvasSource: { projectId: "project-b", nodeId: "audio-b" }, values: { mode: "custom", prompt: "歌词 B", mv: "chirp-v5" } });
    store().setDraft({ canvasSource: { projectId: "project-a", nodeId: "audio-a" }, operationId: "post-suno-submit-fade", values: { clip_id: "clip-a", fade_in_s: 2 } });
    store().setDraft({ canvasSource: { projectId: "project-a", nodeId: "audio-a" }, operationId: "post-suno-submit-music" });
    expect(store().draft.values.prompt).toBe("歌词 A");
    expect(store().draft.values.mv).toBe("chirp-v6");
    expect(store().draft.canvasSource).toEqual({ projectId: "project-a", nodeId: "audio-a" });
    store().setDraft({ source: { jobId: "job-a", clipId: "clip-a" } });
    await flushSunoStudioPersistence();
    const beforeRestore = JSON.parse(storage.get(`${SUNO_STUDIO_STORAGE_KEY}:user:${scope}`)!);
    expect(beforeRestore.operationDrafts["canvas:project-a:audio-a:suno-fixture:post-suno-submit-music"].prompt).toBe("歌词 A");
    expect(beforeRestore.operationDrafts["canvas:project-b:audio-b:suno-fixture:post-suno-submit-music"].prompt).toBe("歌词 B");
    const job: SunoStudioJob = { id: "canvas-job", channelId: channel.id, baseUrl: channel.baseUrl, operationId: "post-suno-submit-music", label: "Canvas", status: "succeeded", values: {}, clips: [], canvasSource: { projectId: "project-b", nodeId: "audio-b" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await import("../src/stores/use-suno-studio-store").then(({ addSunoStudioJob }) => addSunoStudioJob(scope, job));
    store().restoreJob(job.id);
    expect(store().draft.canvasSource).toEqual({ projectId: "project-a", nodeId: "audio-a" });
    expect(store().draft.source).toEqual({ jobId: "job-a", clipId: "clip-a" });
    await flushSunoStudioPersistence();
});

test("binary WAV result is validated, saved and registered without a second paid request", async () => {
    useSunoStudioStore.getState().setDraft({ operationId: "get-suno-act-wav-clip-id", values: { clip_id: "clip-wav" } });
    let queries = 0;
    let imports = 0;
    axios.defaults.adapter = async (config) => {
        queries++;
        expect(config.responseType).toBe("blob");
        return { config, status: 200, statusText: "OK", headers: {}, data: new Blob(["RIFF", new Uint8Array(4), "WAVEfmt ", new Uint8Array(60)], { type: "audio/wav" }) };
    };
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "post" && config.url === "/resources") return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { resource: { id: "wav-fixture", kind: "audio", mimeType: "audio/wav", size: 76 } } } };
        if (config.method === "get" && config.url === "/resources/wav-fixture") return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { resource: { id: "wav-fixture", kind: "audio", mimeType: "audio/wav", size: 76 } } } };
        if (config.method === "put" && config.url?.startsWith("/assets/")) { imports++; return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: {} } }; }
        throw new Error(`Unexpected fixture request ${config.method} ${config.url}`);
    };
    const id = await submitSunoStudioOperation();
    expect(queries).toBe(1);
    expect(imports).toBe(1);
    expect(sunoStudioSnapshot(scope).jobs.find((job) => job.id === id)?.clips[0].storageKey).toBe("resource:wav-fixture");
});

test("save before submitting, coalesce double-clicks, and never persist the API key", async () => {
    let posts = 0;
    axios.defaults.adapter = async (config) => {
        posts += 1;
        expect(storage.size).toBeGreaterThan(0);
        expect(config.headers.get("X-Canvas-Upstream-URL")).toBe("https://api.eggfans.com/suno/submit/music");
        expect(config.headers.get("Authorization")).toBe("Bearer fixture-key-not-live");
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: "1268154180129529857" } };
    };
    const first = submitSunoStudioOperation();
    expect(submitSunoStudioOperation()).toBe(first);
    const id = await first;
    expect(posts).toBe(1);
    expect(useSunoStudioStore.getState().jobs.find((job) => job.id === id)?.taskId).toBe("1268154180129529857");
    expect([...storage.values()].join("")).not.toContain(channel.apiKey);
});

test("a query interruption does not fail or resubmit an accepted task", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    const methods: string[] = [];
    axios.defaults.adapter = async (config) => {
        methods.push(config.method || "");
        throw new AxiosError("Fixture offline", "ERR_NETWORK", config);
    };
    await expect(refreshSunoStudioJob(id)).rejects.toThrow();
    const job = useSunoStudioStore.getState().jobs.find((item) => item.id === id)!;
    expect(job.status).toBe("running");
    expect(job.taskId).toBe("1268154180129529857");
    expect(job.syncError).toContain("不会重新提交");
    expect(methods).toEqual(["get"]);
});

test("the upstream failure reason is kept instead of a generic parameter error", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: { task_id: "1268154180129529857", status: "failed", fail_reason: "Fixture artist unavailable" } } });
    await refreshSunoStudioJob(id);
    const job = useSunoStudioStore.getState().jobs.find((item) => item.id === id)!;
    expect(job.status).toBe("failed");
    expect(job.error).toBe("Fixture artist unavailable");
});

test("changed channel origins block task polling rather than leak the old ID", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    useConfigStore.setState({ config: { ...originalConfig, channels: [{ ...channel, baseUrl: "https://other.example" }] } });
    let calls = 0;
    axios.defaults.adapter = async () => { calls += 1; throw new Error("must not send"); };
    await expect(refreshSunoStudioJob(id)).rejects.toThrow("地址已变更");
    expect(calls).toBe(0);
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("running");
});

test("uncertain submission is stored and never automatically resubmitted", async () => {
    let calls = 0;
    axios.defaults.adapter = async () => { calls += 1; throw new Error("Fixture disconnected after send"); };
    await expect(submitSunoStudioOperation()).rejects.toThrow();
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("unknown");
    await recoverSunoStudioJobs();
    expect(calls).toBe(1);
});

test("a late reply for another scope cannot populate the active music workspace", async () => {
    let release!: () => void;
    let sent!: () => void;
    const sending = new Promise<void>((resolve) => { sent = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    axios.defaults.adapter = async (config) => { sent(); await barrier; return { config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: "1268154180129529857" } }; };
    const oldScope = getActiveUserScope();
    const pending = submitSunoStudioOperation();
    await sending;
    scope = `${scope}-other`;
    await useSunoStudioStore.getState().hydrate(scope);
    release();
    const id = await pending;
    expect(useSunoStudioStore.getState().jobs).toHaveLength(0);
    expect(sunoStudioSnapshot(oldScope).jobs.find((job) => job.id === id)?.taskId).toBe("1268154180129529857");
    expect(storage.get(`${SUNO_STUDIO_STORAGE_KEY}:user:${oldScope}`)).toContain("1268154180129529857");
});

test("a synchronous balance is not a task ID and is never polled", async () => {
    useSunoStudioStore.getState().setDraft({ operationId: "get-suno-account-integral", values: {} });
    let requests = 0;
    axios.defaults.adapter = async (config) => {
        requests++;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 200, data: "123" } };
    };
    const id = await submitSunoStudioOperation();
    const job = useSunoStudioStore.getState().jobs.find((item) => item.id === id)!;
    expect(job.status).toBe("succeeded");
    expect(job.taskId).toBeUndefined();
    await recoverSunoStudioJobs();
    expect(requests).toBe(1);
});

test("both completed clips persist locally and WAV exports keep the true file extension", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    let imported = 0;
    let assets = 0;
    let exportedName = "";
    Object.assign(window, { go: { main: { DesktopApp: { SaveOwnedMedia: async (name: string) => { exportedName = name; return true; } } } } });
    axios.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url?.endsWith("/ai/custom")) data = { code: "success", data: { task_id: "1268154180129529857", status: "success", data: ["a", "b"].map((suffix) => ({ id: `clip-${suffix}`, title: `Fixture ${suffix}`, audio_url: `https://cdn.example/${suffix}`, status: "complete" })) } };
        else if (config.url === "/resources/import") {
            imported++;
            data = { code: 0, data: { resource: { id: `${scope}-resource-${imported}`, mimeType: "audio/wav", size: 1024 } } };
        } else if (config.url?.startsWith("/assets/")) { assets++; data = { code: 0, data: {} }; }
        else throw new Error(`Unexpected offline request: ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data };
    };
    apiClient.defaults.adapter = axios.defaults.adapter;
    await refreshSunoStudioJob(id);
    expect(useSunoStudioStore.getState().jobs.find((item) => item.id === id)?.syncError).toBeUndefined();
    expect(imported).toBe(2);
    expect(assets).toBe(2);
    const job = useSunoStudioStore.getState().jobs.find((item) => item.id === id)!;
    expect(job.clips.every((clip) => clip.storageKey && clip.assetId)).toBe(true);
    await downloadSunoClip(id, "clip-a");
    expect(exportedName).toBe("Fixture a.wav");
    expect(imported).toBe(2);
});

test("local import failure preserves upstream success and allows later saving without generation", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    let submissions = 0;
    axios.defaults.adapter = async (config) => {
        if (config.method === "post" && config.url?.endsWith("/ai/custom")) submissions++;
        if (config.url === "/resources/import") throw new Error("Fixture disk unavailable");
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: { task_id: "1268154180129529857", status: "success", data: [{ id: "clip-a", audio_url: "https://cdn.example/a.mp3" }] } } };
    };
    apiClient.defaults.adapter = axios.defaults.adapter;
    await refreshSunoStudioJob(id);
    const job = useSunoStudioStore.getState().jobs.find((item) => item.id === id)!;
    expect(job.status).toBe("succeeded");
    expect(job.syncError).toContain("本地素材保存失败");
    expect(submissions).toBe(0);
});

test("incremental query results preserve other clips and saved bindings", async () => {
    accepted();
    const id = await submitSunoStudioOperation();
    await import("../src/stores/use-suno-studio-store").then(({ updateSunoStudioJob }) => updateSunoStudioJob(scope, id, { clips: [{ id: "clip-a", title: "A", audioUrl: "https://cdn.example/a.mp3", storageKey: "resource:saved-a", assetId: "saved-a" }, { id: "clip-b", title: "B", audioUrl: "https://cdn.example/b.mp3", storageKey: "resource:saved-b", assetId: "saved-b" }] }));
    axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: { task_id: "1268154180129529857", status: "success", data: [{ id: "clip-b", audio_url: "https://cdn.example/b-new.mp3" }] } } });
    await refreshSunoStudioJob(id);
    const clips = useSunoStudioStore.getState().jobs[0].clips;
    expect(clips.map((clip) => clip.id)).toEqual(["clip-a", "clip-b"]);
    expect(clips[1].assetId).toBe("saved-b");
    expect(clips[0].audioUrl).toBe("https://cdn.example/a.mp3");
});

test("batch query refresh preserves all requested task IDs", async () => {
    useSunoStudioStore.getState().setDraft({ operationId: "post-suno-fetch", values: { ids: ["task-a", "task-b"] } });
    const bodies: unknown[] = [];
    let finished = false;
    axios.defaults.adapter = async (config) => {
        bodies.push(JSON.parse(String(config.data)));
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: [{ task_id: "task-a", status: "success", data: { text: "A" } }, { task_id: "task-b", status: finished ? "success" : "processing", data: { text: "B" } }] } };
    };
    const id = await submitSunoStudioOperation();
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("running");
    finished = true;
    await refreshSunoStudioJob(id);
    expect(bodies).toEqual([{ ids: ["task-a", "task-b"] }, { ids: ["task-a", "task-b"] }]);
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("succeeded");
    expect(useSunoStudioStore.getState().jobs[0].taskIds).toEqual(["task-a", "task-b"]);
});

test("a documented synchronous tool that actually returns a task ID stays queryable", async () => {
    useSunoStudioStore.getState().setDraft({ operationId: "post-suno-submit-fade", values: { clip_id: "clip-a", fade_in_s: 1 } });
    accepted();
    const id = await submitSunoStudioOperation();
    expect(useSunoStudioStore.getState().jobs[0].taskId).toBe("1268154180129529857");
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("running");
    axios.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: "success", data: { task_id: "1268154180129529857", status: "success", data: {} } } });
    await refreshSunoStudioJob(id);
    expect(useSunoStudioStore.getState().jobs[0].status).toBe("succeeded");
});
