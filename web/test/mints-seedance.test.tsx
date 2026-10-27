import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { VideoSettingsPanel } from "../src/components/video-settings-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { isVolcengineArkVideoProtocol } from "../src/lib/model-protocols";
import { MintsSeedanceOptions } from "../src/pages/settings/mints-seedance-options";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { apiClient } from "../src/services/api/request";
import { createVideoGenerationTask, pollVideoGenerationTask } from "../src/services/api/video";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

function mintsConfig() {
    const model = "doubao-seedance-2-0-260128";
    return normalizeConfigSnapshot({ config: {
        ...defaultConfig,
        channels: [createModelChannel({ id: "mints-seedance", name: "Mints", interfaceType: "mints-seedance-video", baseUrl: "https://mints.example", apiKey: "synthetic-mints-key", models: [model], modelProfiles: [{ model, capability: "video", protocol: "mints-seedance-video", defaultOptions: { asset_group_id: "verified-group", seed: 0, camera_fixed: false, service_tier: "flex", draft: true } }] })],
        model: `mints-seedance::${model}`, videoModel: `mints-seedance::${model}`, videoSeconds: "18", vquality: "720p", size: "9:16",
        videoEggfansReferenceMode: "url", videoNativeFace: "true", videoJiasuFaceMode: "heavy", videoJiasuFaceMask: "grid75", videoArkPrivateAssetUpload: "false",
    } }).config;
}

describe("Mints Seedance isolated automatic URI channel", () => {
    test("new video tasks enable audio without requiring a saved audio setting", async () => {
        const config = mintsConfig();
        config.channels[0].modelProfiles![0].capabilityConfig = { version: 1 };
        const defaults = resolveModelGenerationDefaults(config, config.videoModel, "video");
        const task = await prepareBackendGenerationTask({ mode: "video", config: { ...config, ...defaults }, prompt: "A bird sings" });
        expect((task.input as Record<string, any>).config.videoGenerateAudio).toBe("true");
    });

    test("sends owned resources to backend and ignores other providers' URIs and switches", async () => {
        const task = await prepareBackendGenerationTask({ mode: "video", config: mintsConfig(), prompt: "@图片1 行走", referenceImages: [{ id: "image", storageKey: "resource:original", url: "https://h.uguu.se/expired.png", arkAssetId: "foreign-ark-id", type: "image/png", name: "图片1", width: 1024, height: 1024 }] });
        const input = task.input as Record<string, any>;
        expect(input.referenceImages[0]).toMatchObject({ storageKey: "resource:original" });
        expect(input.referenceImages[0].url).toBeUndefined();
        expect(input.metadata.providerOptions["mints-seedance-video"]).toEqual({ asset_group_id: "verified-group", seed: 0, camera_fixed: false, service_tier: "flex", draft: true });
        expect(input.config).toMatchObject({ apiKey: "synthetic-mints-key", interfaceType: "mints-seedance-video" });
        expect(input.config).not.toHaveProperty("videoNativeFace");
        expect(input.config).not.toHaveProperty("videoJiasuFaceMode");
    });

    test("creates and polls persistent backend tasks", async () => {
        const original = apiClient.defaults.adapter;
        const calls: string[] = [];
        apiClient.defaults.adapter = async (request) => {
            calls.push(`${request.method} ${request.url}`);
            if (request.method === "post") expect(JSON.parse(request.data).input.config.interfaceType).toBe("mints-seedance-video");
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "local-mints", status: request.method === "post" ? "queued" : "succeeded", resultJson: JSON.stringify({ video: { url: "/api/resources/local-mints/file", mimeType: "video/mp4" } }) } } };
        };
        try {
            const task = await createVideoGenerationTask(mintsConfig(), "scene");
            expect(task.provider).toBe("backend");
            expect(await pollVideoGenerationTask(mintsConfig(), task)).toMatchObject({ status: "completed", result: { url: "/api/resources/local-mints/file" } });
            expect(calls).toEqual(["post /tasks", "get /tasks/local-mints"]);
        } finally { apiClient.defaults.adapter = original; }
    });

    test("shows automatic binding without another channel's URI or face controls", () => {
        for (const theme of Object.values(canvasThemes)) {
            const html = renderToStaticMarkup(<VideoSettingsPanel config={mintsConfig()} theme={theme} onConfigChange={() => {}} />);
            expect(html).toContain("自动资产绑定");
            expect(html).toContain("Uguu");
            expect(html).not.toContain("使用资产 URI");
            expect(html).not.toContain("自动同步可信素材");
            expect(html).not.toContain("人脸处理");
        }
    });

    test("exposes documented advanced options and preserves them on config reload", () => {
        const config = mintsConfig();
        const restored = normalizeConfigSnapshot(JSON.parse(JSON.stringify({ config }))).config;
        const options = restored.channels[0].modelProfiles![0].defaultOptions;
        expect(options).toEqual(config.channels[0].modelProfiles![0].defaultOptions);
        const html = renderToStaticMarkup(<MintsSeedanceOptions value={options} onChange={() => {}} />);
        for (const label of ["资产组 ID", "随机种子", "服务等级", "固定镜头", "草稿模式"]) expect(html).toContain(label);
        expect(html).toContain("verified-group");
    });

    test("supports native references while retaining other channel capabilities", () => {
        const profile = defaultModelCapabilityConfig("mints-seedance-video", "doubao-seedance-2-0-260128").video!;
        expect(profile.references.maxVideos).toBe(3);
        expect(profile.references.maxAudios).toBe(3);
        expect(profile.generateAudio.supported).toBe(true);
        expect(profile.duration.max).toBeGreaterThanOrEqual(18);
        expect(isVolcengineArkVideoProtocol("mints-seedance-video")).toBe(true);
        expect(defaultModelCapabilityConfig("mints-seedance-video", "doubao-seedance-2-5-custom").video!.references.maxImages).toBe(30);
        expect(defaultModelCapabilityConfig("jiasu-video", "dola-sd-2.0").video!.duration.max).toBe(15);
    });
});
