import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DoubaoBrowserVideoReferenceSettings, VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { DOUBAO_BROWSER_MODELS, normalizeDoubaoBrowserFaceMaskMode } from "../src/lib/doubao-browser";
import { normalizeSd2FaceMaskMode } from "../src/lib/eggfans-sd2-face-mask";
import { normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { jiasuFaceMaskCacheKey } from "../src/lib/jiasu-face-mask";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("Doubao browser settings use native ranges without unsupported Seedance controls", () => {
    for (const theme of Object.values(canvasThemes)) {
        for (const model of DOUBAO_BROWSER_MODELS) {
            const config = { ...normalizeConfigSnapshot().config, model: `doubao-browser::${model}`, videoSeconds: "5", size: "9:16" };
            const html = renderToStaticMarkup(<VideoSettingsPanel config={config} theme={theme} onConfigChange={() => {}} />);
            for (const ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"]) expect(html).toContain(ratio);
            expect(html).toContain(`max="${model === "seedance_v2.5" ? 30 : 15}"`);
            expect(html).toContain('min="1"');
            expect(html).toContain("自动人脸遮罩");
            for (const control of ["分辨率", "添加水印", "私有素材"]) expect(html).not.toContain(control);
        }
    }
});

test("Doubao project and canvas expose independent local image controls in both themes", () => {
    for (const theme of Object.values(canvasThemes)) {
        const config = { ...normalizeConfigSnapshot().config, model: "doubao-browser::seedance_v2.0", videoDoubaoBrowserFaceMask: "grid-60" };
        for (const Component of [DoubaoBrowserVideoReferenceSettings, VideoSettingsPanel]) {
            const html = renderToStaticMarkup(<Component config={config} theme={theme} onConfigChange={() => {}} />);
            for (const label of ["自动人脸遮罩", "半透明网格", "马赛克", "强模糊", "实色遮挡", "50%", "60%", "75%"]) expect(html).toContain(label);
            expect(html).toContain('aria-checked="true"');
        }
        expect(renderToStaticMarkup(<DoubaoBrowserVideoReferenceSettings config={{ ...config, model: "hanbao::seedance_v2.0" }} theme={theme} onConfigChange={() => {}} />)).toBe("");
    }
});

test("Doubao privacy masks survive configuration and node metadata without enabling them in other channels", () => {
    for (const mode of ["blur", "solid"]) {
        expect(normalizeDoubaoBrowserFaceMaskMode(mode)).toBe(mode);
        expect(normalizeSd2FaceMaskMode(mode)).toBe("off");
        const config = { ...normalizeConfigSnapshot().config, model: "doubao-browser::seedance_v2.0", videoDoubaoBrowserFaceMask: mode, videoHanbaoFaceMask: mode };
        const saved = normalizeConfigSnapshot({ config }).config;
        expect(saved.videoDoubaoBrowserFaceMask).toBe(mode);
        expect(saved.videoHanbaoFaceMask).toBe("off");
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { doubaoBrowserFaceMask: mode } };
        const built = buildGenerationConfig(saved, node, "video");
        expect(built.videoDoubaoBrowserFaceMask).toBe(mode);
        expect(buildVideoGenerationMetadata(node, undefined, built).doubaoBrowserFaceMask).toBe(mode);
        expect(backendProviderConfig(built, "video")).not.toHaveProperty("videoDoubaoBrowserFaceMask");
    }
    expect(normalizeDoubaoBrowserFaceMaskMode("invalid")).toBe("off");
});

test("Doubao masks persist through node config and generation metadata without mixing channels", () => {
    const doubaoBrowserFaceMasks = { portrait: { sourceHash: "fixture", regions: [{ id: "face", x: 0.1, y: 0.2, width: 0.3, height: 0.2 }] } };
    const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { doubaoBrowserFaceMask: "grid-75", doubaoBrowserFaceMasks, hanbaoFaceMask: "mosaic", hanbaoFaceMasks: doubaoBrowserFaceMasks } };
    const config = { ...normalizeConfigSnapshot().config, model: "doubao-browser::seedance_v2.0", videoDoubaoBrowserFaceMask: "grid-60", videoHanbaoFaceMask: "mosaic" };
    const built = buildGenerationConfig(config, node, "video");
    expect(built.videoDoubaoBrowserFaceMask).toBe("grid-75");
    const metadata = buildVideoGenerationMetadata(node, undefined, built);
    expect(metadata).toMatchObject({ doubaoBrowserFaceMask: "grid-75", doubaoBrowserFaceMasks });
    expect(metadata).not.toHaveProperty("hanbaoFaceMasks");
    expect(buildVideoGenerationMetadata(node, undefined, { ...config, model: "hanbao::seedance_v2.0" })).not.toHaveProperty("doubaoBrowserFaceMasks");
    expect(normalizeConfigSnapshot({ config }).config).toMatchObject({ videoDoubaoBrowserFaceMask: "grid-60", videoHanbaoFaceMask: "mosaic" });
    expect(normalizeConfigSnapshot({ config: { ...config, videoDoubaoBrowserFaceMask: "invalid" } }).config.videoDoubaoBrowserFaceMask).toBe("off");
    const regions = doubaoBrowserFaceMasks.portrait.regions;
    expect(jiasuFaceMaskCacheKey("user", "hash", "grid", regions, "doubao-browser")).not.toBe(jiasuFaceMaskCacheKey("user", "hash", "grid", regions, "hanbao"));
});

test("Doubao off uses original images and never sends local mask settings as native parameters", async () => {
    const config = { ...normalizeConfigSnapshot().config, model: "doubao-browser::seedance_v2.0", videoSeconds: "15", size: "16:9", videoDoubaoBrowserFaceMask: "off", videoHanbaoFaceMask: "grid", videoJiasuFaceMask: "mosaic", videoSd2FaceMask: "grid-75" };
    const image = { id: "portrait", name: "original", type: "image/png", dataUrl: "", storageKey: "resource:original" };
    const task = await prepareBackendGenerationTask({ mode: "video", config, prompt: "scene", referenceImages: [image] });
    const input = task.input as { config: Record<string, unknown>; referenceImages: Array<{ storageKey: string }> };
    expect(input.referenceImages[0].storageKey).toBe(image.storageKey);
    expect(input.config).toMatchObject({ interfaceType: "doubao-browser-video", model: "seedance_v2.0", videoSeconds: "15" });
    for (const name of ["face", "native_face", "videoDoubaoBrowserFaceMask", "videoHanbaoFaceMask", "videoSd2FaceMask"]) {
        expect(input.config).not.toHaveProperty(name);
        expect(backendProviderConfig({ ...config, videoDoubaoBrowserFaceMask: "mosaic" }, "video")).not.toHaveProperty(name);
    }
});
