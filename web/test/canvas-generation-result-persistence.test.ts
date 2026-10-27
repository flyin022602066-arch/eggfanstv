import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";

import { applyMaterializedGenerationTaskResultToNodes } from "../src/lib/canvas/canvas-generation-task-sync";
import { persistCanvasGenerationEffect, registerCanvasGenerationLiveProject } from "../src/services/canvas-generation-consumer";
import { syncLocalCanvasGenerationProjectToBackend } from "../src/services/local-workspace-repository";
import { ApiError, apiClient } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence, useAssetStore } from "../src/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const originalGetItem = localforage.getItem;
const originalSetItem = localforage.setItem;
const originalAdapter = apiClient.defaults.adapter;
const originalWindow = globalThis.window;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let values: Map<string, unknown>;

function node(id: string, metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id, title: id, type: CanvasNodeType.Image, width: 320, height: 180, position: { x: 0, y: 0 }, metadata };
}

async function seed(nodes: CanvasNodeData[]) {
    const project = { id: "result-persistence", revision: 0, title: "Fixture", nodes, connections: [], chatSessions: [], activeChatId: null, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z", viewport: { x: 0, y: 0, k: 1 }, directorScenes: [], backgroundMode: "dots", showImageInfo: false } as CanvasProject;
    useCanvasStore.setState({ projects: [project] });
    await flushCanvasStorePersistence();
    return project;
}

beforeEach(async () => {
    values = new Map();
    globalThis.window = { location: { origin: "http://localhost", pathname: "/" }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } } });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => { values.set(key, value); return value; }) as typeof localforage.setItem;
    useAssetStore.setState({ assets: [] });
    await flushAssetStorePersistence();
});

afterEach(async () => {
    await flushCanvasStorePersistence();
    await flushAssetStorePersistence();
    localforage.getItem = originalGetItem;
    localforage.setItem = originalSetItem;
    apiClient.defaults.adapter = originalAdapter;
    globalThis.window = originalWindow;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
});

test("generation commit repairs an unrelated uploaded resource without an asset binding", async () => {
    await seed([node("uploaded", { storageKey: "resource:upload", content: "/api/resources/upload/file", naturalWidth: 1920, naturalHeight: 1080 })]);
    let requestCount = 0;
    apiClient.defaults.adapter = async (config) => {
        requestCount += 1;
        const body = JSON.parse(config.data);
        expect(config.url).toBe("/canvas-projects/result-persistence/generated-assets");
        const asset = body.assets.find((item: { data: { storageKey: string } }) => item.data.storageKey === "resource:upload");
        expect(asset).toBeDefined();
        expect(body.project.nodes[0].metadata.assetId).toBe(asset.id);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { project: { revision: 1 } } } };
    };
    await syncLocalCanvasGenerationProjectToBackend("result-persistence");
    expect(requestCount).toBe(1);
    expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBeTruthy();
});

test("generation persistence returns the latest nodes and server revision after an in-flight save", async () => {
    const project = await seed([node("generated", { taskId: "task", status: "loading" })]);
    const updated = project.nodes.map((item) => ({ ...item, metadata: { ...item.metadata, content: "/api/resources/result/file", status: "success" as const, generationEffectKeys: ["attach-node:task:generated:0"] } }));
    apiClient.defaults.adapter = async (config) => {
        useCanvasStore.getState().updateProject(project.id, { nodes: [...useCanvasStore.getState().projects[0].nodes, node("new-edit", { prompt: "keep this edit" })] });
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { project: { revision: 7 } } } };
    };
    const persisted = await persistCanvasGenerationEffect({ projectId: project.id, effectKey: "attach-node:task:generated:0", previousNodes: project.nodes, nodes: updated });
    expect(persisted.revision).toBe(7);
    expect(persisted.nodes.map((item) => item.id)).toContain("new-edit");
    expect(persisted.nodes[0].metadata?.content).toBe("/api/resources/result/file");
});

