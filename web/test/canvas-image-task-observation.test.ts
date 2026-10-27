import { expect, test } from "bun:test";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { generationTaskMetadata } from "../src/lib/canvas/canvas-project-generation";
import { executeImageGeneration } from "../src/pages/canvas/canvas-image-generation-executor";
import { apiClient } from "../src/services/api/request";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("image executor does not turn an accepted task into a failed batch when status queries disconnect", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    const originalWindow = globalThis.window;
    globalThis.window = { setTimeout: (callback: () => void) => setTimeout(callback, 1), clearTimeout, location: { pathname: "/", origin: "http://localhost" } } as unknown as Window & typeof globalThis;
    const source: CanvasNodeData = { id: "image-observation", title: "Image", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 320, height: 320 };
    let nodes = [source];
    const errors: string[] = [];
    let submissions = 0;
    apiClient.defaults.adapter = async (config) => {
        if (config.method !== "post" || config.url !== "/tasks") throw new Error("query offline");
        submissions += 1;
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "accepted-image", type: "canvas_image", status: "running", prompt: "image", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } };
    };
    const controller = new AbortController();
    try {
        await executeImageGeneration({
            projectId: "", nodeId: source.id, sourceNode: source, canvasNodes: nodes, canvasConnections: [], prompt: "image", effectivePrompt: "image",
            generationConfig: { ...defaultConfig, model: "fixture::gpt-image-2", count: "1", channels: [createModelChannel({ id: "fixture", apiKey: "synthetic-key", interfaceType: "openai-image", models: ["gpt-image-2"] })] },
            generationContext: buildNodeGenerationContext(source.id, nodes, [], "image", []), controller, editingTextNode: false, styleMetadata: {}, skillMetadata: { skillIds: [], skillVersions: [], skillFiles: [] },
            setNodes: (update) => { nodes = typeof update === "function" ? update(nodes) : update; },
            setConnections: () => {}, setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
            startGenerationRequest: () => controller, finishGenerationRequest: () => {}, registerPendingNodeIds: () => {},
            bindGenerationTask: (nodeId, task) => { nodes = nodes.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(task) } } : node); },
            applyGenerationTaskResult: async () => { throw new Error("No completed result expected"); }, showError: (content) => errors.push(content),
        });
        expect(submissions).toBe(1);
        expect(nodes[0].metadata).toMatchObject({ status: "loading", taskId: "accepted-image", taskStatus: "running", taskSyncIssue: "sync" });
        expect(nodes[0].metadata?.errorDetails).toBeUndefined();
        expect(errors).toEqual([]);
    } finally {
        apiClient.defaults.adapter = originalAdapter;
        globalThis.window = originalWindow;
    }
});
