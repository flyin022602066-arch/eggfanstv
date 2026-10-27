import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { getResourceUpstreamUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile, uploadResourceToUguu } from "@/services/api/resources";
import { modelOptionName } from "@/stores/use-config-store";
import { sdVideoImageReferenceLimit } from "@/lib/model-capabilities";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { ApiEnvelope, RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";
import { resolveVideoImageReferences } from "./video-reference-roles";

type EggfansMedia = {
    id?: string;
    name?: string;
    url?: string;
    dataUrl?: string;
    storageKey?: string;
};

type EggfansTaskResponse = Record<string, unknown> & {
    id?: string;
    task_id?: string;
    taskId?: string;
    status?: string;
    state?: string;
};

const MAX_IMAGES_DEFAULT = 10;
const MAX_VIDEOS = 10;
const MAX_AUDIOS = 10;

export async function createEggfansSd2VideoTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model).trim();
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) throw new Error("请输入 EggFans 视频提示词");
    const duration = Number(config.videoSeconds);
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error("EggFans SD2 视频时长必须为 4–30 秒");

    const imageLimit = eggfansImageLimit(modelName);
    if (references.length > imageLimit) throw new Error(`EggFans ${modelName} 最多支持 ${imageLimit} 张参考图`);
    if (videoReferences.length > MAX_VIDEOS) throw new Error(`EggFans 视频模型最多支持 ${MAX_VIDEOS} 个参考视频`);
    if (audioReferences.length > MAX_AUDIOS) throw new Error(`EggFans 视频模型最多支持 ${MAX_AUDIOS} 段参考音频`);

    const imagePlan = resolveVideoImageReferences(references, options, { videoCount: videoReferences.length, audioCount: audioReferences.length });
    const firstImage = imagePlan.find((item) => item.role === "first_frame")?.image;
    const lastImage = imagePlan.find((item) => item.role === "last_frame")?.image;
    const imageReferences = imagePlan.filter((item) => item.role === "reference_image").map((item) => item.image);
    if ((firstImage || lastImage) && (imageReferences.length || videoReferences.length || audioReferences.length)) {
        throw new Error("EggFans 首尾帧模式不能与图片、视频或音频参考素材同时使用");
    }

    const [imageUrls, firstImageUrl, lastImageUrl, videoUrls, audioUrls] = await Promise.all([
        Promise.all(imageReferences.map((item) => resolveEggfansMediaUrl(item, "image", options))),
        firstImage ? resolveEggfansMediaUrl(firstImage, "image", options) : Promise.resolve(undefined),
        lastImage ? resolveEggfansMediaUrl(lastImage, "image", options) : Promise.resolve(undefined),
        Promise.all(videoReferences.map((item) => resolveEggfansMediaUrl(item, "video", options))),
        Promise.all(audioReferences.map((item) => resolveEggfansMediaUrl(item, "audio", options))),
    ]);

    const payload = {
        model: modelName,
        prompt: normalizedPrompt,
        duration,
        resolution: "720p",
        aspect_ratio: eggfansAspectRatio(config.size),
        ...(config.videoNativeFace === "true" && (imageUrls.length || videoUrls.length || firstImageUrl) ? { native_face: true } : {}),
        ...(imageUrls.length ? { image_refs: imageUrls } : {}),
        ...(videoUrls.length ? { video_refs: videoUrls } : {}),
        ...(audioUrls.length ? { audio_refs: audioUrls } : {}),
        ...(firstImageUrl ? { first_image: firstImageUrl } : {}),
        ...(lastImageUrl ? { last_image: lastImageUrl } : {}),
    };

    try {
        const raw = await deps.transport.post<ApiEnvelope<EggfansTaskResponse>>(deps.transport.apiUrl("/v1/videos"), payload, options);
        const created = deps.response.unwrapEnvelope(raw, "EggFans 接口没有返回视频任务");
        const id = taskIdFrom(created);
        if (!id) throw new Error("EggFans 创建响应没有任务 ID");
        return { id, provider: "eggfans-sd2", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "EggFans SD2 视频任务创建失败"));
    }
}

export async function pollEggfansSd2VideoTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    task: VideoGenerationTask,
    options?: RequestOptions,
): Promise<VideoGenerationTaskState> {
    try {
        const raw = await deps.transport.getTaskStatus<ApiEnvelope<EggfansTaskResponse>>(deps.transport.apiUrl(`/v1/videos/${encodeURIComponent(task.id)}`), options);
        const state = unwrapEggfansTaskState(raw);
        if (!Object.keys(state).length) throw new Error("EggFans 接口没有返回任务状态");
        const status = String(state.status || state.state || "").trim().toLowerCase();
        const error = eggfansErrorMessage(state);
        if (["failed", "failure", "error", "cancelled", "canceled", "expired"].includes(status)) {
            return { status: "failed", error: error || "EggFans 视频生成失败" };
        }
        const url = eggfansVideoUrl(state);
        if (["success", "succeeded", "completed", "complete", "done", "finished"].includes(status) || url) {
            if (!url) return { status: "failed", error: error || "EggFans 视频任务已完成但没有返回视频地址" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "EggFans SD2 视频任务查询失败"));
    }
}

