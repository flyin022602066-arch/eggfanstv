import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { defaultProtocolForModel, inferProtocolCapabilityFromModel } from "../src/lib/model-protocols";
import { createEggfansSd2VideoTask, eggfansAspectRatio, eggfansImageLimit, isEggfansPublicHttpsUrl, pollEggfansSd2VideoTask } from "../src/services/api/video-provider-eggfans-sd2";
import type { VideoProviderDeps } from "../src/services/api/video-provider-deps";
import { videoResponseTools } from "../src/services/api/video-response";
import { createVideoTransport } from "../src/services/api/video-transport";
import { buildApiUrl, createModelChannel, defaultBaseUrlForChannelInterface, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, type AiConfig } from "../src/stores/use-config-store";

const originalAxiosRequest = axios.request;

afterEach(() => {
    axios.request = originalAxiosRequest;
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
    test("infers the protocol and video capability for SD2 model IDs", () => {
        expect(inferProtocolCapabilityFromModel("sd-2.5-C")).toBe("video");
        expect(defaultProtocolForModel("sd-2.5-C")).toBe("eggfans-sd2-video");
        expect(eggfansImageLimit("sd-2.5-B")).toBe(9);
        expect(eggfansImageLimit("sd-2.5-D")).toBe(9);
        expect(eggfansImageLimit("sd-2.5-C")).toBe(30);
        expect(defaultModelCapabilityConfig("eggfans-sd2-video", "sd-2.5-B").video).toMatchObject({
            references: { maxImages: 9, maxVideos: 10, maxAudios: 10 },
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
        await expect(createEggfansSd2VideoTask(providerDeps(bdConfig).deps, bdConfig as never, "sd-2.5-B", "prompt", Array.from({ length: 10 }, (_, index) => image(String(index))), [], [])).rejects.toThrow("最多支持 9 张");

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
