import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { applyFetchedChannelModelCatalog, withChannels } from "../src/pages/settings/channel-settings-pane";
import { BUILTIN_CHANNEL_SEEDS } from "../src/lib/builtin-channels";
import { modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, modelDisplayName, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability } from "../src/stores/use-config-store";
import { fetchChannelModels } from "../src/services/api/image";
import { apiClient } from "../src/services/api/request";

const originalRequest = apiClient.request;
afterEach(() => { apiClient.request = originalRequest; });

test("deleted frontend seeds stay removed across restart and explicit re-add works", () => {
    const initial = normalizeConfigSnapshot({ config: {} }).config;
    const seed = BUILTIN_CHANNEL_SEEDS[0]!;
    const deleted = withChannels(initial, initial.channels.filter((item) => item.id !== seed.id));
    const restored = normalizeConfigSnapshot(JSON.parse(JSON.stringify({ config: deleted }))).config;
    expect(restored.channels.some((item) => item.id === seed.id)).toBe(false);
    expect(restored.deletedChannelIds).toContain(seed.id);
    const readded = withChannels(restored, [...restored.channels, createModelChannel(seed)]);
    const reopened = normalizeConfigSnapshot({ config: readded }).config;
    expect(reopened.deletedChannelIds).not.toContain(seed.id);
    expect(reopened.channels.some((item) => item.id === seed.id)).toBe(true);
});

test("Kanhai refresh is video-only and replaces stale prices without changing another provider", async () => {
    const preset = JSON.parse(readFileSync(new URL("../../backend/internal/providerpreset/catalog/kanhai-video.v1.json", import.meta.url), "utf8"));
    const catalog = preset.models.map((profile: Record<string, any>) => ({ id: profile.model, displayName: profile.displayName, modelType: "video", supportedEndpointTypes: ["kanhai-video"], videoCapabilities: profile.capabilityConfig.video, videoCapabilitiesVersion: "kanhai-v1" }));
    const channel = createModelChannel({ id: "kanhai-video", name: "看海视频", baseUrl: preset.baseUrl, apiKey: "synthetic-key", interfaceType: "kanhai-video", models: ["obsolete"], modelProfiles: [{ model: "obsolete", capability: "video", protocol: "kanhai-video" }] });
    apiClient.request = (async (request) => {
        expect(request.url).toBe("/ai/models");
        expect(request.data).toMatchObject({ baseUrl: "https://yioapp.top/openapi/v1", apiKey: "synthetic-key" });
        return { status: 200, data: { code: 0, data: { models: [...catalog, { id: "image-must-not-appear", modelType: "image" }] }, msg: "" } };
    }) as typeof apiClient.request;
    const fetched = await fetchChannelModels(channel);
    expect(fetched.models).toHaveLength(53);
    expect(fetched.models).not.toContain("image-must-not-appear");
    const refreshed = applyFetchedChannelModelCatalog(channel, fetched);
    expect(refreshed.models).not.toContain("obsolete");
    const unrelated = createModelChannel({ id: "other-provider", name: "Other", baseUrl: "https://example.com", models: ["sd-2.5"], interfaceType: "jiasu-video" });
    const normalized = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [refreshed, unrelated] } }).config;
    const resolved = resolveModelRequestConfig(normalized, "kanhai-video::chaomeng-video-88b0bf9d5c3f");
    expect(resolved.interfaceType).toBe("kanhai-video");
    const capability = modelCapabilityConfigFor(normalized, "kanhai-video::chaomeng-video-88b0bf9d5c3f");
    expect(capability.video?.duration.values).toContain(30);
    expect(capability.video?.references).toMatchObject({ maxImages: 9, maxVideos: 0, maxAudios: 3 });
    expect(modelDisplayName(normalized, "kanhai-video::DB-SD-2.5")).toContain("40积分/条");
    expect(modelDisplayName(normalized, "kanhai-video::DB-SD-2.5")).toContain("不卡人脸");
    expect(selectableModelsByCapability(normalized, "image").some((model) => model.startsWith("kanhai-video::"))).toBe(false);
    expect(resolveModelRequestConfig(normalized, "other-provider::sd-2.5").interfaceType).toBe("jiasu-video");
    const newCatalog = fetched.catalog.map((item) => item.id === "DB-SD-2.5" ? { ...item, displayName: "DB-SD-2.5 · 本账号 35积分/条" } : item);
    const repriced = applyFetchedChannelModelCatalog(refreshed, { models: fetched.models, catalog: newCatalog });
    expect(repriced.modelProfiles?.find((profile) => profile.model === "DB-SD-2.5")?.displayName).toContain("35积分/条");
});
