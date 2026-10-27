import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createJSONStorage } from "zustand/middleware";

import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { clampJiasuFaceRegion, isJiasuSdModel, jiasuFaceMaskCacheKey, normalizeJiasuFaceMaskMode } from "../src/lib/jiasu-face-mask";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function configFor(protocol = "jiasu-video", model = "dola-sd-2.5") {
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [createModelChannel({ id: "channel", interfaceType: protocol as never, apiKey: "synthetic-key", models: [model], modelProfiles: [{ model, protocol: protocol as never, capability: "video" }] })], model: `channel::${model}`, videoModel: `channel::${model}`, videoSeconds: "5", vquality: "720p", size: "16:9" } }).config;
}

describe("Jiasu local face masks", () => {
    test("keeps all three grid densities in settings, node retries and separate caches", () => {
        const regions = [{ id: "face", x: 0.1, y: 0.1, width: 0.3, height: 0.3 }];
        const keys = new Set<string>();
        for (const [mode, label] of [["grid", "50%"], ["grid-60", "60%"], ["grid-75", "75%"]] as const) {
            expect(normalizeJiasuFaceMaskMode(mode)).toBe(mode);
            const config = normalizeConfigSnapshot({ config: { ...configFor(), videoJiasuFaceMask: mode } }).config;
            expect(config.videoJiasuFaceMask).toBe(mode);
            const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} />);
            for (const density of ["50%", "60%", "75%"]) expect(html).toContain(density);
            expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${label}</button>`));
            const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { jiasuFaceMask: mode } };
            const built = buildGenerationConfig(configFor(), node, "video");
            expect(built.videoJiasuFaceMask).toBe(mode);
            expect(buildVideoGenerationMetadata(node, undefined, built).jiasuFaceMask).toBe(mode);
            keys.add(jiasuFaceMaskCacheKey("scope", "hash", mode, regions));
        }
        expect(keys.size).toBe(3);
        expect(normalizeJiasuFaceMaskMode(undefined)).toBe("grid");
    });

    test("only enables local face masking for Jiasu SD models", () => {
        for (const model of ["dola-sd-2.5", "channel::dola-sd-2.0", "sd-2.5-j2-V", "channel::sd-2.5-j2-V"]) expect(isJiasuSdModel("jiasu-video", model)).toBe(true);
        for (const [protocol, model] of [["jiasu-video", "minimax-h3"], ["eggfans-sd2-video", "sd-2.5-C"], ["eggfans-seedance-video", "dola-sd-2.5"]]) {
            expect(isJiasuSdModel(protocol, model)).toBe(false);
            const html = renderToStaticMarkup(<VideoSettingsPanel config={configFor(protocol, model)} theme={canvasThemes.light} onConfigChange={() => {}} />);
            expect(html).not.toContain("自动人脸遮罩");
        }
        const html = renderToStaticMarkup(<VideoSettingsPanel config={configFor()} theme={canvasThemes.light} onConfigChange={() => {}} />);
        expect(html).toContain('aria-checked="true" aria-label="自动人脸遮罩"');
    });

    test("J2-V uses the same local mask controls and node overrides without adding upstream fields", () => {
        for (const mode of ["grid", "grid-60", "grid-75", "mosaic"] as const) {
            const config = { ...configFor("jiasu-video", "sd-2.5-j2-V"), videoJiasuFaceMask: mode };
            const jiasuFaceMasks = { source: { sourceHash: "hash", regions: [{ id: "face", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] } };
            const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "J2-V", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { jiasuFaceMask: mode, jiasuFaceMasks } };
            const built = buildGenerationConfig(config, node, "video");
            expect(buildVideoGenerationMetadata(node, undefined, built)).toMatchObject({ jiasuFaceMask: mode, jiasuFaceMasks });
            const html = renderToStaticMarkup(<VideoSettingsPanel config={built} theme={canvasThemes.light} onConfigChange={() => {}} />);
            expect(html).toContain("自动人脸遮罩");
            if (mode !== "mosaic") for (const density of ["50%", "60%", "75%"]) expect(html).toContain(density);
            expect(backendProviderConfig(built, "video")).not.toHaveProperty("videoJiasuFaceMask");
            expect(backendProviderConfig(built, "video")).not.toHaveProperty("face");
        }
    });

    test("clamps reverse drags and edge regions, rejecting invalid coordinates", () => {
        expect(clampJiasuFaceRegion({ id: "face", x: 0.8, y: 0.9, width: -0.4, height: -0.5 })).toEqual({ id: "face", x: 0.4, y: 0.4, width: 0.4, height: 0.5 });
        expect(clampJiasuFaceRegion({ id: "face", x: -0.1, y: 0.8, width: 0.4, height: 0.5 })).toMatchObject({ x: 0, y: 0.8, width: 0.30000000000000004, height: 0.19999999999999996 });
        expect(() => clampJiasuFaceRegion({ id: "face", x: NaN, y: 0, width: 0.5, height: 0.5 })).toThrow("无效");
    });

    test("isolates cached derivatives by scope, original bytes, mask mode and adjusted geometry", () => {
        const regions = [{ id: "face", x: 0.1, y: 0.1, width: 0.3, height: 0.3 }];
        const key = jiasuFaceMaskCacheKey("user-a", "hash-one", "grid", regions);
        expect(jiasuFaceMaskCacheKey("user-b", "hash-one", "grid", regions)).not.toBe(key);
        expect(jiasuFaceMaskCacheKey("user-a", "hash-two", "grid", regions)).not.toBe(key);
        expect(jiasuFaceMaskCacheKey("user-a", "hash-one", "mosaic", regions)).not.toBe(key);
        expect(jiasuFaceMaskCacheKey("user-a", "hash-one", "grid", [{ ...regions[0], x: 0.2 }])).not.toBe(key);
    });

    test("retains per-node adjustments in retries and omits local mask options from upstream config", () => {
        const config = configFor();
        const jiasuFaceMasks = { source: { sourceHash: "hash", regions: [{ id: "face", x: 0, y: 0, width: 0.1, height: 0.2 }] } };
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { jiasuFaceMask: "mosaic", jiasuFaceMasks } };
        const built = buildGenerationConfig(config, node, "video");
        expect(built.videoJiasuFaceMask).toBe("mosaic");
        expect(buildVideoGenerationMetadata(node, undefined, built)).toHaveProperty("jiasuFaceMasks", jiasuFaceMasks);
        expect(backendProviderConfig(built, "video")).not.toHaveProperty("videoJiasuFaceMask");
        expect(buildVideoGenerationMetadata(node, undefined, configFor("jiasu-video", "minimax-h3"))).not.toHaveProperty("jiasuFaceMasks");
    });

    test("off bypasses detection and keeps original owned images without uploading", async () => {
        const config = { ...configFor(), videoJiasuFaceMask: "off" };
        const input = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [{ id: "source", name: "原图", type: "image/png", dataUrl: "", storageKey: "resource:original" }] });
        expect((input.input as { referenceImages: Array<{ storageKey: string }> }).referenceImages[0].storageKey).toBe("resource:original");
    });

    test("validates reference limits before detecting or saving images", async () => {
        const images = Array.from({ length: 31 }, (_, index) => ({ id: `image-${index}`, name: "原图", type: "image/png", dataUrl: "", storageKey: `resource:source-${index}` }));
        await expect(prepareBackendGenerationTask({ mode: "video", config: configFor(), prompt: "scene", referenceImages: images })).rejects.toThrow("30 张参考图");
    });

    test("restores the last mask mode and preserves node overrides after reload", async () => {
        const original = useConfigStore.getState();
        const storage = useConfigStore.persist.getOptions().storage;
        const values = new Map<string, string>();
        useConfigStore.persist.setOptions({ storage: createJSONStorage(() => ({ getItem: (key) => values.get(key) || null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } })) });
        try {
            for (const mode of ["grid", "grid-60", "grid-75", "mosaic", "off"]) {
                useConfigStore.getState().updateConfig("videoJiasuFaceMask", mode);
                const saved = new Map(values);
                useConfigStore.setState({ config: configFor() });
                for (const [key, value] of saved) values.set(key, value);
                await useConfigStore.persist.rehydrate();
                expect(useConfigStore.getState().config.videoJiasuFaceMask).toBe(mode);
            }
        } finally {
            useConfigStore.setState(original, true);
            useConfigStore.persist.setOptions({ storage });
        }
    });
});
