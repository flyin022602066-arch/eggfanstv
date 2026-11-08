import { modelCompatibilityError, modelPromptLengthError, resolveModelVideoBooleanOptions } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";

export function workflowVideoGenerationConfig(config: AiConfig, input: { model: string; seconds: string; ratio: string; resolution: string }): AiConfig {
    return { ...config, model: input.model, videoModel: input.model, videoSeconds: input.seconds, size: input.ratio, vquality: input.resolution, videoEggfansReferenceMode: "url", ...resolveModelVideoBooleanOptions(config, input.model, { videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark }) };
}

export function workflowVideoSubmissionError(config: AiConfig, prompt: string, imageCount: number, audioCount: number) {
    if (!config.model) return "请选择视频模型";
    return modelCompatibilityError(config, config.model, { capability: "video", videoSeconds: config.videoSeconds, options: { size: config.size, vquality: config.vquality, videoSeconds: Number(config.videoSeconds) }, input: { textCount: 1, imageCount, videoCount: 0, audioCount, characterCount: 0 }, videoOperation: imageCount ? "reference_to_video" : undefined }) || modelPromptLengthError(config, config.model, "video", prompt);
}
