import localforage from "localforage";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { captureVideoFrames } from "@/lib/canvas/canvas-video-frame";
import { editorSubtitleContext, mapEditorTranscript, planEditorFrames, resolveEditorMedia, summarizeEditorAudio, type EditorMediaRef, type EditorSpeechSegment } from "@/lib/timeline/editor-media-analysis";
import { getActiveUserScope } from "@/lib/user-scope";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { cancelGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { createTimelineTranscriptionTask, type TimelineTranscriptionResult } from "@/services/api/timeline-tasks";
import type { AiTextContentPart } from "@/services/api/image-contracts";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

type AnalysisOptions = {
    project: TimelineProject; projectId: string;
    assets: Parameters<typeof resolveEditorMedia>[1]; nodes: Parameters<typeof resolveEditorMedia>[2];
    config: Parameters<typeof modelCapabilityConfigFor>[0]; model: string;
    vision: boolean; transcribe: boolean; transcriptTimebase?: "source" | "timeline"; signal?: AbortSignal; onProgress?: (message: string) => void;
};
export type EditorAnalysisDependencies = {
    readBlob: (ref: EditorMediaRef, kind: string, signal?: AbortSignal) => Promise<Blob>;
    captureFrames: typeof captureVideoFrames;
    encodeImage: (blob: Blob, limit: number, signal?: AbortSignal) => Promise<string>;
    analyzeAudio: (blob: Blob, clip: TimelineClip, signal?: AbortSignal) => Promise<ReturnType<typeof summarizeEditorAudio>>;
    transcribe: (ref: EditorMediaRef, projectId: string, signal?: AbortSignal, progress?: (message: string) => void) => Promise<EditorSpeechSegment[]>;
};
const analysisCache = localforage.createInstance({ name: "infinite-canvas", storeName: "editor_media_analysis" });

function waitForAnalysis<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return operation;
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || new DOMException("已停止分析", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
    });
}

