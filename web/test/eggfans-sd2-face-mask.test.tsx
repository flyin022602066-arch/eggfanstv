import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createJSONStorage } from "zustand/middleware";

import { TowoVideoReferenceSettings, VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { isEggfansSd2DModel, isTowoSd25Model, normalizeSd2FaceMaskMode, usesTowoLocalFaceMask } from "../src/lib/eggfans-sd2-face-mask";
import { jiasuFaceMaskCacheKey } from "../src/lib/jiasu-face-mask";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, useConfigStore } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function configFor(protocol = "eggfans-sd2-video", model = "sd-2.5-D") {
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [createModelChannel({ id: "channel", interfaceType: protocol as never, apiKey: "synthetic-key", models: [model], modelProfiles: [{ model, protocol: protocol as never, capability: "video" }] })], model: `channel::${model}`, videoModel: `channel::${model}`, videoSeconds: "5", vquality: "720p", size: "16:9", videoNativeFace: "true" } }).config;
}

describe("SD2 D local face masks", () => {
    test("keeps each D grid density independently of Jiasu and native face settings", () => {
        for (const mode of ["grid", "grid-60", "grid-75"] as const) {
            expect(normalizeSd2FaceMaskMode(mode)).toBe(mode);
            const config = normalizeConfigSnapshot({ config: { ...configFor(), videoSd2FaceMask: mode, videoJiasuFaceMask: "mosaic" } }).config;
            expect(config.videoSd2FaceMask).toBe(mode);
            expect(config.videoJiasuFaceMask).toBe("mosaic");
            const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
            for (const density of ["50%", "60%", "75%"]) expect(html).toContain(density);
            const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { sd2FaceMask: mode, jiasuFaceMask: "grid" } };
            const built = buildGenerationConfig(configFor(), node, "video");
            expect(built.videoSd2FaceMask).toBe(mode);
            const metadata = buildVideoGenerationMetadata(node, undefined, built);
            expect(metadata.sd2FaceMask).toBe(mode);
            expect(metadata).not.toHaveProperty("jiasuFaceMask");
            expect(backendProviderConfig(built, "video").face).toBe(true);
        }
    });

    test("exposes local masking only for the SD2 D channel/model pair", () => {
        expect(isEggfansSd2DModel("eggfans-sd2-video", "channel::sd-2.5-D")).toBe(true);
        for (const [protocol, model] of [["eggfans-sd2-video", "sd-2.5-C"], ["jiasu-video", "sd-2.5-D"], ["eggfans-seedance-video", "sd-2.5-D"]]) {
            expect(isEggfansSd2DModel(protocol, model)).toBe(false);
            const html = renderToStaticMarkup(<VideoSettingsPanel config={configFor(protocol, model)} theme={canvasThemes.light} onConfigChange={() => {}} />);
            expect(html).not.toContain("自动人脸遮罩");
        }
        for (const theme of Object.values(canvasThemes)) {
            const html = renderToStaticMarkup(<VideoSettingsPanel config={{ ...configFor(), videoSd2FaceMask: "grid" }} theme={theme} onConfigChange={() => {}} />);
            expect(html).toContain('aria-checked="true" aria-label="自动人脸遮罩"');
            expect(html).toContain('aria-checked="true" aria-label="过人脸"');
        }
    });

    test("local masking does not override the native face preference sent to the backend", () => {
        const config = { ...configFor(), videoSd2FaceMask: "grid" };
        expect(backendProviderConfig(config, "video").face).toBe(true);
        expect(config.videoNativeFace).toBe("true");
        expect(backendProviderConfig({ ...config, videoSd2FaceMask: "off" }, "video").face).toBe(true);
        expect(backendProviderConfig({ ...config, videoNativeFace: "false" }, "video").face).toBe(false);
        expect(backendProviderConfig(config, "image")).not.toHaveProperty("videoNativeFace");
        expect(backendProviderConfig({ ...configFor("eggfans-sd2-video", "sd-2.5-C"), videoSd2FaceMask: "grid" }, "video").face).toBe(true);
        expect(backendProviderConfig(config, "video")).not.toHaveProperty("videoSd2FaceMask");
    });

    test("preserves D overrides for retries while isolating Jiasu metadata and cached resources", () => {
        const regions = [{ id: "face", x: 0.1, y: 0.1, width: 0.3, height: 0.3 }];
        const sd2FaceMasks = { source: { sourceHash: "hash", regions } };
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { sd2FaceMask: "grid", sd2FaceMasks, jiasuFaceMask: "mosaic", jiasuFaceMasks: { other: { sourceHash: "other", regions: [] } } } };
        const config = buildGenerationConfig(configFor(), node, "video");
        expect(config.videoSd2FaceMask).toBe("grid");
        const metadata = buildVideoGenerationMetadata(node, undefined, config);
        expect(metadata).toHaveProperty("sd2FaceMasks", sd2FaceMasks);
        expect(metadata).not.toHaveProperty("jiasuFaceMasks");
        for (const config of [configFor("jiasu-video", "dola-sd-2.5"), configFor("eggfans-sd2-video", "sd-2.5-C")]) {
            expect(buildVideoGenerationMetadata(node, undefined, config)).not.toHaveProperty("sd2FaceMasks");
        }
        expect(jiasuFaceMaskCacheKey("scope", "hash", "grid", regions, "eggfans-sd2")).not.toBe(jiasuFaceMaskCacheKey("scope", "hash", "grid", regions));
    });

    test("off bypasses processing and excessive references fail before image detection or upload", async () => {
        const config = configFor();
        const image = { id: "source", name: "原图", type: "image/png", dataUrl: "", storageKey: "resource:original" };
        const input = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [image] });
        expect((input.input as { referenceImages: Array<{ storageKey: string }> }).referenceImages[0].storageKey).toBe("resource:original");
        const images = Array.from({ length: 10 }, (_, index) => ({ ...image, id: `image-${index}` }));
        await expect(prepareBackendGenerationTask({ mode: "video", config: { ...config, videoSd2FaceMask: "grid" }, prompt: "scene", referenceImages: images })).rejects.toThrow("9 张参考图");
    });

    test("persists D settings independently and leaves older config snapshots off", async () => {
        expect(defaultConfig.videoSd2FaceMask).toBe("off");
        expect(normalizeConfigSnapshot({ config: { ...configFor(), videoSd2FaceMask: undefined } }).config.videoSd2FaceMask).toBe("off");
        const original = useConfigStore.getState();
        const storage = useConfigStore.persist.getOptions().storage;
        const values = new Map<string, string>();
        useConfigStore.persist.setOptions({ storage: createJSONStorage(() => ({ getItem: (key) => values.get(key) || null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } })) });
        try {
            useConfigStore.setState({ config: { ...configFor(), videoJiasuFaceMask: "mosaic" } });
            for (const mode of ["grid", "grid-60", "grid-75", "mosaic", "off"]) {
                useConfigStore.getState().updateConfig("videoSd2FaceMask", mode);
                const saved = new Map(values);
                useConfigStore.setState({ config: configFor() });
                for (const [key, value] of saved) values.set(key, value);
                await useConfigStore.persist.rehydrate();
                expect(useConfigStore.getState().config.videoSd2FaceMask).toBe(mode);
                expect(useConfigStore.getState().config.videoJiasuFaceMask).toBe("mosaic");
            }
        } finally {
            useConfigStore.setState(original, true);
            useConfigStore.persist.setOptions({ storage });
        }
    });
});