export function eggfansImageLimit(model: string) {
    return sdVideoImageReferenceLimit("eggfans-sd2-video", model) ?? MAX_IMAGES_DEFAULT;
}

export function eggfansAspectRatio(value: string) {
    const normalized = String(value || "16:9").trim().toLowerCase().replace("×", "x");
    if (normalized === "auto" || !normalized) return "16:9";
    const ratio = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratio) return `${Number(ratio[1])}:${Number(ratio[2])}`;
    const dimensions = normalized.match(/^(\d+)x(\d+)$/);
    if (!dimensions) throw new Error("EggFans 画幅必须是宽高比或 WxH 尺寸");
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const divisor = greatestCommonDivisor(width, height);
    if (divisor <= 0) throw new Error("EggFans 画幅尺寸无效");
    return `${width / divisor}:${height / divisor}`;
}

export function isEggfansPublicHttpsUrl(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return false;
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
        if (hostname.includes(":")) return false;
        const octets = hostname.split(".").map(Number);
        if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
            const [first, second] = octets;
            if (first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)) return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function resolveEggfansMediaUrl(media: EggfansMedia, kind: "image" | "video" | "audio", options?: RequestOptions) {
    const resourceKey = media.storageKey?.startsWith("resource:") ? media.storageKey : "";
    const directUrl = media.url || media.dataUrl || "";
    if (resourceKey) return kind === "image" ? uploadResourceToUguu(resourceIdFromStorageKey(resourceKey), options) : getResourceUpstreamUrl(resourceKey, options);
    if (isEggfansPublicHttpsUrl(directUrl)) return directUrl;
    if (/^asset:\/\//i.test(directUrl) && !media.storageKey) throw new Error("EggFans SD2 不支持私域资产 URI，请使用原始图片、视频或音频");
    if (/^https?:\/\//i.test(directUrl)) throw new Error("EggFans 参考素材只接受公网 HTTPS URL");

    let blob = media.storageKey ? await getMediaBlob(media.storageKey) : null;
    if (!blob && kind === "image") {
        const dataUrl = await imageToDataUrl(media);
        if (dataUrl.startsWith("data:") || dataUrl.startsWith("blob:")) blob = await (await fetch(dataUrl)).blob();
    }
    if (!blob && /^(?:data|blob):/i.test(directUrl)) blob = await (await fetch(directUrl)).blob();
    if (!blob) throw new Error("EggFans 本地参考素材无法读取，请重新上传后再试");

    const resource = await uploadResourceFile(blob, kind, {
        fileName: media.name,
        idempotencyKey: media.storageKey || `eggfans-sd2:${kind}:${media.id || media.name || "media"}`,
    });
    return kind === "image" ? uploadResourceToUguu(resource.id, options) : getResourceUpstreamUrl(resourceStorageKey(resource.id), options);
}

function taskIdFrom(payload: EggfansTaskResponse) {
    const nested = asRecord(payload.data);
    return String(payload.id || payload.task_id || payload.taskId || nested?.id || nested?.task_id || nested?.taskId || "").trim();
}

function unwrapEggfansTaskState(payload: unknown): EggfansTaskResponse {
    const wrapper = asRecord(payload);
    const data = asRecord(wrapper?.data);
    return (data || wrapper || {}) as EggfansTaskResponse;
}

function eggfansVideoUrl(payload: EggfansTaskResponse) {
    const content = asRecord(payload.content);
    const output = asRecord(payload.output);
    const result = asRecord(payload.result);
    const nestedData = asRecord(payload.data);
    const candidates = [payload.video_url, payload.videoUrl, payload.url, content?.url, content?.video_url, output?.url, result?.url, nestedData?.video_url, nestedData?.url];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
        if (Array.isArray(candidate)) {
            const first = candidate[0];
            if (typeof first === "string" && first.trim()) return first.trim();
            const item = asRecord(first);
            if (typeof item?.url === "string" && item.url.trim()) return item.url.trim();
        }
        const item = asRecord(candidate);
        if (typeof item?.url === "string" && item.url.trim()) return item.url.trim();
    }
    return "";
}

function eggfansErrorMessage(payload: EggfansTaskResponse) {
    const error = asRecord(payload.error);
    return String(error?.message || error?.detail || payload.message || payload.detail || payload.fail_reason || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function greatestCommonDivisor(left: number, right: number): number {
    return right === 0 ? left : greatestCommonDivisor(right, left % right);
}