export async function prepareEditorAnalysis(options: AnalysisOptions, dependencies: EditorAnalysisDependencies = defaultDependencies) {
    const { project, vision, transcribe, signal, onProgress } = options;
    signal?.throwIfAborted();
    const references = modelCapabilityConfigFor(options.config, options.model).text!.references;
    const visualClips = project.clips.filter(clip => clip.kind === "image" || clip.kind === "video");
    if (vision && visualClips.length && (!references.maxImages || !references.maxImageBytes)) throw new Error("当前模型尚未开启看图能力。请在模型配置的「能力与参数」设置参考图片数量和大小，或关闭画面分析只操作时间线。开启前请确认上游模型支持图片输入。");
    const samples = vision ? planEditorFrames(project, Math.min(24, references.maxImages)) : [];
    const parts: AiTextContentPart[] = [];
    const notes: string[] = [];
    const subtitles = editorSubtitleContext(project);
    if (subtitles) parts.push({ type: "text", text: `时间线字幕/文字（完整文本，可能为用户编辑字幕，不等于已识别声音）：\n${subtitles}` });
    const budgetPerImage = Math.min(256 * 1024, Math.floor(3 * 1024 * 1024 / Math.max(1, samples.length)), Math.floor(references.maxImageBytes * 4 / 3));
    let frameCount = 0;
    let audioCount = 0;
    let speechCount = 0;
    const speech: Record<string, EditorSpeechSegment[]> = {};
    let frameFailures = 0;
    const failures: string[] = [];
    const mediaClips = project.clips.filter(clip => ["image", "video", "audio"].includes(clip.kind));
    for (const clip of mediaClips) {
        signal?.throwIfAborted();
        const frames = samples.filter(sample => sample.clipId === clip.id);
        if (!frames.length && clip.kind === "image") continue;
        const ref = resolveEditorMedia(clip, options.assets, options.nodes);
        if (!ref) { failures.push(`clip ${clip.id}：缺少可读取的媒体引用`); continue; }
        onProgress?.(`正在读取 ${clip.title || clip.directMedia?.title || clip.id}…`);
        let blob: Blob;
        try { blob = await waitForAnalysis(dependencies.readBlob(ref, clip.kind, signal), signal); }
        catch (error) { signal?.throwIfAborted(); failures.push(`clip ${clip.id}：${error instanceof Error ? error.message : "读取失败"}`); continue; }
        signal?.throwIfAborted();
        if (frames.length) {
            try {
                const captured = clip.kind === "image" ? { frames: [{ timeMs: frames[0].sourceMs, blob }], failures: [] }
                    : await waitForAnalysis(dependencies.captureFrames(blob, frames.map(frame => frame.sourceMs), { signal, maxDimension: 960, jpeg: true }), signal);
                frameFailures += captured.failures.length;
                for (const frame of captured.frames) {
                    signal?.throwIfAborted();
                    const preview = await waitForAnalysis(dependencies.encodeImage(frame.blob, budgetPerImage, signal), signal);
                    if (preview.length > budgetPerImage) throw new Error("画面超过模型图片大小限制");
                    parts.push({ type: "text", text: `采样画面 ${++frameCount} | clip ${clip.id} | 源时间 ${frame.timeMs}ms | 时间线 ${clip.startMs + frame.timeMs - (clip.sourceStartMs || 0)}ms` });
                    parts.push({ type: "image_url", image_url: { url: preview } });
                }
                notes.push(`clip ${clip.id}：${captured.frames.length} 张${clip.kind === "video" ? "采样关键帧（非完整视频）" : "原图分析副本"}`);
            } catch (error) { signal?.throwIfAborted(); failures.push(`clip ${clip.id} 画面：${error instanceof Error ? error.message : "提取失败"}`); }
        }
        if (clip.kind !== "image") {
            try {
                onProgress?.(`正在本地分析 ${clip.id} 的音量和静音段…`);
                const audio = await waitForAnalysis(dependencies.analyzeAudio(blob, clip, signal), signal);
                parts.push({ type: "text", text: `clip ${clip.id} 本地音量检测：峰值 ${audio.peak.toFixed(3)}；静音候选（仅音量低于阈值，不等于无对白）：${JSON.stringify(audio.silence.slice(0, 40))}。轨道静音=${Boolean(project.tracks.find(track => track.id === clip.trackId)?.muted)}。` });
                audioCount++;
            } catch (error) { signal?.throwIfAborted(); notes.push(`clip ${clip.id} 音量未分析：${error instanceof Error ? error.message : "音轨无法解码"}`); }
            if (transcribe) {
                try {
                    onProgress?.(`正在本地转写 ${clip.id} 的语音…`);
                    const sourceSegments = await waitForAnalysis(dependencies.transcribe(ref, options.projectId, signal, onProgress), signal);
                    speech[clip.id] = sourceSegments;
                    const segments = options.transcriptTimebase === "source" ? sourceSegments : mapEditorTranscript(clip, sourceSegments);
                    parts.push({ type: "text", text: `clip ${clip.id} 语音转写（${options.transcriptTimebase === "source" ? "源文件绝对" : "时间线"}毫秒，自动识别可能有误）：\n${segments.map(segment => `${segment.startMs}-${segment.endMs}ms | ${segment.text}`).join("\n").slice(0, 12000) || "未识别到对白"}` });
                    speechCount++;
                } catch (error) { signal?.throwIfAborted(); notes.push(`clip ${clip.id} 语音未分析：${error instanceof Error ? error.message : "转写失败"}`); }
            }
        }
    }
    signal?.throwIfAborted();
    if (vision && samples.length && !frameCount) throw new Error(`素材画面分析失败，未发送模型请求：${failures.join("；") || "没有可读取的画面"}`);
    if (!vision) notes.push("画面分析已关闭：仅提供时间线和文字，未查看画面");
    const unsampled = visualClips.filter(clip => !samples.some(sample => sample.clipId === clip.id));
    if (vision && unsampled.length) notes.push(`图片预算不足，未采样片段：${unsampled.map(clip => clip.id).join("、")}`);
    if (!speechCount) notes.push("未理解声音语义：未取得语音转写，不得声称已听懂对白、音乐或情绪");
    if (frameFailures) notes.push(`${frameFailures} 个采样点提取失败`);
    const report = [`画面 ${frameCount} 张 · 音量分析 ${audioCount} 段 · 语音转写 ${speechCount} 段`, ...notes, ...failures].join("\n");
    parts.unshift({ type: "text", text: `素材分析覆盖范围：\n${report}` });
    return { parts, report, speech };
}

