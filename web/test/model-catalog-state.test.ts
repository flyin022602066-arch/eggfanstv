import { expect, test } from "bun:test";
import { catalogModelMapping, mergeFetchedChannelModelProfiles } from "../src/lib/channel-model-catalog";
import { modelProtocolCapability } from "../src/lib/model-protocols";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, selectableModelsByCapability } from "../src/stores/use-config-store";

test("text selection excludes media channels and non-conversation catalog models", () => {
    const channel = createModelChannel({ id: "beefapi", baseUrl: "https://api.eggfans.com", models: ["gpt-4o", "gpt-image-2", "gemini-nano-banana-2.1", "seedance-2.5", "sd-2.5-j2-V", "minimax-h3", "suno-v4", "gemini-embedding-001", "BAAI/bge-reranker-v2-m3"], modelProfiles: [{ model: "gpt-4o", capability: "image", protocol: "openai-image" }, { model: "gemini-embedding-001", capability: "text", protocol: "chat-completion" }] });
    const video = createModelChannel({ id: "jiasu-video", interfaceType: "jiasu-video", models: ["opaque-model"] });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel, video] } }).config;
    expect(selectableModelsByCapability(config, "text")).toEqual(["beefapi::gpt-4o"]);
    expect(selectableModelsByCapability(config, "image")).not.toContain("beefapi::gpt-4o");
    expect(selectableModelsByCapability(config, "video")).toContain("jiasu-video::opaque-model");
    expect(selectableModelsByCapability(config, "audio")).toContain("beefapi::suno-v4");
});

test("built-in protocol capabilities remain known before loading the plugin browser", () => {
    expect(modelProtocolCapability("openai-image")).toBe("image");
    expect(modelProtocolCapability("jiasu-video")).toBe("video");
    expect(modelProtocolCapability("async-audio")).toBe("audio");
    expect(modelProtocolCapability("chat-completion")).toBe("text");
    expect(modelProtocolCapability("custom-unknown")).toBeUndefined();
});

test("catalogs identify non-conversation models without assigning a chat protocol", () => {
    expect(catalogModelMapping({ id: "gemini-embedding-001", modelType: "text" }).skipGeneration).toBe(true);
    expect(catalogModelMapping({ id: "BAAI/bge-reranker-v2-m3" }).skipGeneration).toBe(true);
});

test("refreshing a partial catalog preserves profiles for returned model IDs", () => {
    const channel = createModelChannel({ id: "studio", models: ["custom-text", "custom-image"], modelProfiles: [{ model: "custom-text", capability: "text", protocol: "openai-response" }, { model: "custom-image", capability: "image", protocol: "openai-image" }] });
    const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "custom-text" }, { id: "custom-image" }]);
    expect(profiles).toEqual(channel.modelProfiles);
});

test("per-model capabilities override channel defaults and exclude Midjourney from text", () => {
    const channel = createModelChannel({ id: "studio", interfaceType: "chat-completion", models: ["custom-image"], modelProfiles: [{ model: "custom-image", capability: "image" }] });
    const eggfans = createModelChannel({ id: "beefapi", baseUrl: "https://api.eggfans.com", models: ["mj_imagine", "gemini-embedding2-preview", "gpt-4o"] });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel, eggfans] } }).config;
    expect(selectableModelsByCapability(config, "text")).toEqual(["beefapi::gpt-4o"]);
    expect(selectableModelsByCapability(config, "image")).toEqual(["studio::custom-image", "beefapi::mj_imagine"]);
});

test("fresh text metadata repairs a previously misclassified image protocol", () => {
    const channel = createModelChannel({ id: "beefapi", models: ["gpt-4o"], modelProfiles: [{ model: "gpt-4o", capability: "image", protocol: "openai-image" }] });
    const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "gpt-4o", modelType: "text" }]);
    expect(profiles).toEqual([{ model: "gpt-4o", capability: "text", protocol: "chat-completion", capabilityConfig: undefined }]);
});
