import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createJSONStorage } from "zustand/middleware";

import { JiasuVideoReferenceSettings, VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "../src/lib/model-capabilities";
import { modelCompatibilityError, resolveModelVideoBooleanOptions } from "../src/lib/model-selection";
import { isSeedanceVideoConfig } from "../src/lib/seedance-video";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { apiClient } from "../src/services/api/request";
import { createVideoGenerationTask, pollVideoGenerationTask } from "../src/services/api/video";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const models = ["dola-sd-2.5", "dola-sd-2.0", "minimax-h3", "sd-2.5-j2-V", "sd-2.5-J2"];

function jiasuConfig(model = models[0], face = "default"): AiConfig {
    return normalizeConfigSnapshot({ config: {
        ...defaultConfig,
        channels: [
            createModelChannel({ id: "jiasu-video", name: "佳速视频", presetVersion: 1, baseUrl: "https://ai.jiasuapi.com", apiKey: "synthetic-jiasu-key", headers: [{ name: "X-Provider", value: "jiasu-only" }], interfaceType: "jiasu-video", models, modelProfiles: models.map((model) => ({ model, capability: "video", protocol: "jiasu-video", capabilityConfig: defaultModelCapabilityConfig("jiasu-video", model) })) }),
            createModelChannel({ id: "sd2", apiKey: "synthetic-sd2-key", interfaceType: "eggfans-sd2-video", models: ["sd-2.5-D"], modelProfiles: [{ model: "sd-2.5-D", capability: "video", protocol: "eggfans-sd2-video" }] }),
        ],
        model: `jiasu-video::${model}`,
        videoModel: `jiasu-video::${model}`,
        videoSeconds: model === "minimax-h3" ? "15" : "5",
        vquality: model === "minimax-h3" ? "2k" : "720p",
        size: "16:9",
        videoJiasuFaceMode: face,
        videoJiasuFaceMask: "off",
        videoNativeFace: "true",
        videoEggfansReferenceMode: "uri",
    } }).config;
}

describe("isolated Jiasu video channel", () => {
    test("shared Jiasu reference controls preserve canvas face modes and explain the J2-V restriction", () => {
        for (const theme of Object.values(canvasThemes)) {
            const legacy = renderToStaticMarkup(<JiasuVideoReferenceSettings config={jiasuConfig("dola-sd-2.5", "heavy")} theme={theme} onConfigChange={() => {}} />);
            expect(legacy).toContain("人脸处理");
            expect(legacy).toContain("素描处理");
            expect(legacy).toContain('aria-pressed="true"');
            expect(legacy).toContain("自动人脸遮罩");
            const j2 = renderToStaticMarkup(<JiasuVideoReferenceSettings config={jiasuConfig("sd-2.5-j2-V", "off")} theme={theme} onConfigChange={() => {}} />);
            expect(j2).toContain("face");
            expect(j2).toContain("服务端默认");
            expect(j2).not.toContain(">素描处理</button>");
            const foreign = { ...jiasuConfig(), model: "sd2::sd-2.5-D" };
            expect(renderToStaticMarkup(<JiasuVideoReferenceSettings config={foreign} theme={theme} onConfigChange={() => {}} />)).toBe("");
        }
    });
    test("keeps SD2 native-face parameters isolated while repairing its automatic audio status", () => {
        const config = jiasuConfig();
        config.model = "sd2::sd-2.5-D";
        config.videoGenerateAudio = "false";
        const profile = defaultModelCapabilityConfig("eggfans-sd2-video", "sd-2.5-D");
        profile.video!.generateAudio = { supported: false, default: false };
        config.channels[1].modelProfiles![0].capabilityConfig = profile;
        expect(modelCapabilityConfigFor(config, config.model).video!.generateAudio).toEqual({ supported: true, default: true });
        expect(resolveModelVideoBooleanOptions(config, config.model).videoGenerateAudio).toBe("true");
        expect(backendProviderConfig(config, "video")).toMatchObject({ interfaceType: "eggfans-sd2-video", face: true, videoGenerateAudio: "true" });
        expect(backendProviderConfig(config, "video")).not.toHaveProperty("videoJiasuFaceMode");
    });

    test("repairs legacy silent profiles and keeps automatic channel audio enabled", async () => {
        for (const model of [...models, "sd-2.0-mini-J1"]) {
            const config = jiasuConfig(model);
            const profile = defaultModelCapabilityConfig("jiasu-video", model);
            profile.video!.generateAudio = { supported: false, default: false };
            config.channels[0].models.push(model);
            config.channels[0].modelProfiles = [{ model, capability: "video", protocol: "jiasu-video", capabilityConfig: profile }];
            config.videoGenerateAudio = "false";
            expect(modelCapabilityConfigFor(config, config.model).video!.generateAudio).toEqual({ supported: true, default: true });
            expect(resolveModelVideoBooleanOptions(config, config.model, { videoGenerateAudio: "false" }).videoGenerateAudio).toBe("true");
            const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: "人物说你好，保留环境声音" });
            expect((task.input as { config: { videoGenerateAudio: string } }).config.videoGenerateAudio).toBe("true");
        }
    });

    test("preserves 30 seconds for Jiasu 2.5 while keeping other model duration limits", async () => {
        const profile = defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.5").video!;
        expect(videoDurationOptions(profile)).toContain(30);
        expect(videoDurationAllowed(profile, 30)).toBe(true);
        expect(videoDurationAllowed(profile, 31)).toBe(false);
        expect(normalizeVideoValue(profile, { seconds: "30" }).seconds).toBe("30");
        const config = { ...jiasuConfig(), videoSeconds: "30" };
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { model: config.model, seconds: "30" } };
        expect(buildGenerationConfig(config, node, "video").videoSeconds).toBe("30");
        const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene" });
        expect((task.input as { config: { videoSeconds: string } }).config.videoSeconds).toBe("30");
        expect(defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0").video!.duration.max).toBe(15);
        expect(defaultModelCapabilityConfig("jiasu-video", "minimax-h3").video!.duration.values).toEqual([15]);
    });
    test("keeps configured models video-only with their model-specific limits", () => {
        for (const model of models) {
            const config = jiasuConfig(model);
            const request = resolveModelRequestConfig(config, config.model);
            expect(request.model).toBe(model);
            expect(request.interfaceType).toBe("jiasu-video");
            expect(request.apiKey).toBe("synthetic-jiasu-key");
            expect(config.channels[0].modelProfiles?.every((profile) => profile.capability === "video")).toBe(true);
            const profile = defaultModelCapabilityConfig("jiasu-video", model).video!;
            const fullModalSeedance25 = /^sd-2\.5-j2(?:-v)?$/i.test(model);
            expect(profile.references.maxImages).toBe(model === "dola-sd-2.5" || fullModalSeedance25 ? 30 : 10);
            expect(profile.references.maxVideos).toBe(fullModalSeedance25 ? 10 : 3);
            expect(profile.references.maxAudios).toBe(model === "dola-sd-2.5" || fullModalSeedance25 ? 10 : 3);
        }
    });

    test("J2 Seedance models expose full-modal references and refresh stale saved limits", () => {
        const config = jiasuConfig("sd-2.5-j2-V");
        const savedProfile = config.channels[0].modelProfiles?.find((profile) => profile.model === "sd-2.5-j2-V");
        savedProfile!.capabilityConfig = defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0");

        const profile = modelCapabilityConfigFor(config, config.model).video!;
        expect(profile.references).toMatchObject({ maxImages: 30, maxVideos: 10, maxAudios: 10, maxTotalBytes: 100 * 1024 * 1024 });
        expect(profile.duration).toMatchObject({ min: 5, max: 30 });
        expect(profile.resolutions).toEqual(["720p"]);
        expect(modelCompatibilityError(config, config.model, {
            capability: "video",
            videoSeconds: "30",
            input: { textCount: 1, imageCount: 30, videoCount: 10, audioCount: 10, characterCount: 0 },
        })).toBe("");
        expect(modelCompatibilityError(config, config.model, {
            capability: "video",
            input: { textCount: 1, imageCount: 31, videoCount: 0, audioCount: 0, characterCount: 0 },
        })).toContain("30");
        expect(modelCapabilityConfigFor(jiasuConfig("sd-2.5-J2"), "jiasu-video::sd-2.5-J2").video!.references).toMatchObject({ maxImages: 30, maxVideos: 10, maxAudios: 10 });
    });

    test("restores new Jiasu 2.5 models from saved generic profiles without losing 30-second settings", async () => {
        for (const model of ["sd-2.5-J3-doubao", "sd-2.5-j3-DOUBAO", "vendor/SD2.5-next"]) {
            const config = jiasuConfig(model);
            const stale = defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0");
            stale.video!.resolutions = [];
            stale.video!.defaultResolution = "";
            config.channels[0].models.push(model);
            config.channels[0].modelProfiles!.push({ model, capability: "video", protocol: "jiasu-video", capabilityConfig: stale });
            config.model = `jiasu-video::${model}`;
            config.videoModel = config.model;
            config.videoSeconds = "30";
            config.vquality = "1080p";
            const restored = normalizeConfigSnapshot(JSON.parse(JSON.stringify({ config }))).config;
            const profile = modelCapabilityConfigFor(restored, restored.model).video!;
            expect(videoDurationAllowed(profile, 30)).toBe(true);
            expect(videoDurationAllowed(profile, 31)).toBe(false);
            expect(profile.resolutions).toContain("1080p");
            expect(profile.references).toMatchObject({ maxImages: 30, maxVideos: 10, maxAudios: 10 });
            expect(modelCompatibilityError(restored, restored.model, { capability: "video", videoSeconds: "30" })).toBe("");
            const node: CanvasNodeData = { id: "video-j3", type: CanvasNodeType.Video, title: "J3", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { model: restored.model, seconds: "30", vquality: "1080p" } };
            const generation = buildGenerationConfig(restored, node, "video");
            expect(generation.videoSeconds).toBe("30");
            expect(generation.vquality).toBe("1080");
            const task = await prepareBackendGenerationTask({ mode: "video", config: generation, prompt: "@角色1在@场景1中走动" });
            expect((task.input as { config: Record<string, unknown> }).config).toMatchObject({ model, interfaceType: "jiasu-video", videoSeconds: "30", vquality: "1080", baseUrl: "https://www.gway.dev" });
            expect(modelCapabilityConfigFor(restored, "jiasu-video::sd-2.5-j2-V").video!.resolutions).toEqual(["720p"]);
        }
    });

    test("ignores other channels' private URI bindings and sends original media URLs in order", async () => {
        const input = await prepareBackendGenerationTask({ mode: "video", config: jiasuConfig(), prompt: "@角色1 @视频1 @音频1", referenceImages: [{ id: "image", name: "角色1", type: "image/png", url: "https://h.uguu.se/image.png", arkAssetId: "foreign-image" }], referenceVideos: [{ id: "video", name: "动作", type: "video/mp4", url: "https://h.uguu.se/clip.mp4", arkAssetId: "foreign-video", durationMs: 6000 }], referenceAudios: [{ id: "audio", name: "声音", type: "audio/mpeg", url: "https://h.uguu.se/voice.mp3", arkAssetId: "foreign-audio", durationMs: 3000 }] });
        const payload = input.input as { config: Record<string, unknown>; referenceImages: Array<{ url: string; name: string }>; referenceVideos: Array<{ url: string; durationMs: number }>; referenceAudios: Array<{ url: string }> };
        expect(payload.config).toMatchObject({ interfaceType: "jiasu-video", model: "dola-sd-2.5", apiKey: "synthetic-jiasu-key", videoJiasuFaceMode: "default" });
        expect(payload.config).not.toHaveProperty("videoNativeFace");
        expect(payload.referenceImages[0]).toMatchObject({ url: "https://h.uguu.se/image.png", name: "角色1" });
        expect(payload.referenceVideos[0]).toMatchObject({ url: "https://h.uguu.se/clip.mp4", durationMs: 6000 });
        expect(payload.referenceAudios[0].url).toBe("https://h.uguu.se/voice.mp3");
    });

    test("keeps owned resource keys for automatic URL renewal and excludes URI fallback even with an Ark-shaped URL", async () => {
        const config = jiasuConfig();
        config.channels[0].baseUrl = "https://example.com/api/plan/v3";
        expect(isSeedanceVideoConfig(config)).toBe(false);
        const input = await prepareBackendGenerationTask({ mode: "video", config, prompt: "@图片1", referenceImages: [{ id: "image", name: "角色", type: "image/png", url: "asset://foreign", arkAssetId: "foreign", storageKey: "resource:owned-original" }] });
        const images = (input.input as { referenceImages: Array<{ storageKey: string; url?: string }> }).referenceImages;
        expect(images[0].storageKey).toBe("resource:owned-original");
        expect(images[0].url).toBeUndefined();
        await expect(prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [{ id: "image", name: "角色", type: "image/png", url: "asset://foreign" }] })).rejects.toThrow("不接受私域资产 URI");
    });

    test("re-uploads the local original behind a Uguu link so expired URLs can be refreshed", async () => {
        const original = apiClient.defaults.adapter;
        let uploads = 0;
        apiClient.defaults.adapter = async (request) => {
            uploads++;
            expect(request.url).toContain("/resources");
            return {
                config: request,
                status: 200,
                statusText: "OK",
                headers: {},
                data: { code: 0, data: { resource: { id: "recovered-image", kind: "image", mimeType: "image/png", size: 5, status: "ready" } } },
            };
        };
        try {
            const task = await prepareBackendGenerationTask({
                mode: "video",
                config: jiasuConfig(),
                prompt: "scene",
                referenceImages: [{ id: "image", name: "scene.png", type: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=", url: "https://h.uguu.se/expired.png" }],
            });
            const image = (task.input as { referenceImages: Array<{ storageKey?: string; url?: string }> }).referenceImages[0];
            expect(image.storageKey).toBe("resource:recovered-image");
            expect(image.url).toBeUndefined();
            expect(uploads).toBe(1);
        } finally {
            apiClient.defaults.adapter = original;
        }
    });

    test("accepts 30 images and 10 audio references, rejects overflow and preserves other model limits", async () => {
        const images = Array.from({ length: 30 }, (_, index) => ({ id: `image-${index}`, name: `图片${index + 1}`, type: "image/png", url: `https://cdn.example/${index}.png` }));
        const audios = Array.from({ length: 10 }, (_, index) => ({ id: `audio-${index}`, name: `音频${index + 1}`, type: "audio/mpeg", url: `https://cdn.example/${index}.mp3`, durationMs: 2000 }));
        const input = await prepareBackendGenerationTask({ mode: "video", config: jiasuConfig(), prompt: "@图片30 @音频10", referenceImages: images, referenceAudios: audios });
        expect((input.input as { referenceImages: unknown[] }).referenceImages).toHaveLength(30);
        await expect(prepareBackendGenerationTask({ mode: "video", config: jiasuConfig(), prompt: "scene", referenceImages: [...images, images[0]] })).rejects.toThrow("30 张参考图");
        const sd20 = await prepareBackendGenerationTask({ mode: "video", config: jiasuConfig("dola-sd-2.0"), prompt: "scene", referenceImages: images.slice(0, 10) });
        expect((sd20.input as { referenceImages: unknown[] }).referenceImages).toHaveLength(10);
        await expect(prepareBackendGenerationTask({ mode: "video", config: jiasuConfig("dola-sd-2.0"), prompt: "scene", referenceImages: images.slice(0, 11) })).rejects.toThrow("10 张参考图");
        await expect(prepareBackendGenerationTask({ mode: "video", config: jiasuConfig(), prompt: "scene", referenceAudios: [...audios, audios[0]] })).rejects.toThrow("10 段参考音频");
    });

    test("J2 full-modal references accept 30 images, 10 videos, 10 audios within 100 MiB", async () => {
        const config = { ...jiasuConfig("sd-2.5-j2-V"), videoSeconds: "30" };
        const images = Array.from({ length: 30 }, (_, index) => ({ id: `image-${index}`, name: `图片${index + 1}`, type: "image/png", url: `https://cdn.example/${index}.png`, bytes: 1024 }));
        const videos = Array.from({ length: 10 }, (_, index) => ({ id: `video-${index}`, name: `视频${index + 1}`, type: "video/mp4", url: `https://cdn.example/${index}.mp4`, bytes: 1024, durationMs: 1000 }));
        const audios = Array.from({ length: 10 }, (_, index) => ({ id: `audio-${index}`, name: `音频${index + 1}`, type: "audio/mpeg", url: `https://cdn.example/${index}.mp3`, bytes: 1024, durationMs: 1000 }));
        const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: "full-modal", referenceImages: images, referenceVideos: videos, referenceAudios: audios });
        const input = task.input as { referenceImages: unknown[]; referenceVideos: unknown[]; referenceAudios: unknown[] };
        expect(input.referenceImages).toHaveLength(30);
        expect(input.referenceVideos).toHaveLength(10);
        expect(input.referenceAudios).toHaveLength(10);
        await expect(prepareBackendGenerationTask({ mode: "video", config, prompt: "video overflow", referenceVideos: [...videos, videos[0]] })).rejects.toThrow("10 个参考视频");
        await expect(prepareBackendGenerationTask({ mode: "video", config, prompt: "audio overflow", referenceAudios: [...audios, audios[0]] })).rejects.toThrow("10 段参考音频");

        const atLimit = await prepareBackendGenerationTask({ mode: "video", config, prompt: "100 MiB", referenceVideos: [{ ...videos[0], bytes: 100 * 1024 * 1024 }] });
        expect((atLimit.input as { referenceVideos: unknown[] }).referenceVideos).toHaveLength(1);

        await expect(prepareBackendGenerationTask({
            mode: "video",
            config,
            prompt: "oversize",
            referenceImages: [{ id: "large-1", name: "large-1", type: "image/png", url: "https://cdn.example/large-1.png", bytes: 60 * 1024 * 1024 }, { id: "large-2", name: "large-2", type: "image/png", url: "https://cdn.example/large-2.png", bytes: 41 * 1024 * 1024 }],
        })).rejects.toThrow("100 MiB");
    });

    test("H3 uses its own fixed output settings and rejects video duration overflow", async () => {
        const config = buildGenerationConfig(jiasuConfig("minimax-h3"), undefined, "video");
        expect(config.videoSeconds).toBe("15");
        expect(defaultModelCapabilityConfig("jiasu-video", "minimax-h3").video!.resolutions).toEqual(["2k"]);
        await expect(prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceVideos: [{ id: "one", name: "视频1", type: "video/mp4", url: "https://cdn.example/1.mp4", durationMs: 8000 }, { id: "two", name: "视频2", type: "video/mp4", url: "https://cdn.example/2.mp4", durationMs: 8000 }] })).rejects.toThrow("总时长");
    });

    test("creates and polls only backend tasks without using another channel's key", async () => {
        const original = apiClient.defaults.adapter;
        const calls: string[] = [];
        apiClient.defaults.adapter = async (request) => {
            calls.push(`${request.method} ${request.url}`);
            if (request.method === "post") {
                const body = JSON.parse(request.data);
                expect(body.input.config).toMatchObject({ channelId: "", interfaceType: "jiasu-video", apiKey: "synthetic-jiasu-key", headers: [{ name: "X-Provider", value: "jiasu-only" }] });
                expect(body.input.config).not.toHaveProperty("videoNativeFace");
            }
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "local-jiasu", status: request.method === "post" ? "queued" : "succeeded", resultJson: JSON.stringify({ video: { url: "/api/resources/video/file", mimeType: "video/mp4" } }) } } };
        };
        try {
            const task = await createVideoGenerationTask(jiasuConfig(), "scene");
            expect(task.provider).toBe("backend");
            expect(await pollVideoGenerationTask(jiasuConfig(), task)).toMatchObject({ status: "completed", result: { url: "/api/resources/video/file" } });
            expect(calls).toEqual(["post /tasks", "get /tasks/local-jiasu"]);
        } finally { apiClient.defaults.adapter = original; }
    });

    test("persists face preference, retains node override, and hides Jiasu controls and parameters on SD2", async () => {
        const originalState = useConfigStore.getState();
        const originalStorage = useConfigStore.persist.getOptions().storage;
        const snapshots = new Map<string, string>();
        useConfigStore.persist.setOptions({ storage: createJSONStorage(() => ({ getItem: (key) => snapshots.get(key) ?? null, setItem: (key, value) => { snapshots.set(key, value); }, removeItem: (key) => { snapshots.delete(key); } })) });
        try {
            useConfigStore.setState({ config: jiasuConfig() });
            useConfigStore.getState().updateConfig("videoJiasuFaceMode", "heavy");
            const saved = new Map(snapshots);
            useConfigStore.setState({ config: jiasuConfig() });
            for (const [key, value] of saved) snapshots.set(key, value);
            await useConfigStore.persist.rehydrate();
            expect(useConfigStore.getState().config.videoJiasuFaceMode).toBe("heavy");
            const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "video", width: 320, height: 180, position: { x: 0, y: 0 }, metadata: { jiasuFaceMode: "off" } };
            const config = buildGenerationConfig(useConfigStore.getState().config, node, "video");
            expect(config.videoJiasuFaceMode).toBe("off");
            expect(backendProviderConfig(config, "video")).toHaveProperty("videoJiasuFaceMode", "off");
            expect(backendProviderConfig(config, "image")).not.toHaveProperty("videoJiasuFaceMode");
            for (const theme of Object.values(canvasThemes)) {
                const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={theme} onConfigChange={() => {}} />);
                expect(html).toContain("人脸处理");
                expect(html).not.toContain("过人脸");
                expect(html).not.toContain("使用资产 URI");
            }
            const sd2 = { ...config, model: "sd2::sd-2.5-D", videoModel: "sd2::sd-2.5-D" };
            expect(backendProviderConfig(sd2, "video")).not.toHaveProperty("videoJiasuFaceMode");
            expect(renderToStaticMarkup(<VideoSettingsPanel config={sd2} theme={Object.values(canvasThemes)[0]} onConfigChange={() => {}} />)).not.toContain("人脸处理");
        } finally {
            useConfigStore.setState(originalState, true);
            useConfigStore.persist.setOptions({ storage: originalStorage });
        }
    });
});