test("an acknowledged attach stamp does not suppress repair of a missing result", async () => {
    const effectKey = "attach-node:task:image:0";
    const source = node("image", { taskId: "task", taskStatus: "succeeded", status: "error", generationEffectKeys: [effectKey] });
    const task = { id: "task", type: "canvas_image", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:result", width: 640, height: 360 }] }) } as GenerationTask;
    useAssetStore.setState({ assets: [{ id: "asset-result", kind: "image", title: "Result", coverUrl: "/api/resources/result/file", tags: [], status: "confirmed", source: "Fixture", createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z", data: { dataUrl: "/api/resources/result/file", storageKey: "resource:result", width: 640, height: 360, bytes: 1, mimeType: "image/png" } }] as never });
    const result = await applyMaterializedGenerationTaskResultToNodes([source], task, { outputIndex: 0, mediaType: "image", materializedAssetId: "asset-result" }, effectKey, source.id);
    expect(result.node?.metadata?.storageKey).toBe("resource:result");
    expect(result.node?.metadata?.status).toBe("success");
    expect(result.node?.metadata?.assetId).toBe("asset-result");
});

test("materializing a Suno audio result preserves both paid clip bindings and node parameters", async () => {
    const source = { ...node("audio", { taskId: "music-task", status: "loading", audioSunoParams: '{"mv":"chirp-v6"}' }), type: CanvasNodeType.Audio };
    const clips = ["a", "b"].map((id) => ({ clipId: id, title: id, storageKey: `resource:music-${id}`, url: `/api/resources/music-${id}/file`, mimeType: "audio/mpeg" }));
    const task = { id: "music-task", type: "canvas_audio", status: "succeeded", resultJson: JSON.stringify({ mode: "audio", providerTaskId: "1268154180129529857", audio: clips[0], audios: clips }) } as GenerationTask;
    useAssetStore.setState({ assets: [{ id: "asset-music", kind: "audio", title: "Music", coverUrl: "", tags: [], status: "confirmed", source: "Fixture", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", data: { url: clips[0].url, storageKey: clips[0].storageKey, bytes: 100, mimeType: "audio/mpeg" } }] as never });
    const applied = await applyMaterializedGenerationTaskResultToNodes([source], task, { outputIndex: 0, mediaType: "audio", materializedAssetId: "asset-music" }, "attach-node:music-task:audio:0", source.id);
    expect(applied.node?.metadata?.sunoClips?.map((clip) => clip.storageKey)).toEqual(["resource:music-a", "resource:music-b"]);
    expect(applied.node?.metadata?.sunoTaskId).toBe("1268154180129529857");
    expect(applied.node?.metadata?.audioSunoParams).toBe('{"mv":"chirp-v6"}');
});

test("a backend save failure preserves the committed image in the visible editor", async () => {
    const project = await seed([node("generated", { taskId: "task", status: "loading" })]);
    let live = { nodes: project.nodes, connections: [], chatSessions: [], activeChatId: null } as Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">;
    const unregister = registerCanvasGenerationLiveProject({ scope: "guest", projectId: project.id, adapter: { read: () => live, write: (state) => { live = state; } } });
    const saveError = new ApiError("Fixture conflict", { status: 409 });
    apiClient.defaults.adapter = async () => { throw saveError; };
    try {
        await expect(persistCanvasGenerationEffect({
            projectId: project.id, effectKey: "attach-node:task:generated:0", previousNodes: project.nodes,
            nodes: [node("generated", { taskId: "task", taskStatus: "succeeded", status: "success", storageKey: "resource:result", content: "/api/resources/result/file", generationEffectKeys: ["attach-node:task:generated:0"] })],
        })).rejects.toBe(saveError);
        expect(live.nodes[0].metadata?.content).toBe("/api/resources/result/file");
        expect(live.nodes[0].metadata?.status).toBe("success");
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.storageKey).toBe("resource:result");
    } finally { unregister(); }
});
