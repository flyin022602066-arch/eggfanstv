import { nanoid } from "nanoid";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError } from "@/lib/user-scope-guard";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, type VideoGenerationTask } from "@/services/api/video";
import { getResourceBlob, ownedResourceIdFromMediaRef, resourceStorageKey } from "@/services/api/resources";
import { ensureSunoClipStorageKey } from "@/services/suno-studio";
import { configuredModelMatchesCapability, resolveModelChannel, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { addSunoMusicVideoTask, sunoStudioSnapshot, updateSunoMusicVideoTask, type SunoMusicVideoTask } from "@/stores/use-suno-studio-store";
import type { ReferenceAudio } from "@/types/media";
import type { ReferenceImage } from "@/types/image";
import { getActiveUserScope } from "@/lib/user-scope";
import { musicVideoAudioSegmentSeconds, musicVideoEffectiveDuration } from "@/lib/suno-music-video";
import { buildSunoMusicVideoBreakdownPrompt, musicVideoAudioRange, musicVideoSegmentRanges, parseSunoMusicVideoPlan, type SunoMusicVideoAsset, type SunoMusicVideoPlan } from "@/lib/suno-music-video-plan";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { uploadImage } from "@/services/image-storage";
import { sunoMusicVideoAssetRequest } from "@/lib/suno-music-video-generation";
import { workflowVideoGenerationConfig, workflowVideoSubmissionError } from "@/lib/workflow-video-generation";
import type { CharacterFacePresets } from "@/lib/project-character-face-presets";

const refreshes = new Map<string, Promise<void>>();
const retryAfter = new Map<string, { at: number; failures: number }>();

export type SubmitSunoMusicVideoInput = {
    songJobId: string;
    songClipId: string;
    model: string;
    duration: number;
    audioStart: number;
    ratio: string;
    resolution: string;
    prompt: string;
    references: ReferenceImage[];
    segmentIndex?: number;
    segmentCount?: number;
};

export async function analyzeSunoMusicVideoLyrics(input: { songJobId: string; songClipId: string; songTitle: string; songDuration: number; lyrics: string; model: string; maxImagesPerSegment: number }): Promise<SunoMusicVideoPlan> {
    const lyrics = input.lyrics.trim();
    if (!lyrics) throw new Error("歌曲没有歌词，请补充歌词后再拆解 MV");
    const ranges = musicVideoSegmentRanges(input.songDuration, 30);
    const config = useConfigStore.getState().config;
    const textConfig = { ...config, model: input.model, textModel: input.model, taskWorkflowProvider: "model" as const };
    if (!configuredModelMatchesCapability(config, input.model, "text")) throw new Error("请选择模型配置中已启用的文本模型");
    const prompt = buildSunoMusicVideoBreakdownPrompt({ songTitle: input.songTitle, songDuration: input.songDuration, lyrics, ranges, maxImagesPerSegment: input.maxImagesPerSegment });
    const result = await runBackendGenerationTask({ mode: "text", prompt, config: textConfig, streamText: false, metadata: { source: "suno-music-video-lyrics-breakdown", songJobId: input.songJobId, songClipId: input.songClipId } });
    if (!result.text?.trim()) throw new Error("文本模型没有返回 MV 拆解内容");
    return parseSunoMusicVideoPlan(result.text, { songJobId: input.songJobId, songClipId: input.songClipId, lyrics, ranges, maxImagesPerSegment: input.maxImagesPerSegment });
}

export async function generateSunoMusicVideoAssetImage(asset: SunoMusicVideoAsset, model: string, visualStyle: string, presets: CharacterFacePresets = {}, imageConfig?: AiConfig): Promise<ReferenceImage> {
    const store = useConfigStore.getState();
    const current = imageConfig || store.config;
    if (!configuredModelMatchesCapability(current, model, "image")) throw new Error("请选择模型配置中已启用的图片模型");
    const result = await runBackendGenerationTask(sunoMusicVideoAssetRequest(asset, model, visualStyle, current, presets));
    const image = result.images?.[0];
    if (!image) throw new Error(`资产“${asset.name}”生图任务已结束，但没有返回图片`);
    if (image.storageKey) return { id: asset.id, name: asset.name, type: image.mimeType || "image/png", dataUrl: "", url: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
    const source = image.dataUrl || image.url;
    if (!source) throw new Error(`资产“${asset.name}”没有可保存的图片地址`);
    const saved = await uploadImage(source);
    return { id: asset.id, name: asset.name, type: saved.mimeType, dataUrl: "", url: saved.url, storageKey: saved.storageKey, bytes: saved.bytes, width: saved.width, height: saved.height };
}

export async function submitSunoMusicVideo(input: SubmitSunoMusicVideoInput) {
    const scope = captureUserScope();
    const source = sunoStudioSnapshot(scope.userScope).jobs.find((job) => job.id === input.songJobId);
    const clip = source?.clips.find((item) => item.id === input.songClipId);
    if (!source || source.status !== "succeeded" || !clip || (!clip.audioUrl && !clip.storageKey)) throw new Error("请选择一首已完成且可读取的歌曲");
    if (!input.prompt.trim()) throw new Error("请填写 MV 视频提示词");
    const configStore = useConfigStore.getState();
    const channel = resolveModelChannel(configStore.config, input.model);
    const baseConfig = workflowVideoGenerationConfig(configStore.config, { model: input.model, seconds: String(input.duration), ratio: input.ratio, resolution: input.resolution });
    const profile = modelCapabilityConfigFor(baseConfig, input.model).video;
    if (!profile || profile.references.maxAudios < 1) throw new Error("所选视频模型不支持歌曲音频参考，请改用支持参考音频的模型");
    if (!configuredModelMatchesCapability(baseConfig, input.model, "video") || !configStore.isAiConfigReady(baseConfig, input.model)) throw new Error("当前视频模型渠道配置不完整，请先到设置中补齐");
    const validationError = workflowVideoSubmissionError(baseConfig, input.prompt, input.references.length, 1);
    if (validationError) throw new Error(`当前模型配置不可用：${validationError}`);
    const localId = nanoid();
    const now = new Date().toISOString();
    const record: SunoMusicVideoTask = {
        id: localId,
        songJobId: source.id,
        songClipId: clip.id,
        songTitle: clip.title || source.label,
        model: input.model,
        channelId: channel.id,
        baseUrl: channel.baseUrl.trim().replace(/\/+$/u, ""),
        duration: input.duration,
        audioStart: input.audioStart,
        audioDuration: 0,
        segmentIndex: input.segmentIndex,
        segmentCount: input.segmentCount,
        prompt: input.prompt.trim(),
        status: "submitting",
        createdAt: now,
        updatedAt: now,
    };
    await addSunoMusicVideoTask(scope.userScope, record);

    let upstreamSubmissionStarted = false;
    try {
        const storageKey = clip.storageKey || (await ensureSunoClipStorageKey(source.id, clip.id));
        assertUserScope(scope);
        const latestClip = sunoStudioSnapshot(scope.userScope)
            .jobs.find((job) => job.id === source.id)
            ?.clips.find((item) => item.id === clip.id);
        if (!latestClip) throw new Error("所选歌曲已从曲库中移除");
        const storedBlob = (await getMediaBlob(storageKey)) || (await getResourceBlob(storageKey));
        if (!storedBlob?.size) throw new Error("歌曲本地素材暂不可读，请先在曲库重新取回歌曲");
        const requestedDuration = musicVideoEffectiveDuration(input.duration, profile);
        const audioDuration = musicVideoAudioSegmentSeconds(requestedDuration, profile.references);
        const segment = await extractAudioSegment(storedBlob, input.audioStart, audioDuration);
        assertUserScope(scope);
        await updateSunoMusicVideoTask(scope.userScope, localId, { audioStart: segment.startSeconds, audioDuration: segment.durationMs / 1000 });
        const audioUrl = URL.createObjectURL(segment.blob);
        const audio: ReferenceAudio = {
            id: `suno-${source.id}-${clip.id}`,
            name: latestClip.title || source.label || "MV 歌曲参考音频",
            type: segment.blob.type,
            url: audioUrl,
            bytes: segment.blob.size,
            durationMs: segment.durationMs,
        };
        let task: VideoGenerationTask;
        try {
            upstreamSubmissionStarted = true;
            task = await createVideoGenerationTask(baseConfig, input.prompt.trim(), input.references, [], [audio], { videoEditOperation: input.references.length ? "reference_to_video" : undefined });
        } finally {
            URL.revokeObjectURL(audioUrl);
        }
        assertUserScope(scope);
        await updateSunoMusicVideoTask(scope.userScope, localId, { status: "queued", provider: task.provider, providerTaskId: task.id, syncError: undefined });
        return localId;
    } catch (error) {
        if (isUserScopeAbandonedError(error)) throw error;
        const message = error instanceof Error ? error.message : "MV 任务提交失败";
        await updateSunoMusicVideoTask(scope.userScope, localId, upstreamSubmissionStarted ? { status: "unknown", syncError: `提交结果未确认：${message}。请先核对上游任务，勿直接重复提交。` } : { status: "failed", error: message });
        throw error;
    }
}

async function extractAudioSegment(source: Blob, startSeconds: number, requestedSeconds: number) {
    const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("当前环境不支持音频裁取，请使用支持 Web Audio 的浏览器或桌面版本");
    const context = new AudioContextConstructor();
    try {
        const decoded = await context.decodeAudioData(await source.arrayBuffer());
        const range = musicVideoAudioRange(decoded.duration, startSeconds, requestedSeconds);
        const duration = range.durationSeconds;
        const start = range.startSeconds;
        if (duration <= 0) throw new Error("当前 MV 分段起点已超出歌曲时长");
        const frameCount = Math.max(1, Math.floor(duration * decoded.sampleRate));
        const channels = Math.min(decoded.numberOfChannels, 2);
        const data = Array.from({ length: channels }, (_, index) => decoded.getChannelData(index).slice(Math.floor(start * decoded.sampleRate), Math.floor(start * decoded.sampleRate) + frameCount));
        return { blob: encodeWave(data, decoded.sampleRate, frameCount), durationMs: Math.round((frameCount / decoded.sampleRate) * 1000), startSeconds: start };
    } finally {
        await context.close().catch(() => undefined);
    }
}

function encodeWave(channels: Float32Array[], sampleRate: number, frameCount: number) {
    const channelCount = channels.length;
    const bytesPerSample = 2;
    const dataBytes = frameCount * channelCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
    view.setUint16(32, channelCount * bytesPerSample, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, dataBytes, true);
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
        for (const channel of channels) {
            const sample = Math.max(-1, Math.min(1, channel[frame] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += bytesPerSample;
        }
    }
    return new Blob([buffer], { type: "audio/wav" });
}

export async function refreshSunoMusicVideo(id: string) {
    const scope = captureUserScope();
    const key = `${scope.userScope}:${id}`;
    const current = refreshes.get(key);
    if (current) return current;
    const pending = refreshTask(scope, id).finally(() => {
        if (refreshes.get(key) === pending) refreshes.delete(key);
    });
    refreshes.set(key, pending);
    return pending;
}

async function refreshTask(scope: ReturnType<typeof captureUserScope>, id: string) {
    const task = sunoStudioSnapshot(scope.userScope).musicVideos.find((item) => item.id === id);
    if (!task?.providerTaskId || !task.provider || !["queued", "running"].includes(task.status)) return;
    const key = `${scope.userScope}:${id}`;
    if ((retryAfter.get(key)?.at || 0) > Date.now()) return;
    try {
        assertUserScope(scope);
        const config = useConfigStore.getState().config;
        const channel = resolveModelChannel(config, task.model);
        if (channel.id !== task.channelId || channel.baseUrl.trim().replace(/\/+$/u, "") !== task.baseUrl) {
            await updateSunoMusicVideoTask(scope.userScope, id, { syncError: "模型渠道或地址已变更，已暂停自动查询以避免向错误渠道发送任务 ID" });
            return;
        }
        const videoTask: VideoGenerationTask = { id: task.providerTaskId, provider: task.provider as VideoGenerationTask["provider"], model: task.model };
        const state = await pollVideoGenerationTask({ ...config, model: task.model, videoModel: task.model }, videoTask);
        assertUserScope(scope);
        if (state.status === "pending") {
            retryAfter.set(key, { failures: 0, at: Date.now() + 5000 });
            await updateSunoMusicVideoTask(scope.userScope, id, { status: "running", syncError: undefined });
            return;
        }
        if (state.status === "failed") {
            retryAfter.delete(key);
            await updateSunoMusicVideoTask(scope.userScope, id, { status: "failed", error: state.error, syncError: undefined });
            return;
        }
        const result = state.result;
        if (result.blob) {
            const saved = await uploadMediaFile(result.blob, "video", undefined, scope);
            assertUserScope(scope);
            retryAfter.delete(key);
            const completedAt = new Date().toISOString();
            await updateSunoMusicVideoTask(scope.userScope, id, {
                status: "succeeded",
                completedAt,
                resultUrl: saved.url,
                storageKey: saved.storageKey,
                mimeType: saved.mimeType,
                bytes: saved.bytes,
                syncError: saved.pendingRemoteUpload ? "MV 已生成并保存在本机，工作区资源服务恢复后会同步" : undefined,
            });
            return;
        }
        if (!result.url) throw new Error("视频任务已完成，但没有可读取的结果地址");
        const ownedResourceId = ownedResourceIdFromMediaRef(undefined, result.url);
        retryAfter.delete(key);
        const completedAt = new Date().toISOString();
        await updateSunoMusicVideoTask(scope.userScope, id, {
            status: "succeeded",
            completedAt,
            resultUrl: result.url,
            storageKey: ownedResourceId ? resourceStorageKey(ownedResourceId) : undefined,
            mimeType: result.mimeType || "video/mp4",
            syncError: ownedResourceId ? undefined : "视频已生成；上游只返回临时链接，建议尽快下载保存。",
        });
    } catch (error) {
        if (isUserScopeAbandonedError(error)) throw error;
        const previous = retryAfter.get(key);
        const failures = (previous?.failures || 0) + 1;
        retryAfter.set(key, { failures, at: Date.now() + Math.min(5000 * 2 ** Math.min(failures, 4), 60_000) });
        await updateSunoMusicVideoTask(scope.userScope, id, { status: "running", syncError: `任务仍在保留，查询暂未成功：${error instanceof Error ? error.message : "网络错误"}。不会重新提交。` });
    }
}

export async function recoverSunoMusicVideos() {
    const scope = captureUserScope();
    const tasks = sunoStudioSnapshot(scope.userScope).musicVideos.filter((item) => item.providerTaskId && ["queued", "running"].includes(item.status));
    for (const task of tasks) {
        if (getActiveUserScope() !== scope.userScope) return;
        await refreshSunoMusicVideo(task.id).catch(() => undefined);
    }
}
