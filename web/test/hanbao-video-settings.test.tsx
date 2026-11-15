import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig, hasAutomaticVideoAudio, modelCapabilityConfigFor } from "../src/lib/model-capabilities";
import { resolveModelVideoBooleanOptions } from "../src/lib/model-selection";
import { HANBAO_MODELS } from "../src/lib/hanbao";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function configFor(model = HANBAO_MODELS[0]) {
    return { ...normalizeConfigSnapshot().config, model: `hanbao::${model}`, videoModel: `hanbao::${model}`, videoSeconds: "5", size: "16:9", videoGenerateAudio: "false", videoHanbaoFaceMask: "off" };
}

test("Hanbao keeps automatic sound on for all models and stale silent defaults", () => {
    expect(hasAutomaticVideoAudio("hanbao-video")).toBe(true);
    for (const model of HANBAO_MODELS) {
        const config = configFor(model);
        expect(defaultModelCapabilityConfig("hanbao-video", model).video?.generateAudio.default).toBe(true);
        expect(modelCapabilityConfigFor(config, config.model).video?.generateAudio.default).toBe(true);
        expect(resolveModelVideoBooleanOptions(config, config.model).videoGenerateAudio).toBe("true");
        expect(backendProviderConfig(config, "video").videoGenerateAudio).toBe("true");
        const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
        expect(html).toContain("同步声音已开启");
    }
    expect(hasAutomaticVideoAudio("openai-videos")).toBe(false);
});

test("Hanbao local mask controls expose density and mosaic in both themes", () => {
    for (const theme of Object.values(canvasThemes)) {
        const html = renderToStaticMarkup(<VideoSettingsPanel config={{ ...configFor(), videoHanbaoFaceMask: "grid-60" }} theme={theme} onConfigChange={() => {}} />);
        for (const label of ["人脸处理", "50%", "60%", "75%", "马赛克"]) expect(html).toContain(label);
        expect(html).toContain('aria-checked="true" aria-label="自动人脸遮罩"');
    }
});

test("Hanbao node mask overrides survive generation and retry without another provider's overrides", () => {
    const hanbaoFaceMasks = { portrait: { sourceHash: "fixture", regions: [{ id: "face", x: 0.1, y: 0.2, width: 0.2, height: 0.3 }] } };
    const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "Video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { hanbaoFaceMask: "grid-75", hanbaoFaceMasks, sd2FaceMask: "mosaic", towoFaceMask: "grid-60", jiasuFaceMask: "grid" } };
    const built = buildGenerationConfig(configFor(), node, "video");
    expect(built.videoHanbaoFaceMask).toBe("grid-75");
    const metadata = buildVideoGenerationMetadata(node, undefined, built);
    expect(metadata).toMatchObject({ hanbaoFaceMask: "grid-75", hanbaoFaceMasks });
    for (const name of ["sd2FaceMask", "sd2FaceMasks", "towoFaceMasks", "jiasuFaceMasks"]) expect(metadata).not.toHaveProperty(name);
    const config = configFor();
    const remote = createModelChannel({ id: "remote", interfaceType: "towo-sd25-video", models: ["seedance-2.5"] });
    expect(buildVideoGenerationMetadata(node, undefined, { ...config, channels: [...config.channels, remote], model: "remote::seedance-2.5" })).not.toHaveProperty("hanbaoFaceMasks");
});

test("Hanbao defaults off and normalizes only its own local mask preference", () => {
    expect(defaultConfig.videoHanbaoFaceMask).toBe("off");
    for (const mode of ["off", "grid", "grid-60", "grid-75", "mosaic"]) {
        const config = normalizeConfigSnapshot({ config: { ...configFor(), videoHanbaoFaceMask: mode, videoSd2FaceMask: "grid-60", videoJiasuFaceMask: "mosaic" } }).config;
        expect(config.videoHanbaoFaceMask).toBe(mode);
        expect(config.videoSd2FaceMask).toBe("grid-60");
        expect(config.videoJiasuFaceMask).toBe("mosaic");
    }
    expect(normalizeConfigSnapshot({ config: { ...configFor(), videoHanbaoFaceMask: undefined } }).config.videoHanbaoFaceMask).toBe("off");
});

test("Hanbao off preserves original references and sends no unsupported face parameters", async () => {
    const config = { ...configFor(), videoNativeFace: "true", videoSd2FaceMask: "grid", videoJiasuFaceMask: "grid" };
    const image = { id: "portrait", name: "原图", type: "image/png", dataUrl: "", storageKey: "resource:original" };
    const prepared = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [image] });
    const input = prepared.input as { config: Record<string, unknown>; referenceImages: Array<{ storageKey: string }> };
    expect(input.referenceImages[0].storageKey).toBe(image.storageKey);
    expect(input.config.videoGenerateAudio).toBe("true");
    for (const name of ["face", "nativeFace", "videoHanbaoFaceMask", "videoSd2FaceMask", "videoJiasuFaceMode"]) expect(input.config).not.toHaveProperty(name);
});
