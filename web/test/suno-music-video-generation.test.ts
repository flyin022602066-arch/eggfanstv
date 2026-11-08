import { expect, test } from "bun:test";
import { resolveSunoMusicVideoImageConfig, sunoMusicVideoAssetRequest } from "../src/lib/suno-music-video-generation";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { PromptTemplateOperation } from "../src/lib/prompts";
import { workflowVideoGenerationConfig, workflowVideoSubmissionError } from "../src/lib/workflow-video-generation";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import type { SunoMusicVideoAsset } from "../src/lib/suno-music-video-plan";

const imageChannel = createModelChannel({ id: "mv-face", name: "fixture", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: ["gpt-image-2"] });
const imageModel = encodeChannelModel(imageChannel.id, "gpt-image-2");
const imageConfig = { ...defaultConfig, channels: [imageChannel], model: imageModel, imageModel };
const presets = { male: { resourceId: "male-face", assetIds: ["hero"] }, female: { resourceId: "female-face", assetIds: ["heroine"] } };
const asset: SunoMusicVideoAsset = { id: "hero", name: "歌者", category: "character", description: "黑色风衣，青年歌者", imagePrompt: "银色项链，统一造型" };

test("MV characters share the project turnaround template without invoking project-asset finalization", async () => {
    const request = sunoMusicVideoAssetRequest(asset, imageModel, "3D 动漫，冷色电影光", imageConfig, presets);
    const prepared = await prepareBackendGenerationTask(request);
    const input = prepared.input as { metadata: { operation: string; promptTemplateOperation: string; promptTemplateVariables: { 角色设定: string; 项目画风: string } }; referenceImages: { storageKey: string }[] };
    expect(prepared.projectId).toBeUndefined();
    expect(input.metadata.operation).toBe("suno_music_video_asset");
    expect(input.metadata.promptTemplateOperation).toBe(PromptTemplateOperation.CharacterTurnaround);
    expect(input.referenceImages.map((image) => image.storageKey)).toEqual(["resource:male-face"]);
    expect(input.metadata.promptTemplateVariables.项目画风).toContain("3D 动漫");
    for (const text of ["黑色风衣", "银色项链", "面孔身份依据", "不照搬", "不混合男女主", "不含头部"]) expect(input.metadata.promptTemplateVariables.角色设定).toContain(text);
});

test("MV character generation keeps male and female references separate and leaves unbound characters alone", () => {
    const requests = ["hero", "heroine", "supporting"].map((id) => sunoMusicVideoAssetRequest({ ...asset, id }, imageModel, "电影感", imageConfig, presets));
    expect(requests.map((request) => request.referenceImages.map((image) => image.storageKey))).toEqual([["resource:male-face"], ["resource:female-face"], []]);
    expect(JSON.stringify(requests[2]?.metadata)).not.toContain("主角预设人脸与服装造型设计");
});

test("scene and prop generation never inherit a character face or turnaround template", () => {
    for (const category of ["scene", "prop"] as const) {
        const request = sunoMusicVideoAssetRequest({ ...asset, category }, imageModel, "电影感", imageConfig, presets);
        expect(request.referenceImages).toEqual([]);
        expect(request.metadata).not.toHaveProperty("promptTemplateOperation");
        expect(request.prompt).toContain("银色项链");
        expect(request.prompt).toContain("电影感");
    }
});

test("MV image settings reach the final backend request without changing video or channel settings", async () => {
    const config = resolveSunoMusicVideoImageConfig(imageConfig, "character", { model: imageModel, size: "1536x1024", quality: "high" }, "9:16");
    const request = sunoMusicVideoAssetRequest(asset, imageModel, "电影感", config, presets);
    const prepared = await prepareBackendGenerationTask(request);
    expect(prepared.input.config).toMatchObject({ model: "gpt-image-2", size: "1536x1024", quality: "high" });
    expect(request.referenceImages.map((image) => image.storageKey)).toEqual(["resource:male-face"]);
    expect(imageConfig.size).toBe(defaultConfig.size);
    expect(config.channels).toBe(imageConfig.channels);
});

