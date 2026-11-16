import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { withChannels } from "@/pages/settings/channel-settings-pane";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createModelConfigRepository } from "@/services/model-config-repository";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "@/stores/use-config-store";

function fixture(overrides: Partial<AiConfig> = {}) {
    const channels = [
        createModelChannel({ id: "video", name: "Video", baseUrl: "https://video.example.invalid", apiKey: "video-key", interfaceType: "nono-video", models: ["video-model"], modelProfiles: [{ model: "video-model", capability: "video", protocol: "nono-video" }] }),
        createModelChannel({ id: "primary", name: "Primary", baseUrl: "https://primary.example.invalid", apiKey: "primary-key", interfaceType: "chat-completion", models: ["main-text"], modelProfiles: [{ model: "main-text", capability: "text", protocol: "chat-completion" }] }),
        createModelChannel({ id: "backup", name: "Backup", baseUrl: "https://backup.example.invalid", apiKey: "backup-key", interfaceType: "claude-api", models: ["backup-text"], modelProfiles: [{ model: "backup-text", capability: "text", protocol: "claude-api" }] }),
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, model: "video::video-model", videoModel: "video::video-model", textModel: "primary::main-text", textFallbackModel: "backup::backup-text", size: "16:9", videoSeconds: "15", ...overrides } }).config;
}

describe("自动提示词优化的文本兜底模型", () => {
    test("默认不启用，显式选择可保存恢复，目录变更不暗改选择", async () => {
        expect(normalizeConfigSnapshot({ config: { ...defaultConfig, textFallbackModel: undefined } }).config.textFallbackModel).toBe("");
        let saved = fixture();
        const repository = createModelConfigRepository({
            read: async () => ({ config: saved, revision: 1, health: "ready", source: "builtin+local" }),
            write: async (value, revision) => { saved = value; return { saved: true, revision: revision + 1 }; },
        });
        await repository.hydrate();
        await repository.commit(saved);
        expect(normalizeConfigSnapshot({ config: saved }).config.textFallbackModel).toBe("backup::backup-text");
        expect(withChannels(saved, saved.channels.filter((channel) => channel.id !== "backup")).textFallbackModel).toBe("backup::backup-text");
    });

    test("设置页显示可关闭的兜底选择，失效选择明确提示", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={fixture()} onChange={() => {}} />);
        expect(markup).toContain('aria-label="文本兜底模型"');
        expect(markup).toContain("backup-text");
        expect(markup).toContain("最终提示词");
        const disabled = renderToStaticMarkup(<ModelDefaultGrid config={fixture({ textFallbackModel: "" })} onChange={() => {}} />);
        expect(disabled).toContain("不启用兜底");
        const unavailable = renderToStaticMarkup(<ModelDefaultGrid config={fixture({ textFallbackModel: "gone::text" })} onChange={() => {}} />);
        expect(unavailable).toContain("已选模型不可用，请重新选择");
    });

    test("仅为视频自动润色携带独立兜底协议和密钥，不改视频请求参数", async () => {
        const config = fixture();
        const task = await prepareBackendGenerationTask({ mode: "video", prompt: "图片1中的角色走进花园", config });
        const plain = await prepareBackendGenerationTask({ mode: "video", prompt: task.prompt, config: { ...config, textFallbackModel: "" } });
        const input = task.input as Record<string, any>;
        expect(input.config).toEqual((plain.input as Record<string, unknown>).config);
        expect(input.videoPromptRepair.config.model).toBe("main-text");
        expect(input.videoPromptRepair.config.apiKey).toBe("primary-key");
        expect(input.videoPromptRepair.fallback.config).toMatchObject({ model: "backup-text", interfaceType: "claude-api", apiKey: "backup-key", baseUrl: "https://backup.example.invalid" });
        expect((plain.input as Record<string, any>).videoPromptRepair.fallback).toBeNull();
        const text = await prepareBackendGenerationTask({ mode: "text", prompt: "hello", config: { ...config, model: config.textModel } });
        expect(text.input).not.toHaveProperty("videoPromptRepair");
        const same = await prepareBackendGenerationTask({ mode: "video", prompt: task.prompt, config: { ...config, textFallbackModel: config.textModel } });
        expect((same.input as Record<string, any>).videoPromptRepair.fallback).toBeNull();
    });

    test("失效或禁用的兜底渠道不会继承主模型和视频渠道的凭据", async () => {
        const config = fixture();
        const disabledConfig = { ...config, channels: config.channels.map((channel) => channel.id === "backup" ? { ...channel, enabled: false } : channel) };
        for (const invalidConfig of [disabledConfig, { ...config, textFallbackModel: "gone::model" }, { ...config, textFallbackModel: config.videoModel }]) {
            const task = await prepareBackendGenerationTask({ mode: "video", prompt: "花园远景", config: invalidConfig });
            const fallback = (task.input as Record<string, any>).videoPromptRepair.fallback;
            expect(fallback.configError).toBeTruthy();
            expect(fallback.config).toBeUndefined();
        }
        expect(renderToStaticMarkup(<ModelDefaultGrid config={disabledConfig} onChange={() => {}} />)).toContain("已选模型不可用，请重新选择");
    });

    test("托管逻辑兜底模型只携带逻辑身份，不泄露供应商配置", async () => {
        const config = fixture();
        const channels = config.channels.map((channel) => channel.id === "backup" ? { ...channel, modelProfiles: channel.modelProfiles?.map((profile) => ({ ...profile, logicalModelId: "logical-backup" })) } : channel);
        const task = await prepareBackendGenerationTask({ mode: "video", prompt: "花园远景", config: { ...config, channels } });
        const fallback = (task.input as Record<string, any>).videoPromptRepair.fallback;
        expect(fallback.logicalModelId).toBe("logical-backup");
        expect(fallback.config).not.toHaveProperty("apiKey");
        expect(fallback.config).not.toHaveProperty("baseUrl");
    });
});
