import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";

import { applyFetchedChannelModelCatalog } from "../src/pages/settings/channel-settings-pane";
import { ChannelModelSettings } from "../src/pages/settings/channel-model-settings";
import { modelCapabilityConfigFor, videoDurationOptions } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, modelDisplayName, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { fetchChannelModels } from "../src/services/api/image";
import { apiClient } from "../src/services/api/request";
import { maxModelInputCapacity, modelCompatibilityError, modelGroupReferenceLimits } from "../src/lib/model-selection";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";

const originalRequest = apiClient.request;
afterEach(() => { apiClient.request = originalRequest; });

test("nono discovers new video models and keeps native capabilities after reload", async () => {
    const preset = JSON.parse(readFileSync(new URL("../../backend/internal/providerpreset/catalog/nono-video.v1.json", import.meta.url), "utf8"));
    const catalog = preset.models.map((profile: Record<string, any>) => ({ id: profile.model, displayName: profile.displayName, modelType: "video", supportedEndpointTypes: ["nono-video"], videoCapabilities: profile.capabilityConfig.video, videoCapabilitiesVersion: "nono-v1" }));
    const channel = createModelChannel({ id: "nono-video", name: "nono", baseUrl: preset.baseUrl, apiKey: "synthetic-key", interfaceType: "nono-video", models: [] });
    apiClient.request = (async (request) => {
        expect(request.url).toBe("/ai/models");
        expect(request.data).toMatchObject({ baseUrl: "https://sub-tz.top/prod-api/v1", apiKey: "synthetic-key" });
        return { status: 200, data: { code: 0, data: { models: [...catalog, { id: "other-video", modelType: "video" }, { id: "image-only", modelType: "image" }] }, msg: "" } };
    }) as typeof apiClient.request;
    const fetched = await fetchChannelModels(channel);
    expect(fetched.models).toHaveLength(4);
    expect(fetched.models).toContain("other-video");
    expect(fetched.models).not.toContain("image-only");
    const refreshed = applyFetchedChannelModelCatalog(channel, fetched);
    const normalized = normalizeConfigSnapshot(JSON.parse(JSON.stringify({ config: { ...defaultConfig, channels: [refreshed] } }))).config;
    expect(resolveModelRequestConfig(normalized, "nono-video::other-video")).toMatchObject({ model: "other-video", interfaceType: "nono-video" });
    for (const [model, price, images, videos, audios] of [
        ["按条特惠seedance-2.5-720P 满血", "5.5积分/条", 30, 10, 10],
        ["按条福利seedance-2.5-720P", "4.8积分/条", 20, 5, 5],
        ["按条seedance-2.5-720P 只支持参考图", "3.5积分/条", 9, 0, 0],
    ] as const) {
        const selected = `nono-video::${model}`;
        const resolved = resolveModelRequestConfig(normalized, selected);
        expect(resolved.model).toBe(model);
        expect(resolved.interfaceType).toBe("nono-video");
        expect(resolved.baseUrl).toBe("https://sub-tz.top/prod-api/v1");
        expect(modelDisplayName(normalized, selected)).toContain(price);
        const capability = modelCapabilityConfigFor(normalized, selected).video!;
        expect(capability.references).toMatchObject({ promptMaxChars: 15000, maxImages: images, maxVideos: videos, maxAudios: audios });
        expect(capability.resolutions).toEqual(["720p"]);
        expect(capability.generateAudio).toEqual({ supported: true, default: true });
        expect(videoDurationOptions(capability).map(String)).toContain("30");
        if (model.includes("只支持参考图")) expect(videoDurationOptions(capability)).toHaveLength(1);
    }
});