export async function readEditorMediaBlob(ref: EditorMediaRef, kind: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (ref.storageKey) {
        const blob = await waitForAnalysis(kind === "image" ? getImageBlob(ref.storageKey) : getMediaBlob(ref.storageKey), signal);
        signal?.throwIfAborted();
        if (blob?.size) return blob;
        if (!ref.url) throw new Error("本地媒体不可读取或已被删除，请重新导入");
    }
    if (!ref.url) throw new Error("没有可读取的媒体地址");
    const response = await fetch(ref.url, { signal, credentials: "same-origin" });
    if (!response.ok) throw new Error(`媒体读取失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("媒体文件为空");
    return blob;
}

async function encodeImage(blob: Blob, limit: number, signal?: AbortSignal) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const canvas = document.createElement("canvas");
    try {
        image.src = url;
        await waitForAnalysis(image.decode(), signal);
        signal?.throwIfAborted();
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画面分析副本");
        let edge = Math.min(960, Math.max(image.naturalWidth, image.naturalHeight));
        while (edge >= 64) {
            const scale = edge / Math.max(image.naturalWidth, image.naturalHeight);
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const result = canvas.toDataURL("image/jpeg", 0.8);
            if (result.length <= limit) return result;
            edge = Math.floor(edge * 0.75);
        }
        throw new Error("模型图片大小限制过小，请调整能力参数");
    } finally { image.src = ""; canvas.width = canvas.height = 0; URL.revokeObjectURL(url); }
}

async function analyzeAudio(blob: Blob, clip: TimelineClip, signal?: AbortSignal) {
    if (blob.size > 128 * 1024 * 1024 || clip.durationMs > 12 * 60 * 1000) throw new Error("素材超过本地音量分析预算，可使用本地转写或拆分片段");
    const context = new AudioContext();
    try {
        const audio = await waitForAnalysis(context.decodeAudioData(await waitForAnalysis(blob.arrayBuffer(), signal)), signal);
        signal?.throwIfAborted();
        return summarizeEditorAudio(Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)), audio.sampleRate, clip);
    } finally { await context.close(); }
}

async function transcribe(ref: EditorMediaRef, projectId: string, signal?: AbortSignal, progress?: (message: string) => void) {
    const resourceId = resourceIdFromStorageKey(ref.storageKey);
    if (!resourceId) throw new Error("语音转写需要已保存到本地资源库的音视频");
    const scope = getActiveUserScope();
    const key = JSON.stringify([scope, projectId, resourceId, ref.version || ""]);
    const cached = await waitForAnalysis(analysisCache.getItem<EditorSpeechSegment[]>(key).catch(() => null), signal);
    signal?.throwIfAborted();
    if (cached) return cached;
    const task = await createTimelineTranscriptionTask({ resourceId, projectId }, { signal });
    const cancel = () => { void cancelGenerationTask(task.id).catch(() => undefined); };
    signal?.addEventListener("abort", cancel, { once: true });
    let completed = false;
    try {
        if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
        const done = await waitForGenerationTask(task.id, { signal, timeoutMs: 25 * 60 * 1000, intervalMs: 2000, onTaskUpdate: value => progress?.(value.stage || "正在本地转写…") });
        completed = true;
        const result = JSON.parse(done.resultJson || "{}") as TimelineTranscriptionResult;
        if (!Array.isArray(result.segments) || result.segments.some(segment => !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || typeof segment.text !== "string")) throw new Error("本地转写返回无效字幕");
        if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
        await analysisCache.setItem(key, result.segments).catch(() => undefined);
        return result.segments;
    } finally { signal?.removeEventListener("abort", cancel); if (!completed) cancel(); }
}
const defaultDependencies: EditorAnalysisDependencies = { readBlob: readEditorMediaBlob, captureFrames: captureVideoFrames, encodeImage, analyzeAudio, transcribe };
