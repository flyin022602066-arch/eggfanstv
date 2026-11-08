import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { normalizeConfigSnapshot, channelHasGenerationCredential, modelOptionsFromChannels, resolveModelRequestConfig } from "../src/stores/use-config-store";
import { HANBAO_MODELS } from "../src/lib/hanbao";
import { isFixedModelCatalogChannel } from "../src/lib/builtin-channels";

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
