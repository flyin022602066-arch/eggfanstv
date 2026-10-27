import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { apiClient } from "../src/services/api/request";
import { createVideoGenerationTask, pollVideoGenerationTask } from "../src/services/api/video";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const model = "doubao-seedance-2-5-260628";

function eggfansConfig() {
    const channel = createModelChannel({ id: "beefapi", name: "Eggfans", apiKey: "test-key", baseUrl: "https://api.eggfans.com", models: [model, "grok-image-video"], modelProfiles: [{ model, capability: "video", protocol: "newapi-channel-2" }, { model: "grok-image-video", capability: "video", protocol: "newapi-channel-2" }] });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: `beefapi::${model}`, videoModel: `beefapi::${model}`, videoSeconds: "27", size: "9:16", vquality: "720" } }).config;
}

describe("Eggfans native Seedance and private references", () => {
    test("node reference mode overrides the global choice in both directions and survives reload", async () => {
        const savedNode: CanvasNodeData = {
            id: "video-node",
            type: CanvasNodeType.Video,
            title: "video",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { model: eggfansConfig().videoModel },
        };
        for (const nodeMode of ["uri", "url"] as const) {
            savedNode.metadata.eggfansReferenceMode = nodeMode;
            const restoredNode = JSON.parse(JSON.stringify(savedNode)) as CanvasNodeData;
            const globalConfig = { ...eggfansConfig(), videoEggfansReferenceMode: nodeMode === "uri" ? "url" as const : "uri" as const };
            const config = buildGenerationConfig(globalConfig, restoredNode, "video");
            expect(config.videoEggfansReferenceMode).toBe(nodeMode);
            const input = await prepareBackendGenerationTask({
                mode: "video",
                config,
                prompt: "@图片1",
                referenceImages: [{ id: "image", name: "image.png", type: "image/png", url: "https://h.uguu.se/current.png", arkAssetId: "private-image" }],
            });
            const payload = input.input as { config: { videoEggfansReferenceMode: string }; referenceImages: Array<{ url?: string }> };
            expect(payload.config.videoEggfansReferenceMode).toBe(nodeMode);
            expect(payload.referenceImages[0].url).toBe(nodeMode === "uri" ? "asset://private-image" : "https://h.uguu.se/current.png");
        }
    });

    test("persists the URI/URL choice and sends URL references without private asset IDs", async () => {
        const config = normalizeConfigSnapshot({ config: { ...eggfansConfig(), videoEggfansReferenceMode: "url" } }).config;
        expect(config.videoEggfansReferenceMode).toBe("url");
        const input = await prepareBackendGenerationTask({
            mode: "video",
            config,
            prompt: "使用公网参考图",
            referenceImages: [{ id: "image", name: "image.png", type: "image/png", url: "https://h.uguu.se/current.png", arkAssetId: "private-image" }],
            referenceVideos: [{ id: "video", name: "video.mp4", type: "video/mp4", url: "https://h.uguu.se/current.mp4", arkAssetId: "private-video", durationMs: 2000 }],
            referenceAudios: [{ id: "audio", name: "audio.mp3", type: "audio/mpeg", url: "https://h.uguu.se/current.mp3", arkAssetId: "private-audio", durationMs: 2000 }],
        });
        const payload = input.input as { config: { videoEggfansReferenceMode: string }; referenceImages: Array<{ url?: string; storageKey?: string }>; referenceVideos: Array<{ url?: string }>; referenceAudios: Array<{ url?: string }> };
        expect(payload.config.videoEggfansReferenceMode).toBe("url");
        expect(payload.referenceImages[0]).toEqual({ id: "image", name: "image.png", type: "image/png", dataUrl: "", url: "https://h.uguu.se/current.png", storageKey: undefined });
        expect(payload.referenceVideos[0].url).toBe("https://h.uguu.se/current.mp4");
        expect(payload.referenceAudios[0].url).toBe("https://h.uguu.se/current.mp3");
    });

    test("repairs the Eggfans Seedance protocol without changing key, host or non-Seedance routes", () => {
        const config = eggfansConfig();
        const resolved = resolveModelRequestConfig(config, config.videoModel);
        expect(resolved.interfaceType).toBe("eggfans-seedance-video");
        expect(resolved.baseUrl).toBe("https://api.eggfans.com");
        expect(resolved.apiKey).toBe("test-key");
        expect(resolved.model).toBe(model);
        const restored = normalizeConfigSnapshot({ config }).config;
        expect(resolveModelRequestConfig(restored, restored.videoModel).interfaceType).toBe("eggfans-seedance-video");
        expect(resolveModelRequestConfig(config, "beefapi::grok-image-video").interfaceType).toBe("newapi-channel-2");
    });

    test("supports 30 images, 10 videos, 10 audios and keeps URI references in their original order", async () => {
        const config = eggfansConfig();
        const profile = defaultModelCapabilityConfig("eggfans-seedance-video", model).video!;
        expect([profile.references.maxImages, profile.references.maxVideos, profile.references.maxAudios]).toEqual([30, 10, 10]);
        const input = await prepareBackendGenerationTask({ mode: "video", config, prompt: "@图片30 参考 @视频10，使用 @音频10", referenceImages: Array.from({ length: 30 }, (_, index) => ({ id: `image-${index}`, name: `image${index}.png`, type: "image/png", url: "https://example.com/preview.png", arkAssetId: `image${index}` })), referenceVideos: Array.from({ length: 10 }, (_, index) => ({ id: `video-${index}`, name: `video${index}.mp4`, type: "video/mp4", url: "https://example.com/preview.mp4", arkAssetId: `video${index}` })), referenceAudios: Array.from({ length: 10 }, (_, index) => ({ id: `audio-${index}`, name: `audio${index}.mp3`, type: "audio/mpeg", url: "https://example.com/preview.mp3", arkAssetId: `audio${index}` })) });
        const payload = input.input as { config: { interfaceType: string; model: string }; prompt: string; referenceImages: Array<{ url: string }>; referenceVideos: Array<{ url: string }>; referenceAudios: Array<{ url: string }> };
        expect(payload.config.interfaceType).toBe("eggfans-seedance-video");
        expect(payload.config.model).toBe(model);
        expect(payload.prompt).toBe("@图片30 参考 @视频10，使用 @音频10");
        expect(payload.referenceImages.map((item) => item.url)).toEqual(Array.from({ length: 30 }, (_, index) => `asset://image${index}`));
        expect(payload.referenceVideos.map((item) => item.url)).toEqual(Array.from({ length: 10 }, (_, index) => `asset://video${index}`));
        expect(payload.referenceAudios.map((item) => item.url)).toEqual(Array.from({ length: 10 }, (_, index) => `asset://audio${index}`));
    });

    test("rejects counts above 30/10/10 before submission", async () => {
        await expect(prepareBackendGenerationTask({ mode: "video", config: eggfansConfig(), prompt: "scene", referenceImages: Array.from({ length: 31 }, (_, index) => ({ id: String(index), name: "image", type: "image/png", arkAssetId: `image${index}` })) })).rejects.toThrow("30 张参考图");
    });

    test("sends owned resources to the backend instead of reusing another channel's asset IDs", async () => {
        const image = { id: "image", name: "image.png", type: "image/png", dataUrl: "", url: "https://h.uguu.se/expired.png", storageKey: "resource:owned-image", arkAssetId: "foreign-image" };
        const video = { id: "video", name: "video.mp4", type: "video/mp4", storageKey: "resource:owned-video", arkAssetId: "foreign-video", durationMs: 2000 };
        const audio = { id: "audio", name: "audio.mp3", type: "audio/mpeg", storageKey: "resource:owned-audio", arkAssetId: "foreign-audio", durationMs: 2000 };
        const input = await prepareBackendGenerationTask({ mode: "video", config: eggfansConfig(), prompt: "@图片1 @视频1 @音频1", referenceImages: [image], referenceVideos: [video], referenceAudios: [audio] });
        const payload = input.input as { referenceImages: Array<{ storageKey?: string; url?: string }>; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios: Array<{ storageKey?: string; url?: string }> };
        expect(payload.referenceImages[0]).toMatchObject({ storageKey: "resource:owned-image" });
        expect(payload.referenceVideos[0]).toMatchObject({ storageKey: "resource:owned-video" });
        expect(payload.referenceAudios[0]).toMatchObject({ storageKey: "resource:owned-audio" });
        expect(payload.referenceImages[0]?.url).toBeUndefined();
        expect(payload.referenceVideos[0]?.url).toBe("");
        expect(payload.referenceAudios[0]?.url).toBe("");
    });

    test("direct video callers use local task lifecycle and retain private reference preparation", async () => {
        const original = apiClient.defaults.adapter;
        const calls: string[] = [];
        apiClient.defaults.adapter = async (request) => {
            calls.push(`${request.method} ${request.url}`);
            const payload = typeof request.data === "string" ? JSON.parse(request.data) : request.data;
            if (request.method === "post") {
                expect(payload.input.config.interfaceType).toBe("eggfans-seedance-video");
                expect(payload.input.referenceVideos[0].url).toBe("asset://clip");
            }
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "local-task", status: request.method === "post" ? "queued" : "succeeded", resultJson: JSON.stringify({ video: { url: "/api/resources/result/file", mimeType: "video/mp4" } }) } } };
        };
        try {
            const task = await createVideoGenerationTask(eggfansConfig(), "@视频1", [], [{ id: "video", name: "clip.mp4", type: "video/mp4", arkAssetId: "clip" }]);
            expect(task.provider).toBe("backend");
            expect(await pollVideoGenerationTask(eggfansConfig(), task)).toEqual({ status: "completed", result: { url: "/api/resources/result/file", mimeType: "video/mp4" } });
            expect(calls).toEqual(["post /tasks", "get /tasks/local-task"]);
        } finally { apiClient.defaults.adapter = original; }
    });
});