test("new MV image settings default to a landscape character sheet and the MV aspect for scenes", () => {
    const character = resolveSunoMusicVideoImageConfig(imageConfig, "character", undefined, "9:16");
    const scene = resolveSunoMusicVideoImageConfig(imageConfig, "scene", undefined, "9:16");
    expect(character.size).not.toBe("1:1");
    expect(character.size).not.toBe("1024x1024");
    expect(scene.size).toBe("9:16");
});

test("uploaded but unbound faces cannot silently fall back to text-only character generation", () => {
    expect(() => sunoMusicVideoAssetRequest(asset, imageModel, "电影感", imageConfig, { male: { resourceId: "male-face", assetIds: [] } })).toThrow("未绑定");
    expect(() => sunoMusicVideoAssetRequest({ ...asset, category: "scene" }, imageModel, "电影感", imageConfig, { male: { resourceId: "male-face", assetIds: [] } })).not.toThrow();
});

test("face generation rejects unsupported image-reference models before submission", () => {
    const capabilities = defaultModelCapabilityConfig("openai-image", "gpt-image-2");
    const channel = createModelChannel({ ...imageChannel, modelProfiles: [{ model: "gpt-image-2", capability: "image", protocol: "openai-image", capabilityConfig: { ...capabilities, image: { ...capabilities.image!, references: { ...capabilities.image!.references, maxImages: 0 } } } }] });
    expect(() => sunoMusicVideoAssetRequest(asset, imageModel, "电影感", { ...imageConfig, channels: [channel] }, presets)).toThrow("不支持参考图");
});

function videoConfig(operations = ["reference_to_video"]) {
    const modelName = "seedance-2.5";
    const capabilities = defaultModelCapabilityConfig("towo-sd25-video", modelName);
    const channel = createModelChannel({ id: "mv-video", name: "fixture", interfaceType: "towo-sd25-video", baseUrl: "https://example.invalid", apiKey: "fixture-only", models: [modelName], modelProfiles: [{ model: modelName, capability: "video", protocol: "towo-sd25-video", capabilityConfig: { ...capabilities, video: { ...capabilities.video!, operations, references: { ...capabilities.video!.references, promptMaxChars: 100 }, watermark: { supported: true, default: false } } } }] });
    const model = encodeChannelModel(channel.id, modelName);
    return workflowVideoGenerationConfig({ ...defaultConfig, channels: [channel], videoGenerateAudio: "true", videoWatermark: "true", videoJiasuFaceMode: "heavy", videoJiasuFaceMask: "off", videoSd2FaceMask: "off", videoNativeFace: "true", videoEggfansReferenceMode: "uri" }, { model, seconds: "30", ratio: "9:16", resolution: "1080p" });
}

test("MV and project video configs preserve channel settings and use full-modal reference mode", () => {
    const config = videoConfig();
    expect(config).toMatchObject({ model: "mv-video::seedance-2.5", videoModel: "mv-video::seedance-2.5", videoSeconds: "30", size: "9:16", vquality: "1080p", videoEggfansReferenceMode: "url", videoGenerateAudio: "true", videoWatermark: "true", videoJiasuFaceMode: "heavy", videoJiasuFaceMask: "off", videoSd2FaceMask: "off", videoNativeFace: "true" });
    expect(workflowVideoSubmissionError(config, "镜头推进，歌曲同步", 2, 1)).toBe("");
});

test("shared video validation checks full-modal operation, duration, references and prompt limits", () => {
    const config = videoConfig();
    expect(workflowVideoSubmissionError({ ...config, videoSeconds: "99" }, "镜头", 1, 1)).toContain("视频时长");
    expect(workflowVideoSubmissionError(config, "镜头", 31, 1)).toContain("参考图");
    expect(workflowVideoSubmissionError(config, "镜头", 1, 11)).toContain("参考音频");
    expect(workflowVideoSubmissionError(videoConfig(["image_to_video"]), "镜头", 1, 1)).toContain("不支持");
    expect(workflowVideoSubmissionError(config, "镜".repeat(15001), 1, 1)).toContain("15000");
});
