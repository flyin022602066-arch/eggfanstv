import { expect, test } from "bun:test";
import { mergeFetchedChannelModelProfiles } from "../src/lib/channel-model-catalog";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";

test("Gway catalog parameters survive model inference, persistence and resolution", () => {
    const model = "seedance-2.5-g5-v3";
    const video = defaultModelCapabilityConfig("jiasu-video", model).video!;
    video.duration = { selection: "range", min: 4, max: 30, step: 1, default: 30 };
    video.resolutions = ["480p", "720p"];
    video.defaultResolution = "720p";
    video.references.maxImages = 10;
    video.references.maxVideos = 0;
    video.references.maxAudios = 5;
    const channel = createModelChannel({ id: "gway-native", interfaceType: "jiasu-video", models: [model] });
    const modelProfiles = mergeFetchedChannelModelProfiles(channel, [{ id: model, modelType: "video", supportedEndpointTypes: ["openai-video"], videoCapabilities: video, videoCapabilitiesVersion: "gway-api-parameters-v1" }]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [{ ...channel, modelProfiles }] } }).config;
    const actual = modelCapabilityConfigFor(config, `gway-native::${model}`).video!;
    expect(actual.duration).toEqual(video.duration);
    expect(actual.resolutions).toEqual(["480p", "720p"]);
    expect(actual.references).toMatchObject({ maxImages: 10, maxVideos: 0, maxAudios: 5 });
    expect(resolveModelRequestConfig(config, `gway-native::${model}`).interfaceType).toBe("jiasu-video");
});

test("Gway H3 no longer forces the obsolete 15s and 2k options", () => {
    const video = defaultModelCapabilityConfig("jiasu-video", "minimax-h3").video!;
    expect(video.duration).toMatchObject({ selection: "range", min: 4, max: 30 });
    expect(video.resolutions).toEqual(["768p"]);
});
