import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import sd2Preset from "../../backend/internal/providerpreset/catalog/eggfans-sd2.v1.json";

import { defaultModelCapabilityConfig, modelCapabilityConfigFor, type ModelCapabilityConfig } from "../src/lib/model-capabilities";
import { defaultProtocolForModel, inferProtocolCapabilityFromModel } from "../src/lib/model-protocols";
import { createEggfansSd2VideoTask, eggfansAspectRatio, eggfansImageLimit, isEggfansPublicHttpsUrl, pollEggfansSd2VideoTask } from "../src/services/api/video-provider-eggfans-sd2";
import type { VideoProviderDeps } from "../src/services/api/video-provider-deps";
import { videoResponseTools } from "../src/services/api/video-response";
import { createVideoTransport } from "../src/services/api/video-transport";
import { fetchChannelModels } from "../src/services/api/image-models";
import { http } from "../src/services/api/request";
import { buildApiUrl, createModelChannel, defaultBaseUrlForChannelInterface, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, type AiConfig } from "../src/stores/use-config-store";

const originalAxiosRequest = axios.request;
const originalHttpPost = http.post;

afterEach(() => {
    axios.request = originalAxiosRequest;
    http.post = originalHttpPost;
});

function configForEggfans(model = "sd-2.5-C", input: Partial<AiConfig> = {}) {
    const capabilityConfig = defaultModelCapabilityConfig("eggfans-sd2-video", model);
    const channel = createModelChannel({
        id: "eggfans-sd2",
        name: "EggFans SD2",
        baseUrl: "https://vip.eggfans.asia",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        interfaceType: "eggfans-sd2-video",
        models: [model],
        modelProfiles: [{ model, capability: "video", protocol: "eggfans-sd2-video", capabilityConfig }],
    });
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            ...input,
            baseUrl: input.baseUrl || channel.baseUrl,
            channels: [channel],
            model: `eggfans-sd2::${model}`,
            videoModel: `eggfans-sd2::${model}`,
            videoSeconds: input.videoSeconds || "6",
            size: input.size || "16:9",
        },
    }).config;
}

function providerDeps(config: ReturnType<typeof import("../src/stores/use-config-store").resolveModelRequestConfig>, input?: { created?: unknown; polled?: unknown }) {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const deps = {
        transport: {
            apiUrl: (path: string) => buildApiUrl(config.baseUrl, path),
            post: async (url: string, body: unknown) => {
                calls.push({ method: "POST", url, body });
                return input?.created || { id: "task-1" };
            },
            get: async (url: string) => {
                calls.push({ method: "GET", url });
                return input?.polled || { id: "task-1", status: "queued" };
            },
            getTaskStatus: async (url: string) => {
                calls.push({ method: "GET", url });
                return input?.polled || { id: "task-1", status: "queued" };
            },
        },
        response: {
            ...videoResponseTools,
            videoResultFromUrl: async (url: string) => ({ url, mimeType: "video/mp4" }),
        },
    } as unknown as VideoProviderDeps;
    return { calls, deps };
}

