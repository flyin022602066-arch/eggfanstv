import { describe, expect, test } from "bun:test";
import React from "react";
import axios from "axios";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSettingsPanel } from "../src/components/image-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { mergeFetchedChannelModelProfiles } from "../src/lib/channel-model-catalog";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { imagePresetForRatio, imageSizePresets } from "../src/lib/image-size-presets";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { requestEdit, requestGeneration } from "../src/services/api/image";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability } from "../src/stores/use-config-store";

const model = "gemini-nano-banana-2.1";
function savedConfig() {
    const channel = createModelChannel({ id: "egg", name: "Eggfans TV", baseUrl: "https://api.eggfans.com", apiKey: "synthetic-test-key", models: [model, "gemini-3.8-flash"], modelProfiles: [{ model, capability: "text", protocol: "chat-completion" }, { model: "gemini-3.8-flash", capability: "text", protocol: "chat-completion" }] });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: `egg::${model}`, imageModel: `egg::${model}` } }).config;
}

describe("Gemini Nano Banana image integration", () => {
    test("sends the documented native JSON for generation and multiple reference edits", async () => {
        const original = axios.defaults.adapter;
        let received: Record<string, any> = {};
        let address = "";
        axios.defaults.adapter = async (request) => {
            received = JSON.parse(request.data);
            address = String(request.headers.get("X-Canvas-Upstream-URL") || request.url);
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "Zml4dHVyZQ==" } }] } }] } };
        };
        try {
            const config = { ...savedConfig(), quality: "4k", size: "1:8", count: "1", imageThinkingLevel: "high" };
            for (const baseUrl of ["https://api.eggfans.com", "https://api.eggfans.com/v1/", "https://api.eggfans.org/v1beta"]) {
                const current = { ...config, channels: config.channels.map((channel) => ({ ...channel, baseUrl })) };
                const result = await requestGeneration(current, "test fixture");
                expect(address).toBe(`${new URL(baseUrl).origin}/v1beta/models/${model}:generateContent`);
                expect(received.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:8", imageSize: "4K" }, thinkingConfig: { thinkingLevel: "high" } });
                expect(received).not.toHaveProperty("model");
                expect(received).not.toHaveProperty("size");
                expect(result).toHaveLength(1);
            }
            await requestEdit(config, "edit fixture", [
                { id: "one", name: "one.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2Ux" },
                { id: "two", name: "two.webp", type: "image/webp", dataUrl: "data:image/webp;base64,aW1hZ2Uy" },
            ]);
            const parts = received.contents[0].parts;
            expect(parts.filter((part: any) => part.inlineData).map((part: any) => part.inlineData)).toEqual([{ mimeType: "image/png", data: "aW1hZ2Ux" }, { mimeType: "image/webp", data: "aW1hZ2Uy" }]);
        } finally {
            axios.defaults.adapter = original;
        }
    });
    test("repairs stored text classification without fetching or losing credentials", () => {
        const config = savedConfig();
        expect(selectableModelsByCapability(config, "image")).toEqual([`egg::${model}`]);
        expect(selectableModelsByCapability(config, "text")).toEqual(["egg::gemini-3.8-flash"]);
        expect(config.channels[0]?.apiKey).toBe("synthetic-test-key");
        expect(resolveModelRequestConfig(config, `egg::${model}`)).toMatchObject({ interfaceType: "gemini-image", apiFormat: "gemini", baseUrl: "https://api.eggfans.com" });
        expect(mergeFetchedChannelModelProfiles(config.channels[0]!, [{ id: model, modelType: "text" }])[0]).toMatchObject({ capability: "image", protocol: "gemini-image" });
    });

    test("offers all documented ratios and resolutions without relaxing OpenAI custom limits", () => {
        const profile = defaultImageCapabilityConfig("gemini-image", model);
        expect(profile.quality.values).toEqual(["1k", "2k", "4k"]);
        expect(profile.size.values).toHaveLength(15);
        expect(imageSizePresets(profile).filter((item) => item.tier === "4k").map((item) => item.ratio)).toEqual(expect.arrayContaining(["1:8", "8:1", "1:4", "4:1", "4:5", "5:4"]));
        expect(profile.references.maskSupported).toBe(false);
        expect(() => imagePresetForRatio("4k", "8:1")).toThrow();
    });

    test("shows model-specific thinking and forwards only to its image protocol", () => {
        const config = { ...savedConfig(), imageThinkingLevel: "high", quality: "4k", size: "1:8" };
        const html = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
        expect(html).toContain("思考强度");
        expect(html).toContain("快速");
        expect(html).toContain("深入");
        expect(backendProviderConfig(config)).toMatchObject({ imageThinkingLevel: "high", quality: "4k", size: "1:8", interfaceType: "gemini-image" });
        expect(backendProviderConfig({ ...config, model: "egg::gemini-3.8-flash" }, "text")).not.toHaveProperty("imageThinkingLevel");
    });
});
