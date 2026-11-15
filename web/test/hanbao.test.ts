import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { assertVideoCapability } from "../src/services/api/video-validation";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { normalizeConfigSnapshot, channelHasGenerationCredential, createModelChannel, encodeChannelModel, modelOptionsFromChannels, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { HANBAO_MODELS } from "../src/lib/hanbao";
import { isFixedModelCatalogChannel } from "../src/lib/builtin-channels";

test("Hanbao preserves nine 4K references larger than 4 MiB for project and canvas tasks", async () => {
    const initial = normalizeConfigSnapshot().config;
    const originalChannel = initial.channels.find((item) => item.id === "hanbao")!;
    const modelName = HANBAO_MODELS[0]!;
    const legacy = defaultModelCapabilityConfig("hanbao-video", modelName);
    legacy.video!.references.maxImageBytes = 4 * 1024 * 1024;
    legacy.video!.references.maxTotalBytes = 4 * 1024 * 1024;
    legacy.video!.references.maxImages = 10;
    const channel = { ...originalChannel, modelProfiles: originalChannel.modelProfiles.map((profile) => ({ ...profile, capabilityConfig: legacy })) };
    const config = { ...initial, channels: [channel], model: encodeChannelModel(channel.id, modelName), videoSeconds: "8", size: "9:16", videoHanbaoFaceMask: "off" as const };
    const references = Array.from({ length: 9 }, (_, index) => ({ id: `reference-${index}`, name: `reference-${index}.png`, type: "image/png", storageKey: `resource:original-${index}`, dataUrl: "", bytes: 18 * 1024 * 1024, width: 3840, height: 2160 }));
    const profile = modelCapabilityConfigFor(config, config.model).video!;
    expect(profile.references.maxImages).toBe(9);
    expect(profile.references.maxImageBytes).toBe(0);
    expect(profile.references.maxTotalBytes || 0).toBe(0);
    expect(() => assertVideoCapability(profile, references, [], [], "8")).not.toThrow();
    expect(() => assertVideoCapability(profile, [...references, references[0]!], [], [], "8")).toThrow("9 张参考图");
    for (const projectId of [undefined, "project-fixture"]) {
        const task = await prepareBackendGenerationTask({ mode: "video", prompt: "fixture", config, projectId, referenceImages: references });
        const images = (task.input as { referenceImages: typeof references }).referenceImages;
        expect(images.map((image) => [image.storageKey, image.bytes, image.width, image.height])).toEqual(references.map((image) => [image.storageKey, image.bytes, image.width, image.height]));
    }
    expect(legacy.video!.references.maxImageBytes).toBe(4 * 1024 * 1024);
});

test("Hanbao has a fixed video-only catalog and needs no API Key", () => {
    const config = normalizeConfigSnapshot().config;
    const channel = config.channels.find((item) => item.id === "hanbao")!;
    expect(channel.models).toEqual(HANBAO_MODELS);
    expect(channel.apiKey).toBe("");
    expect(channelHasGenerationCredential(channel)).toBe(true);
    expect(channelHasGenerationCredential({ ...channel, id: "ordinary", interfaceType: undefined, modelProfiles: [] })).toBe(false);
    expect(isFixedModelCatalogChannel(channel.id)).toBe(true);
    for (const model of channel.models) {
        const video = defaultModelCapabilityConfig("hanbao-video", model).video!;
        expect(video.references.maxImages).toBe(9);
        expect(video.references.maxVideos).toBe(0);
        expect(video.references.maxAudios).toBe(0);
        expect(video.duration).toEqual({ selection: "range", min: 4, max: 30, step: 1, default: 5 });
        expect(video.ratios).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4"]);
        expect(video.resolutions).toEqual([]);
    }
    const request = resolveModelRequestConfig(config, modelOptionsFromChannels([channel])[0]);
    expect(request.interfaceType).toBe("hanbao-video");
    expect(request.apiKey).toBe("");
    expect(request.secretKey).toBe("");
    expect(request.headers).toEqual([]);
});

test("Hanbao and remote channels keep separate credentials and protocols when switching identical model names", () => {
    const config = normalizeConfigSnapshot().config;
    const hanbao = config.channels.find((channel) => channel.id === "hanbao")!;
    const remote = createModelChannel({
        id: "remote-isolation-fixture",
        baseUrl: "https://isolation.invalid/v1",
        apiKey: "fixture-remote-key",
        secretKey: "fixture-remote-secret",
        headers: [{ name: "X-Fixture", value: "remote-only" }],
        interfaceType: "newapi",
        models: [...HANBAO_MODELS],
    });
    const channels = [hanbao, remote];
    const snapshot = structuredClone(channels);
    let current = { ...config, channels };
    for (const model of HANBAO_MODELS) {
        for (const channel of [hanbao, remote, hanbao, remote]) {
            const request = resolveModelRequestConfig(current, encodeChannelModel(channel.id, model));
            expect(request.model).toBe(model);
            expect(request.baseUrl).toBe(channel.baseUrl);
            expect(request.interfaceType).toBe(channel.interfaceType);
            expect(request.apiKey).toBe(channel === hanbao ? "" : remote.apiKey);
            expect(request.secretKey).toBe(channel === hanbao ? "" : remote.secretKey);
            expect(request.headers).toEqual(channel === hanbao ? [] : remote.headers);
            expect(request.channelId).toBe("");
            current = request;
        }
    }
    expect(channels).toEqual(snapshot);
});

test("Restoring Hanbao defaults does not reset other providers", () => {
    const config = normalizeConfigSnapshot().config;
    const channels = config.channels.filter((channel) => channel.id !== "hanbao" && channel.id !== "doubao-browser").map((channel) => ({
        ...channel,
        apiKey: `fixture-${channel.id}`,
        secretKey: `fixture-secret-${channel.id}`,
        headers: [{ name: "X-Fixture", value: channel.id }],
    }));
    const restored = normalizeConfigSnapshot({ config: { ...config, channels } }).config;
    for (const channel of channels) {
        const actual = restored.channels.find((candidate) => candidate.id === channel.id)!;
        expect(actual).toBeDefined();
        expect(actual.baseUrl).toBe(channel.baseUrl);
        expect(actual.apiKey).toBe(channel.apiKey);
        expect(actual.secretKey).toBe(channel.secretKey);
        expect(actual.headers).toEqual(channel.headers);
        expect(actual.models).toEqual(channel.models);
        expect(actual.modelProfiles).toEqual(channel.modelProfiles);
        expect(actual.interfaceType).toBe(channel.interfaceType);
    }
    expect(restored.channels.find((channel) => channel.id === "hanbao")?.models).toEqual(HANBAO_MODELS);
});
