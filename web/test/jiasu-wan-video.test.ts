import { expect, test } from "bun:test";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeVideoValue, videoDurationAllowed } from "../src/lib/model-capabilities";
import { modelCompatibilityError } from "../src/lib/model-selection";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const model = "wan3-特惠";
const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

test("Gway Wan3 discount uses its documented 5-30 seconds and 1080p contract", () => {
    const profile = defaultModelCapabilityConfig("jiasu-video", model).video!;
    expect(profile.duration).toEqual({ selection: "range", min: 5, max: 30, step: 1, default: 5 });
    expect(profile.ratios).toEqual(ratios);
    expect(profile.resolutions).toEqual(["1080p"]);
    expect(profile.defaultResolution).toBe("1080p");
    expect(videoDurationAllowed(profile, 30)).toBe(true);
    expect(videoDurationAllowed(profile, 4)).toBe(false);
    expect(videoDurationAllowed(profile, 31)).toBe(false);
});

test("Gway Wan3 repairs stale saved limits and preserves 30 seconds through canvas and task submission", async () => {
    const stale = defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0");
    const channel = createModelChannel({ id: "gway-wan", name: "极途 Gway", interfaceType: "jiasu-video", baseUrl: "https://www.gway.dev", apiKey: "synthetic-wan-test-key", models: [model], modelProfiles: [{ model, capability: "video", protocol: "jiasu-video", capabilityConfig: stale }] });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: `gway-wan::${model}`, videoModel: `gway-wan::${model}`, videoSeconds: "30", vquality: "1080p", size: "21:9", videoJiasuFaceMask: "off" } }).config;
    const profile = modelCapabilityConfigFor(config, config.model).video!;
    expect(profile.duration).toEqual({ selection: "range", min: 5, max: 30, step: 1, default: 5 });
    expect(profile.ratios).toEqual(ratios);
    expect(profile.resolutions).toEqual(["1080p"]);
    expect(normalizeVideoValue(profile, { seconds: "30", ratio: "21:9", resolution: "720p" })).toEqual({ seconds: "30", ratio: "21:9", resolution: "1080p" });
    expect(modelCompatibilityError(config, config.model, { capability: "video", videoSeconds: "30" })).toBe("");
    const node: CanvasNodeData = { id: "wan-video", type: CanvasNodeType.Video, title: "Wan", position: { x: 0, y: 0 }, width: 400, height: 240, metadata: { model: config.model, seconds: "30", vquality: "720p", size: "21:9" } };
    const generation = buildGenerationConfig(config, node, "video");
    expect(generation.videoSeconds).toBe("30");
    expect(generation.model).toBe(config.model);
    expect(generation.vquality).toBe("1080");
    const task = await prepareBackendGenerationTask({ mode: "video", config: generation, prompt: "@图片1 主角推门走入庭院", referenceImages: [{ id: "image", name: "图片1", type: "image/png", url: "https://h.uguu.se/reference.png" }] });
    expect((task.input as { config: Record<string, unknown> }).config).toMatchObject({ interfaceType: "jiasu-video", model, videoSeconds: "30", vquality: "1080" });
});

test("Gway Wan3 discount does not change other models or channels", () => {
    expect(defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0").video!.duration.max).toBe(15);
    expect(defaultModelCapabilityConfig("jiasu-video", "minimax-h3").video!.duration).toMatchObject({ selection: "range", min: 4, max: 30 });
    expect(defaultModelCapabilityConfig("jiasu-video", "wan3-Prime").video!.resolutions).toEqual(["480p", "720p", "1080p"]);
    expect(defaultModelCapabilityConfig("wan-task-gateway-video", "wan3.0-video").video!.duration.min).toBe(2);
    expect(defaultModelCapabilityConfig("nono-video", model).video!.resolutions).toEqual(["720p"]);
});