describe("Towo Seedance 2.5 local face masks", () => {
    test("off preserves the original owned reference without requiring face processing", async () => {
        const config = { ...configFor("towo-sd25-video", "seedance-2.5"), videoSd2FaceMask: "off" };
        const image = { id: "original", name: "原图", type: "image/png", dataUrl: "", storageKey: "resource:towo-original" };
        const prepared = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [image] });
        const input = prepared.input as { config: Record<string, unknown>; referenceImages: Array<{ storageKey: string }> };

        expect(input.referenceImages[0]?.storageKey).toBe("resource:towo-original");
        expect(input.config.interfaceType).toBe("towo-sd25-video");
        expect(input.config).not.toHaveProperty("face");
        expect(input.config).not.toHaveProperty("nativeFace");
    });

    test("shows the Towo face-mask controls in the workflow settings surface", () => {
        const html = renderToStaticMarkup(<TowoVideoReferenceSettings config={{ ...configFor("towo-sd25-video", "seedance-2.5"), videoSd2FaceMask: "grid" }} theme={canvasThemes.dark} onConfigChange={() => {}} />);

        expect(html).toContain("人脸处理");
        expect(html).toContain('aria-label="自动人脸遮罩"');
        expect(html).toContain('aria-label="网格密度"');
        expect(html).toContain("50%");
        expect(html).toContain("60%");
        expect(html).toContain("75%");
        expect(html).toContain("上传 Uguu");
    });

    test("shows local masking without exposing an undocumented native face option", () => {
        const config = configFor("towo-sd25-video", "seedance-2.5");
        expect(config.channels[0]?.baseUrl).toBe("https://towoapi.com");
        expect(resolveModelRequestConfig(config, config.model).interfaceType).toBe("towo-sd25-video");
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
        expect(isTowoSd25Model("towo-sd25-video", "channel::seedance-2.5")).toBe(true);
        expect(isTowoSd25Model("eggfans-sd2-video", "seedance-2.5")).toBe(false);
        expect(usesTowoLocalFaceMask("towo-sd25-video", "seedance-2.5", "grid-75")).toBe(true);
        expect(usesTowoLocalFaceMask("towo-sd25-video", "seedance-2.5", "off")).toBe(false);
        expect(html).toContain("自动人脸遮罩");
        expect(html).toContain("Towo 不发送 native_face");
        expect(html).not.toContain('aria-label="过人脸"');
        expect(backendProviderConfig(config, "video")).not.toHaveProperty("face");
        expect(backendProviderConfig(config, "video")).not.toHaveProperty("nativeFace");
    });

    test("recognizes legacy Towo channels that only saved the domain and model", () => {
        const config = normalizeConfigSnapshot({ config: {
            ...defaultConfig,
            channels: [createModelChannel({
                id: "legacy-towo",
                name: "Towo",
                baseUrl: "https://towoapi.com",
                apiKey: "synthetic-key",
                models: ["seedance-2.5"],
                modelProfiles: [{ model: "seedance-2.5", capability: "video" }],
            })],
            model: "legacy-towo::seedance-2.5",
            videoModel: "legacy-towo::seedance-2.5",
        } }).config;

        expect(resolveModelRequestConfig(config, config.model).interfaceType).toBe("towo-sd25-video");
        expect(renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />)).toContain("自动人脸遮罩");
    });

    test("persists Towo mask mode and overrides separately from EggFans SD2", () => {
        const towoFaceMasks = { source: { sourceHash: "towo-hash", regions: [{ id: "face", x: 0.1, y: 0.1, width: 0.3, height: 0.3 }] } };
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Towo", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { towoFaceMask: "grid-75", towoFaceMasks, sd2FaceMask: "mosaic", sd2FaceMasks: { other: { sourceHash: "sd2-hash", regions: [] } } } };
        const config = configFor("towo-sd25-video", "seedance-2.5");
        expect(resolveModelRequestConfig(config, config.model).interfaceType).toBe("towo-sd25-video");
        const built = buildGenerationConfig(config, node, "video");
        expect(built.videoSd2FaceMask).toBe("grid-75");
        const metadata = buildVideoGenerationMetadata(node, undefined, built);
        expect(metadata).toMatchObject({ towoFaceMask: "grid-75", towoFaceMasks });
        expect(metadata).not.toHaveProperty("sd2FaceMasks");
        expect(backendProviderConfig(built, "video")).not.toHaveProperty("face");
    });
});
