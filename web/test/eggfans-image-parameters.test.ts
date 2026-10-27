import { describe, expect, test } from "bun:test";
import axios from "axios";

import { requestEdit, requestGeneration } from "../src/services/api/image";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "../src/stores/use-config-store";

function imageConfig(baseUrl: string, model: string): AiConfig {
    return normalizeConfigSnapshot({ config: {
        ...defaultConfig,
        channels: [createModelChannel({ id: "image-fixture", baseUrl, apiKey: "synthetic-image-key", interfaceType: "openai-image", models: [model], modelProfiles: [{ model, capability: "image", protocol: "openai-image" }] })],
        model: `image-fixture::${model}`,
        imageModel: `image-fixture::${model}`,
        size: "3840x2160",
        quality: "high",
        count: "1",
    } }).config;
}

describe("Eggfans image parameters", () => {
    test("generation uses the documented format field without changing 4K size or quality", async () => {
        const original = axios.defaults.adapter;
        let received: Record<string, unknown> = {};
        axios.defaults.adapter = async (request) => {
            received = JSON.parse(request.data);
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { data: [{ b64_json: "fixture" }] } };
        };
        try {
            for (const baseUrl of ["https://api.eggfans.com", "https://api.eggfans.org/v1/"]) {
                for (const model of ["gpt-image-2", "gpt-image-2-c", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst-c"]) {
                    await requestGeneration(imageConfig(baseUrl, model), "local fixture");
                    expect(received).toMatchObject({ model, prompt: "local fixture", n: 1, size: "3840x2160", quality: "high", format: "png", moderation: "low" });
                    expect(received).not.toHaveProperty("output_format");
                }
            }
            for (const [baseUrl, model] of [
                ["https://api.openai.com", "gpt-image-2"],
                ["https://api.eggfans.com.example.org", "gpt-image-2"],
                ["https://api.eggfans.com", "gpt-image-1"],
                ["https://api.eggfans.com", "gpt-image-20"],
            ]) {
                await requestGeneration(imageConfig(baseUrl, model), "local fixture");
                expect(received.output_format).toBe("png");
                expect(received).not.toHaveProperty("format");
                expect(received).not.toHaveProperty("moderation");
            }
        } finally {
            axios.defaults.adapter = original;
        }
    });

    test("editing retains multipart source and mask files and the requested resolution", async () => {
        const original = axios.defaults.adapter;
        let received: FormData | undefined;
        axios.defaults.adapter = async (request) => {
            received = request.data;
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { data: [{ b64_json: "fixture" }] } };
        };
        try {
            const image = { id: "image", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
            const mask = { ...image, id: "mask", name: "mask.png", dataUrl: "data:image/png;base64,bWFzaw==" };
            for (const baseUrl of ["https://api.eggfans.com", "https://api.eggfans.org/v1/"]) {
                for (const model of ["gpt-image-2", "gpt-image-2-all", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst-c"]) {
                    for (const editMask of [undefined, mask]) {
                        await requestEdit(imageConfig(baseUrl, model), "edit fixture", [image], editMask);
                        expect(received).toBeInstanceOf(FormData);
                        expect(received!.get("moderation")).toBe("low");
                        expect(received!.get("size")).toBe("3840x2160");
                        expect(received!.get("quality")).toBe("high");
                        expect(received!.get("image")).toBeInstanceOf(File);
                        expect(received!.get("mask") instanceof File).toBe(Boolean(editMask));
                        expect(received!.get("format")).toBeNull();
                    }
                }
            }
            for (const [baseUrl, model] of [["https://api.openai.com", "gpt-image-2"], ["https://api.eggfans.com", "gpt-image-1"]]) {
                await requestEdit(imageConfig(baseUrl, model), "edit fixture", [image]);
                expect(received!.get("moderation")).toBeNull();
            }
        } finally {
            axios.defaults.adapter = original;
        }
    });
});