test("nono refresh persists latest prices and new models without changing generation input", async () => {
    const model = "按条特惠seedance-2.5-720P 满血";
    let channel = createModelChannel({ id: "nono-video", name: "nono", baseUrl: "https://sub-tz.top/prod-api/v1", apiKey: "synthetic-key", interfaceType: "nono-video", models: [model] });
    const capability = modelCapabilityConfigFor({ channels: [channel] }, `nono-video::${model}`);
    channel.modelProfiles = [{ model, displayName: `${model} · 5.5积分/条`, capability: "video", protocol: "nono-video", capabilityConfig: capability, videoCapabilitiesVersion: "nono-v1" }];
    const other = createModelChannel({ id: "other", name: "Other", baseUrl: "https://example.com", interfaceType: "jiasu-video", models: ["wan3"] });
    const unrelated = JSON.stringify(other);
    const selected = `nono-video::${model}`;
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel, other], model: selected, videoModel: selected, videoSeconds: "30", size: "9:16", vquality: "720p" } }).config;
    channel = config.channels.find((item) => item.id === channel.id)!;
    const originalVideo = JSON.parse(JSON.stringify(channel.modelProfiles?.find((profile) => profile.model === model)?.capabilityConfig?.video));
    const generation = { mode: "video" as const, prompt: "unchanged edited prompt", config, referenceImages: [{ id: "ref", url: "https://h.uguu.se/ref.png", storageKey: "resource:ref" }] };
    const before = await prepareBackendGenerationTask(generation);
    let responseModels = [
        { id: model, modelType: "video", displayName: `${model} · 4.2积分/条`, supportedEndpointTypes: ["nono-video"], videoCapabilities: originalVideo, videoCapabilitiesVersion: "nono-v1" },
        { id: "future-video", modelType: "video", displayName: "future-video · 1080p 0.8积分/秒 / 720p 6积分/条", supportedEndpointTypes: ["nono-video"] },
    ];
    let calls = 0;
    apiClient.request = (async () => {
        calls++;
        return { status: 200, data: { code: 0, data: { models: responseModels }, msg: "" } };
    }) as typeof apiClient.request;
    for (const quote of ["4.2积分/条", "价格未提供"]) {
        responseModels = responseModels.map((item) => item.id === model ? { ...item, displayName: `${model} · ${quote}` } : item);
        channel = applyFetchedChannelModelCatalog(channel, await fetchChannelModels(channel));
        const restored = normalizeConfigSnapshot(JSON.parse(JSON.stringify({ config: { ...config, channels: [channel, other] } }))).config;
        expect(modelDisplayName(restored, selected)).toBe(`${model} · ${quote}`);
        expect(modelDisplayName(restored, "nono-video::future-video")).toContain("1080p 0.8积分/秒 / 720p 6积分/条");
        expect(resolveModelRequestConfig(restored, "nono-video::future-video")).toMatchObject({ model: "future-video", interfaceType: "nono-video" });
        const after = await prepareBackendGenerationTask({ ...generation, config: restored });
        expect(after.input).toEqual(before.input);
        expect(channel.modelProfiles?.find((profile) => profile.model === model)?.capabilityConfig?.video).toEqual(originalVideo);
        const html = renderToStaticMarkup(React.createElement(App, null, React.createElement(ChannelModelSettings, { channel, onChange: () => undefined })));
        expect(html).toContain(quote);
        expect(html).toContain("1080p 0.8积分/秒 / 720p 6积分/条");
    }
    expect(calls).toBe(2);
    expect(JSON.stringify(other)).toBe(unrelated);
});

test("nono restores the 15000 character limit from saved zero-limit profiles", () => {
    const channel = createModelChannel({ id: "nono-video", name: "nono", baseUrl: "https://sub-tz.top/prod-api/v1", apiKey: "synthetic-key", interfaceType: "nono-video", models: ["按条福利seedance-2.5-720P"] });
    const saved = modelCapabilityConfigFor({ channels: [channel] }, "nono-video::按条福利seedance-2.5-720P");
    saved.video!.references.promptMaxChars = 0;
    channel.modelProfiles = [{ model: "按条福利seedance-2.5-720P", protocol: "nono-video", capabilityConfig: saved }];
    expect(modelCapabilityConfigFor({ channels: [channel] }, "nono-video::按条福利seedance-2.5-720P").video!.references.promptMaxChars).toBe(15000);
});

test("nono submits every reference despite stale local model limits", async () => {
    for (const name of ["按条特惠seedance-2.5-720P 满血", "按条福利seedance-2.5-720P", "按条seedance-2.5-720P 只支持参考图"]) {
        const channel = createModelChannel({ id: "nono-video", name: "nono", baseUrl: "https://sub-tz.top/prod-api/v1", apiKey: "synthetic-key", interfaceType: "nono-video", models: [name] });
        const selected = `nono-video::${name}`;
        const profile = modelCapabilityConfigFor({ channels: [channel] }, selected);
        profile.video!.references = { ...profile.video!.references, maxImages: 1, maxVideos: 0, maxAudios: 0, maxImageBytes: 1 };
        channel.modelProfiles = [{ model: name, protocol: "nono-video", capabilityConfig: profile }];
        const config = { ...defaultConfig, channels: [channel], model: selected, videoModel: selected, videoSeconds: "30", size: "9:16", vquality: "720p" };
        expect(modelCompatibilityError(config, selected, { capability: "video", input: { textCount: 1, imageCount: 31, characterCount: 0, videoCount: 11, audioCount: 11 } })).toBe("");
        expect(modelGroupReferenceLimits(config, selected, "video")).toBeUndefined();
        for (const kind of ["image", "video", "audio"] as const) expect(maxModelInputCapacity(config, "video", kind)).toBe(Infinity);
        const referenceImages = Array.from({ length: 31 }, (_, index) => ({ id: `image-${index}`, url: `https://h.uguu.se/image-${index}.png`, storageKey: `resource:image-${index}`, bytes: 50 * 1024 * 1024 }));
        const referenceVideos = Array.from({ length: 11 }, (_, index) => ({ id: `video-${index}`, url: `https://h.uguu.se/video-${index}.mp4`, storageKey: `resource:video-${index}` }));
        const referenceAudios = Array.from({ length: 11 }, (_, index) => ({ id: `audio-${index}`, url: `https://h.uguu.se/audio-${index}.mp3`, storageKey: `resource:audio-${index}` }));
        const prepared = await prepareBackendGenerationTask({ mode: "video", prompt: "user edited prompt", config, referenceImages, referenceVideos, referenceAudios });
        const input = prepared.input as { referenceImages: unknown[]; referenceVideos: unknown[]; referenceAudios: unknown[] };
        expect(input.referenceImages).toHaveLength(31);
        expect(input.referenceVideos).toHaveLength(11);
        expect(input.referenceAudios).toHaveLength(11);
    }
});
