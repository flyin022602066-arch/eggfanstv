import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createJSONStorage } from "zustand/middleware";

import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function sd2Config(nativeFace = "false"): AiConfig {
    return normalizeConfigSnapshot({ config: {
        ...defaultConfig,
        channels: [createModelChannel({ id: "sd2", interfaceType: "eggfans-sd2-video", baseUrl: "https://example.com", apiKey: "synthetic-test-key", models: ["sd-2.5-C"], modelProfiles: [{ model: "sd-2.5-C", capability: "video", protocol: "eggfans-sd2-video" }] })],
        model: "sd2::sd-2.5-C",
        videoModel: "sd2::sd-2.5-C",
        videoNativeFace: nativeFace,
    } }).config;
}

describe("SD2 native face configuration", () => {
    test("defaults off and restores the last value from persisted Zustand storage", async () => {
        expect(defaultConfig.videoNativeFace).toBe("false");
        const originalState = useConfigStore.getState();
        const originalStorage = useConfigStore.persist.getOptions().storage;
        const snapshots = new Map<string, string>();
        useConfigStore.persist.setOptions({ storage: createJSONStorage(() => ({
            getItem: (key) => snapshots.get(key) ?? null,
            setItem: (key, value) => { snapshots.set(key, value); },
            removeItem: (key) => { snapshots.delete(key); },
        })) });
        try {
            for (const enabled of [true, false]) {
                useConfigStore.getState().updateConfig("videoNativeFace", String(enabled));
                const saved = new Map(snapshots);
                useConfigStore.setState({ config: sd2Config(String(!enabled)) });
                for (const [key, value] of saved) snapshots.set(key, value);
                await useConfigStore.persist.rehydrate();
                expect(useConfigStore.getState().config.videoNativeFace).toBe(String(enabled));
            }
        } finally {
            useConfigStore.setState(originalState, true);
            useConfigStore.persist.setOptions({ storage: originalStorage });
        }
    });

    test("uses the saved default for new nodes and keeps each node's explicit override", () => {
        const config = sd2Config("true");
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { nativeFace: "false" } };
        expect(buildGenerationConfig(config, undefined, "video").videoNativeFace).toBe("true");
        const overridden = buildGenerationConfig(config, node, "video");
        expect(overridden.videoNativeFace).toBe("false");
        expect(backendProviderConfig(overridden, "video")).toHaveProperty("face", false);
        expect(backendProviderConfig(buildGenerationConfig(config, { ...node, metadata: { nativeFace: "true" } }, "video"), "video")).toHaveProperty("face", true);
    });

    test("omits the option from unrelated channels and other generation modes", () => {
        const config = sd2Config("true");
        expect(backendProviderConfig(config, "image")).not.toHaveProperty("videoNativeFace");
        expect(backendProviderConfig(config, "image")).not.toHaveProperty("face");
        const seedance = normalizeConfigSnapshot({ config: { ...config, channels: [createModelChannel({ id: "other", interfaceType: "eggfans-seedance-video", baseUrl: "https://api.eggfans.com", models: ["doubao-seedance-2-5"], modelProfiles: [{ model: "doubao-seedance-2-5", capability: "video", protocol: "eggfans-seedance-video" }] })], model: "other::doubao-seedance-2-5", videoModel: "other::doubao-seedance-2-5" } }).config;
        expect(backendProviderConfig(seedance, "video")).not.toHaveProperty("videoNativeFace");
        expect(backendProviderConfig(seedance, "video")).not.toHaveProperty("face");
    });

    test("renders a labelled SD2 toggle in both themes with the stored checked state", () => {
        for (const theme of Object.values(canvasThemes)) {
            for (const enabled of [true, false]) {
                const html = renderToStaticMarkup(<VideoSettingsPanel config={sd2Config(String(enabled))} theme={theme} onConfigChange={() => {}} />);
                expect(html).toContain("过人脸");
                expect(html).toContain(`aria-checked="${enabled}" aria-label="过人脸"`);
            }
        }
    });

    test("hides the toggle for other video channels", () => {
        const config = normalizeConfigSnapshot({ config: { ...defaultConfig, videoNativeFace: "true", channels: [createModelChannel({ id: "other", interfaceType: "xai-video", models: ["grok-imagine-video"], modelProfiles: [{ model: "grok-imagine-video", capability: "video", protocol: "xai-video" }] })], model: "other::grok-imagine-video", videoModel: "other::grok-imagine-video" } }).config;
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={Object.values(canvasThemes)[0]} onConfigChange={() => {}} />);
        expect(html).not.toContain("过人脸");
    });

    test("enables native face for every SD2 model without clearing preference", () => {
        for (const model of ["sd-2.5-A", "sd-2.5-B", "sd-2.5-C", "sd-2.5-D", "sd-2.5-E"]) {
            const base = sd2Config("true");
            const config = normalizeConfigSnapshot({ config: { ...base, channels: [createModelChannel({ ...base.channels[0], models: [model], modelProfiles: [{ model, capability: "video", protocol: "eggfans-sd2-video" }] })], model: `sd2::${model}`, videoModel: `sd2::${model}` } }).config;
            const payload = backendProviderConfig(config, "video");
            expect(payload.face).toBe(true);
            expect(payload).not.toHaveProperty("videoNativeFace");
            for (const theme of Object.values(canvasThemes)) {
                const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={theme} onConfigChange={() => {}} />);
                expect(html).toContain('aria-checked="true" aria-label="过人脸"');
                expect(html).not.toContain("当前模型不提交此参数");
                const switchHtml = html.match(/<button[^>]*role="switch"[^>]*aria-label="过人脸"[^>]*>/)?.[0];
                expect(switchHtml).toBeDefined();
                expect(switchHtml).not.toContain('disabled=""');
            }
            expect(config.videoNativeFace).toBe("true");
        }
    });
});
