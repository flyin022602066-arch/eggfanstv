import { expect, test } from "bun:test";
import { DOUBAO_BROWSER_MODELS, DOUBAO_BROWSER_PROTOCOL } from "../src/lib/doubao-browser";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { isFixedModelCatalogChannel } from "../src/lib/builtin-channels";
import { channelHasGenerationCredential, createModelChannel, encodeChannelModel, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { assertVideoConfig } from "../src/services/api/video-validation";
import { buildVideoGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("browser channel is separate, video only, fixed and does not receive gateway credentials", () => {
    const initial = normalizeConfigSnapshot().config;
    const browser = initial.channels.find(c => c.id === "doubao-browser")!;
    expect(browser.models).toEqual(DOUBAO_BROWSER_MODELS);
    expect(isFixedModelCatalogChannel(browser.id)).toBe(true);
    expect(channelHasGenerationCredential(browser)).toBe(true);
    const remote = createModelChannel({ id: "fixture-remote", baseUrl: "https://fixture.invalid", apiKey: "fixture-key", interfaceType: "newapi", models: DOUBAO_BROWSER_MODELS });
    const config = { ...initial, channels: [browser, remote] };
    for (const model of DOUBAO_BROWSER_MODELS) {
        const request = resolveModelRequestConfig(config, encodeChannelModel(browser.id, model));
        expect(request.interfaceType).toBe(DOUBAO_BROWSER_PROTOCOL);
        expect(request.apiKey).toBe(""); expect(request.secretKey).toBe(""); expect(request.headers).toEqual([]);
        expect(() => assertVideoConfig(request, model)).not.toThrow();
        expect(resolveModelRequestConfig(config, encodeChannelModel(remote.id, model)).apiKey).toBe("fixture-key");
        const video = defaultModelCapabilityConfig(DOUBAO_BROWSER_PROTOCOL, model).video!;
        expect(video.duration.max).toBe(model === "seedance_v2.5" ? 30 : 15);
        expect(video.references.maxImages).toBe(10);
        expect(video.references.maxVideos).toBe(0); expect(video.references.maxAudios).toBe(0);
        expect(video.references.promptMaxChars).toBe(8000);
    }
});

test("project and canvas keep native model, duration, ratio and owned image references", async () => {
    const initial = normalizeConfigSnapshot().config;
    const model = encodeChannelModel("doubao-browser", "seedance_v2.0_std");
    const config = { ...initial, model, videoSeconds: "12", size: "9:16" };
    const references = [{ id: "fixture", name: "fixture.png", type: "image/png", storageKey: "resource:fixture", dataUrl: "", bytes: 128, width: 1280, height: 720 }];
    for (const projectId of [undefined, "project-fixture"]) {
        const node = { id: "video-node", type: CanvasNodeType.Video, metadata: { chapterId: "episode-2", chapterTitle: "第02集", shotIndex: 3 } } as CanvasNodeData;
        const metadata = buildVideoGenerationMetadata(node, undefined, config);
        const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: "fixture", projectId, referenceImages: references, metadata });
        const input = task.input as { config: { model: string; videoSeconds: string; size: string; interfaceType: string }; referenceImages: typeof references };
        expect(input.config.model).toBe("seedance_v2.0_std");
        expect(input.config.interfaceType).toBe(DOUBAO_BROWSER_PROTOCOL);
        expect(input.config.videoSeconds).toBe("12"); expect(input.config.size).toBe("9:16");
        expect(input.referenceImages[0]?.storageKey).toBe("resource:fixture");
        expect((task.input as { metadata: Record<string, unknown> }).metadata).toMatchObject({ chapterId: "episode-2", chapterTitle: "第02集", shotIndex: 3 });
    }
    expect(modelCapabilityConfigFor(config, model).video!.duration.max).toBe(15);
});
