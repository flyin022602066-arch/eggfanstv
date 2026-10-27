import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { fetchChannelModels } from "../src/services/api/image";
import { mergeFetchedChannelModelProfiles } from "../src/lib/channel-model-catalog";
import { applyFetchedChannelModelCatalog } from "../src/pages/settings/channel-settings-pane";
import { modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability } from "../src/stores/use-config-store";

const originalAxiosRequest = axios.request;

afterEach(() => {
    axios.request = originalAxiosRequest;
});

describe("Jiasu model catalog", () => {
    test("resolves the pricing page to its JSON API and lists video models only", async () => {
        let requestUrl = "";
        let upstreamUrl = "";
        axios.request = (async (request) => {
            requestUrl = String(request.url || "");
            const headers = request.headers as { get?: (name: string) => string | undefined; [key: string]: unknown };
            upstreamUrl = headers.get?.("X-Canvas-Upstream-URL") || String(headers["x-canvas-upstream-url"] || headers["X-Canvas-Upstream-URL"] || "");
            return {
                data: {
                    success: true,
                    data: [
                        { model_name: "sd-2.5-J2", supported_endpoint_types: ["openai-video"] },
                        { model_name: "sd-2.5-j2-V", supported_endpoint_types: ["openai-video"] },
                        { model_name: "sd-2.5-J3-doubao", supported_endpoint_types: ["openai-video"] },
                        { model_name: "gpt-image-2-4k", supported_endpoint_types: ["image-generation"] },
                        { model_name: "minimax-h3", supported_endpoint_types: ["openai-video"], quota_type: 2, model_price: 0.05 },
                    ],
                },
            };
        }) as typeof axios.request;

        const channel = createModelChannel({
            id: "jiasu-video",
            name: "佳速视频",
            baseUrl: "https://www.gway.dev",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            interfaceType: "jiasu-video",
            presetVersion: 2,
            models: ["dola-sd-2.5"],
        });

        const result = await fetchChannelModels(channel);

        expect(channel.catalogUrl).toBe("https://www.gway.dev/pricing");
        expect(requestUrl).toBe("/api/ai/custom");
        expect(upstreamUrl).toBe("https://www.gway.dev/api/pricing?surface=plaza");
        expect(result.models).toEqual(expect.arrayContaining(["minimax-h3", "sd-2.5-J2", "sd-2.5-j2-V"]));
        expect(result.models).toHaveLength(4);
        expect(result.catalog.map((item) => item.id)).toEqual(result.models);
        expect(result.catalog.every((item) => item.modelType === "video")).toBe(true);
        expect(result.catalog.find((item) => item.id === "minimax-h3")?.videoBilling?.unit).toBe("per_second");
        expect(result.catalog.find((item) => item.id === "minimax-h3")?.videoBilling?.tiers[0]?.price_per_second).toBe(0.05);
        const saved = applyFetchedChannelModelCatalog({ ...channel, models: ["dola-sd-2.5", "sd-2.5-J2"] }, result);
        expect(saved.models).toEqual(result.models);
        expect(saved.presetVersion).toBe(3);
        expect(saved.modelProfiles?.map((profile) => profile.model)).toEqual(result.models);
        const modelProfiles = mergeFetchedChannelModelProfiles(channel, result.catalog);
        expect(modelProfiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ model: "sd-2.5-J2", capability: "video", protocol: "jiasu-video" }),
            expect.objectContaining({ model: "sd-2.5-j2-V", capability: "video", protocol: "jiasu-video" }),
            expect.objectContaining({ model: "minimax-h3", capability: "video", protocol: "jiasu-video" }),
        ]));
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [{ ...channel, models: result.models, modelProfiles }] } }).config;
        expect(selectableModelsByCapability(config, "video")).toContain("jiasu-video::sd-2.5-J2");
        expect(resolveModelRequestConfig(config, "jiasu-video::sd-2.5-J2").interfaceType).toBe("jiasu-video");
        expect(modelCapabilityConfigFor(config, "jiasu-video::sd-2.5-j2-V").video!.references).toMatchObject({ maxImages: 30, maxVideos: 10, maxAudios: 10 });
        const j3 = modelCapabilityConfigFor(config, "jiasu-video::sd-2.5-J3-doubao").video!;
        expect(j3.duration).toMatchObject({ min: 4, max: 30 });
        expect(j3.resolutions).toEqual(["720p", "1080p"]);
        expect(j3.defaultResolution).toBe("720p");
    });

    test("migrates the legacy Jiasu URL without changing the video protocol", () => {
        const channel = createModelChannel({
            id: "jiasu-video",
            name: "佳速视频",
            baseUrl: "https://ai.jiasuapi.com",
            catalogUrl: "https://ai.jiasuapi.com/pricing",
            apiFormat: "openai",
            interfaceType: "jiasu-video",
            apiKey: "preserved-key",
        });

        expect(channel.baseUrl).toBe("https://www.gway.dev");
        expect(channel.catalogUrl).toBe("https://www.gway.dev/pricing");
        expect(channel.apiKey).toBe("preserved-key");
        expect(channel.interfaceType).toBe("jiasu-video");
    });

    test("keeps unrelated channels and custom Jiasu endpoints unchanged", () => {
        const eggfans = createModelChannel({ id: "beefapi", baseUrl: "https://api.eggfans.com", apiKey: "preserved-key" });
        const sd2 = createModelChannel({ id: "eggfans-sd2", interfaceType: "eggfans-sd2-video", baseUrl: "https://vip.eggfans.asia" });
        const custom = createModelChannel({ id: "custom", interfaceType: "jiasu-video", baseUrl: "https://custom.example.com", catalogUrl: "https://custom.example.com/catalog" });
        expect(eggfans.baseUrl).toBe("https://api.eggfans.com");
        expect(eggfans.apiKey).toBe("preserved-key");
        expect(sd2.baseUrl).toBe("https://vip.eggfans.asia");
        expect(custom.baseUrl).toBe("https://custom.example.com");
        expect(custom.catalogUrl).toBe("https://custom.example.com/catalog");
    });

    test("keeps the selected channel when a retired model disappears from the refreshed catalog", () => {
        const channel = createModelChannel({ id: "jiasu-video", interfaceType: "jiasu-video", models: ["minimax-h3", "seedance2.5"] });
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, videoModel: "jiasu-video::retired-model", channels: [channel] } }).config;
        expect(config.videoModel.startsWith("jiasu-video::")).toBe(true);
        expect(config.videoModel).not.toBe("jiasu-video::retired-model");
    });
});