describe("EggFans SD2 video protocol", () => {
    test("every SD2 2.5 variant submits all thirty reference images", async () => {
        const images = Array.from({ length: 30 }, (_, index) => ({ id: `image-${index}`, name: `reference-${index}`, type: "image/png", dataUrl: "", url: `https://cdn.example/${index}.png` }));
        for (const model of sd2Preset.models.map((profile) => profile.model)) {
            const config = resolveModelRequestConfig(configForEggfans(model), `eggfans-sd2::${model}`);
            const { calls, deps } = providerDeps(config);
            await createEggfansSd2VideoTask(deps, config, model, "scene", images, [], [], { videoEditOperation: "reference_to_video" });
            expect(calls).toHaveLength(1);
            expect((calls[0].body as { image_refs: string[] }).image_refs).toEqual(images.map((image) => image.url));
        }
    });

    test("submits boolean native_face when enabled for every SD2 model", async () => {
        for (const model of sd2Preset.models.map((profile) => profile.model)) {
            for (const enabled of [true, false]) {
                const config = resolveModelRequestConfig(configForEggfans(model, { videoNativeFace: String(enabled) }), `eggfans-sd2::${model}`);
                const { calls, deps } = providerDeps(config);
                await createEggfansSd2VideoTask(deps, config, model, "scene", [{ id: "image", name: "reference", type: "image/png", dataUrl: "", url: "https://cdn.example/ref.png" }], [], []);
                expect(calls).toHaveLength(1);
                if (enabled) expect(calls[0].body).toHaveProperty("native_face", true);
                else expect(calls[0].body).not.toHaveProperty("native_face");
            }
        }
    });

    test("native face requires image, video or first frame and is omitted for text, audio and last frame only", async () => {
        const config = resolveModelRequestConfig(configForEggfans("sd-2.5-D", { videoNativeFace: "true" }), "eggfans-sd2::sd-2.5-D");
        const image = { id: "frame", name: "frame", type: "image/png", dataUrl: "", url: "https://cdn.example/frame.png" };
        for (const item of [
            { images: [], videos: [], audios: [], options: {}, want: false },
            { images: [], videos: [], audios: [{ id: "audio", name: "audio", type: "audio/mpeg", url: "https://cdn.example/audio.mp3" }], options: {}, want: false },
            { images: [], videos: [{ id: "video", name: "video", type: "video/mp4", url: "https://cdn.example/video.mp4" }], audios: [], options: {}, want: true },
            { images: [image], videos: [], audios: [], options: { videoStartFrameNodeId: "frame" }, want: true },
            { images: [image], videos: [], audios: [], options: { videoEndFrameNodeId: "frame" }, want: false },
        ]) {
            const { calls, deps } = providerDeps(config);
            await createEggfansSd2VideoTask(deps, config, "sd-2.5-D", "scene", item.images, item.videos, item.audios, item.options);
            if (item.want) expect(calls[0].body).toHaveProperty("native_face", true);
            else expect(calls[0].body).not.toHaveProperty("native_face");
            expect(calls[0].body).not.toHaveProperty("face");
        }
    });

    test("uploads local image resources before submitting their temporary URLs to SD2", async () => {
        const uploads: Array<{ path: string; timeout?: number; signal?: AbortSignal }> = [];
        http.post = (async (path: string, _body: unknown, options: { timeout?: number; signal?: AbortSignal }) => {
            uploads.push({ path, ...options });
            return { url: "https://h.uguu.se/reference.png" };
        }) as typeof http.post;
        const config = configForEggfans("sd-2.5-E");
        const { calls, deps } = providerDeps(config);
        const controller = new AbortController();
        await createEggfansSd2VideoTask(deps, config as never, "sd-2.5-E", "scene", [{ id: "local-image", name: "角色.png", type: "image/png", dataUrl: "", storageKey: "resource:local-image" }], [], [], { signal: controller.signal, videoEditOperation: "reference_to_video" });
        expect(uploads).toEqual([{ path: "/resources/local-image/temporary-image-url", timeout: 125_000, signal: controller.signal }]);
        expect(calls[0].body).toMatchObject({ image_refs: ["https://h.uguu.se/reference.png"] });
    });

    test("does not submit a model request when temporary image hosting fails", async () => {
        http.post = (async () => { throw new Error("Uguu 图片上传失败"); }) as typeof http.post;
        const config = configForEggfans();
        const { calls, deps } = providerDeps(config);
        await expect(createEggfansSd2VideoTask(deps, config as never, "sd-2.5-C", "scene", [{ id: "local-image", name: "image.png", type: "image/png", dataUrl: "", storageKey: "resource:local-image" }], [], [])).rejects.toThrow("Uguu 图片上传失败");
        expect(calls).toEqual([]);
    });

    test("ignores private asset IDs and stale preview URLs for owned SD2 images", async () => {
        const uploads: string[] = [];
        http.post = (async (path: string) => {
            uploads.push(path);
            return { url: "https://h.uguu.se/refreshed.png" };
        }) as typeof http.post;
        const config = configForEggfans();
        const { calls, deps } = providerDeps(config);
        await createEggfansSd2VideoTask(deps, config as never, "sd-2.5-C", "@图片1", [{ id: "local-image", name: "image.png", type: "image/png", dataUrl: "", url: "asset://seedance-only", arkAssetId: "seedance-only", storageKey: "resource:local-image" }], [], [], { videoEditOperation: "reference_to_video" });
        expect(uploads).toEqual(["/resources/local-image/temporary-image-url"]);
        expect(calls).toEqual([{ method: "POST", url: "https://vip.eggfans.asia/v1/videos", body: { model: "sd-2.5-C", prompt: "@图片1", duration: 6, resolution: "720p", aspect_ratio: "16:9", image_refs: ["https://h.uguu.se/refreshed.png"] } }]);
    });

    test("rejects URI-only references without contacting the private library or SD2", async () => {
        const uploads: string[] = [];
        http.post = (async (path: string) => { uploads.push(path); throw new Error("unexpected upload"); }) as typeof http.post;
        const config = configForEggfans();
        const { calls, deps } = providerDeps(config);
        await expect(createEggfansSd2VideoTask(deps, config as never, "sd-2.5-C", "scene", [{ id: "private", name: "image.png", type: "image/png", dataUrl: "", url: "asset://private-image" }], [], [])).rejects.toThrow("SD2 不支持私域资产 URI");
        expect(uploads).toEqual([]);
        expect(calls).toEqual([]);
    });

    test("exposes every built-in SD2 model as a video option while preserving the current selection", async () => {
        const existing = createModelChannel({ id: "existing", models: ["existing-video"], apiKey: "synthetic-test-key", modelProfiles: [{ model: "existing-video", capability: "video", protocol: "newapi" }] });
        const sd2 = createModelChannel({
            id: sd2Preset.id,
            name: sd2Preset.displayName,
            baseUrl: sd2Preset.baseUrl,
            presetVersion: sd2Preset.presetVersion,
            models: sd2Preset.models.map((profile) => profile.model),
            modelProfiles: sd2Preset.models.map((profile) => ({ model: profile.model, capability: "video", protocol: "eggfans-sd2-video", capabilityConfig: profile.capabilityConfig as ModelCapabilityConfig })),
        });
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [existing, sd2], videoModel: "existing::existing-video" } }).config;
        expect(config.videoModel).toBe("existing::existing-video");
        expect(config.channels.find((channel) => channel.id === "existing")?.apiKey).toBe(existing.apiKey);
        expect(config.videoModels).toContain("existing::existing-video");
        for (const model of sd2.models) {
            const option = `${sd2.id}::${model}`;
            expect(config.videoModels).toContain(option);
            expect(config.textModels).not.toContain(option);
            expect(modelCapabilityConfigFor(config, option).video).toMatchObject({ duration: { min: 4, max: 30 }, resolutions: ["720p"], references: { maxImages: 30, maxVideos: 10, maxAudios: 10 } });
            expect(resolveModelRequestConfig(config, option)).toMatchObject({ baseUrl: sd2.baseUrl, interfaceType: "eggfans-sd2-video", model });
        }
        axios.request = (async () => { throw new Error("SD2 has no remote models endpoint"); }) as typeof axios.request;
        const catalog = await fetchChannelModels(sd2, true);
        expect(catalog.models).toEqual(sd2.models);
        expect(catalog.catalog.every((item) => item.modelType === "video")).toBe(true);
    });

    test("infers the protocol and video capability for SD2 model IDs", () => {
        expect(inferProtocolCapabilityFromModel("sd-2.5-C")).toBe("video");
        expect(defaultProtocolForModel("sd-2.5-C")).toBe("eggfans-sd2-video");
        expect(eggfansImageLimit("sd-2.5-B")).toBe(30);
        expect(eggfansImageLimit("sd-2.5-D")).toBe(30);
        expect(eggfansImageLimit("sd-2.5-C")).toBe(30);
        expect(defaultModelCapabilityConfig("eggfans-sd2-video", "sd-2.5-B").video).toMatchObject({
            references: { maxImages: 30, maxVideos: 10, maxAudios: 10 },
            duration: { min: 4, max: 30 },
            resolutions: ["720p"],
        });
    });

    test("defaults a new EggFans channel to its host and selects model C when unset", () => {
        expect(defaultBaseUrlForChannelInterface("eggfans-sd2-video")).toBe("https://vip.eggfans.asia");
        const models = ["sd-2.5-A", "sd-2.5-B", "sd-2.5-C", "sd-2.5-D", "sd-2.5-E"];
        const channel = createModelChannel({
            id: "eggfans-sd2",
            name: "EggFans SD2",
            baseUrl: defaultConfig.baseUrl,
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            models,
            modelProfiles: models.map((model) => ({ model, capability: "video", protocol: "eggfans-sd2-video" })),
        });
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], videoModel: "" } }).config;
        expect(config.videoModel).toBe("eggfans-sd2::sd-2.5-C");
        expect(resolveModelRequestConfig(config, "eggfans-sd2::sd-2.5-C").baseUrl).toBe("https://vip.eggfans.asia");
    });

    test("maps request fields to EggFans /v1/videos and fixes resolution at 720p", async () => {
        const config = configForEggfans();
        const { calls, deps } = providerDeps(config);
        const task = await createEggfansSd2VideoTask(
            deps,
            config as never,
            "eggfans-sd2::sd-2.5-C",
            "a moving scene",
            [
                { id: "image-1", name: "one.png", type: "image/png", dataUrl: "", url: "https://cdn.example/one.png" },
                { id: "image-2", name: "two.png", type: "image/png", dataUrl: "", url: "https://cdn.example/two.png" },
            ],
            [{ id: "video-1", name: "ref.mp4", type: "video/mp4", url: "https://cdn.example/ref.mp4" }],
            [{ id: "audio-1", name: "voice.mp3", type: "audio/mpeg", url: "https://cdn.example/voice.mp3" }],
        );

        expect(task).toEqual({ id: "task-1", provider: "eggfans-sd2", model: "eggfans-sd2::sd-2.5-C" });
        expect(calls[0]).toEqual({
            method: "POST",
            url: "https://vip.eggfans.asia/v1/videos",
            body: {
                model: "sd-2.5-C",
                prompt: "a moving scene",
                duration: 6,
                resolution: "720p",
                aspect_ratio: "16:9",
                image_refs: ["https://cdn.example/one.png", "https://cdn.example/two.png"],
                video_refs: ["https://cdn.example/ref.mp4"],
                audio_refs: ["https://cdn.example/voice.mp3"],
            },
        });
    });

    test("uses first_image and last_image only in frame mode", async () => {
        const config = configForEggfans("sd-2.5-C");
        const { calls, deps } = providerDeps(config);
        await createEggfansSd2VideoTask(
            deps,
            config as never,
            "sd-2.5-C",
            "camera move",
            [
                { id: "start", name: "start.png", type: "image/png", dataUrl: "", url: "https://cdn.example/start.png" },
                { id: "end", name: "end.png", type: "image/png", dataUrl: "", url: "https://cdn.example/end.png" },
            ],
            [],
            [],
            { videoStartFrameNodeId: "start", videoEndFrameNodeId: "end" },
        );
        expect(calls[0]?.body).toMatchObject({
            first_image: "https://cdn.example/start.png",
            last_image: "https://cdn.example/end.png",
        });
        expect(calls[0]?.body).not.toHaveProperty("image_refs");
    });

    test("rejects invalid duration, reference caps, mixed frame/reference modes and non-HTTPS media", async () => {
        const config = configForEggfans("sd-2.5-C", { videoSeconds: "3" });
        const { deps } = providerDeps(config);
        await expect(createEggfansSd2VideoTask(deps, config as never, "sd-2.5-C", "prompt", [], [], [])).rejects.toThrow("4–30");

        const longConfig = configForEggfans("sd-2.5-C", { videoSeconds: "31" });
        await expect(createEggfansSd2VideoTask(providerDeps(longConfig).deps, longConfig as never, "sd-2.5-C", "prompt", [], [], [])).rejects.toThrow("4–30");

        const image = (id: string) => ({ id, name: `${id}.png`, type: "image/png", dataUrl: "", url: `https://cdn.example/${id}.png` });
        const bdConfig = configForEggfans("sd-2.5-B");
        await expect(createEggfansSd2VideoTask(providerDeps(bdConfig).deps, bdConfig as never, "sd-2.5-B", "prompt", Array.from({ length: 31 }, (_, index) => image(String(index))), [], [])).rejects.toThrow("最多支持 30 张");

        const frameConfig = configForEggfans();
        await expect(createEggfansSd2VideoTask(providerDeps(frameConfig).deps, frameConfig as never, "sd-2.5-C", "prompt", [image("start"), image("ref")], [], [], { videoStartFrameNodeId: "start" })).rejects.toThrow("不能与图片、视频或音频参考素材同时使用");

        await expect(createEggfansSd2VideoTask(providerDeps(frameConfig).deps, frameConfig as never, "sd-2.5-C", "prompt", [{ ...image("http"), url: "http://cdn.example/image.png" }], [], [])).rejects.toThrow("只接受公网 HTTPS URL");
    });

    test("accepts create task ID aliases and polls supported video URL shapes", async () => {
        for (const created of [{ id: "id-1" }, { task_id: "id-2" }, { taskId: "id-3" }]) {
            const config = configForEggfans();
            const task = await createEggfansSd2VideoTask(providerDeps(config, { created }).deps, config as never, "sd-2.5-C", "prompt", [], [], []);
            expect(task.id).toBe(Object.values(created)[0]);
        }

        const config = configForEggfans();
        const { calls, deps } = providerDeps(config, { polled: { status: "completed", output: { url: "https://cdn.example/result.mp4" } } });
        const state = await pollEggfansSd2VideoTask(deps, config as never, { id: "task/1", provider: "eggfans-sd2", model: "sd-2.5-C" });
        expect(calls[0]?.url).toBe("https://vip.eggfans.asia/v1/videos/task%2F1");
        expect(state).toEqual({ status: "completed", result: { url: "https://cdn.example/result.mp4", mimeType: "video/mp4" } });

        const failure = await pollEggfansSd2VideoTask(providerDeps(config, { polled: { status: "failed", error: { message: "invalid request" } } }).deps, config as never, { id: "task-2", provider: "eggfans-sd2", model: "sd-2.5-C" });
        expect(failure).toEqual({ status: "failed", error: "invalid request" });
    });

    test("real transport preserves EggFans asynchronous failure details", async () => {
        const config = configForEggfans();
        const resolved = resolveModelRequestConfig(config, "eggfans-sd2::sd-2.5-C");
        axios.request = (async () => ({
            data: { status: "failed", error: { message: "invalid duration" } },
            status: 200,
        })) as typeof axios.request;
        const deps = {
            transport: createVideoTransport(resolved),
            response: videoResponseTools,
        } as unknown as VideoProviderDeps;
        const state = await pollEggfansSd2VideoTask(deps, resolved, { id: "task-3", provider: "eggfans-sd2", model: "sd-2.5-C" });
        expect(state).toEqual({ status: "failed", error: "invalid duration" });
    });

    test("accepts only public HTTPS media and normalizes pixel dimensions", () => {
        expect(isEggfansPublicHttpsUrl("https://cdn.example/image.png")).toBe(true);
        expect(isEggfansPublicHttpsUrl("http://cdn.example/image.png")).toBe(false);
        expect(isEggfansPublicHttpsUrl("https://127.0.0.1/image.png")).toBe(false);
        expect(eggfansAspectRatio("1280x720")).toBe("16:9");
        expect(eggfansAspectRatio("9:16")).toBe("9:16");
    });
});
