import { probeMediaDurationMs } from "@/lib/media-metadata";
import { resolveEditorMedia, type EditorMediaRef, type EditorSpeechSegment } from "@/lib/timeline/editor-media-analysis";
import type { ProjectAsset } from "@/services/api/projects";
import { readEditorMediaBlob } from "@/services/editor-media-analysis";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

type SourceOptions = {
    project: TimelineProject;
    assets: ProjectAsset[];
    nodes: Parameters<typeof resolveEditorMedia>[2];
    mode: "timeline" | "library";
    selectedAssetIds: string[];
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
};

export type DirectorSourceDependencies = {
    probeDuration: (ref: EditorMediaRef, kind: "video" | "audio", signal?: AbortSignal) => Promise<number | undefined>;
};

const dependencies: DirectorSourceDependencies = {
    probeDuration: async (ref, kind, signal) => {
        const blob = await readEditorMediaBlob(ref, kind, signal);
        signal?.throwIfAborted();
        return probeMediaDurationMs(new File([blob], `director-source.${kind === "video" ? "mp4" : "mp3"}`, { type: blob.type || `${kind}/${kind === "video" ? "mp4" : "mpeg"}` }));
    },
};

export async function prepareDirectorSources(options: SourceOptions, deps = dependencies): Promise<{ project: TimelineProject; warnings: string[] }> {
    const { project, assets, nodes, signal } = options;
    const warnings: string[] = [];
    const candidates: TimelineClip[] = options.mode === "timeline"
        ? project.clips.filter(clip => ["video", "image", "audio"].includes(clip.kind) && project.tracks.find(track => track.id === clip.trackId)?.visible !== false)
        : [...assets].filter(asset => options.selectedAssetIds.includes(asset.id) && ["video", "image", "audio"].includes(asset.mediaType)).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)).map(asset => ({
            id: `asset:${asset.id}`, nodeId: `asset:${asset.id}`, kind: asset.mediaType as "video" | "image" | "audio", trackId: `source-${asset.mediaType}`,
            title: asset.title, startMs: 0, durationMs: asset.mediaType === "image" ? 5000 : asset.durationMs || 0,
            sourceDurationMs: asset.mediaType === "image" ? undefined : asset.durationMs,
            directMedia: { id: asset.id, assetId: asset.id, kind: asset.mediaType as "video" | "image" | "audio", title: asset.title, storageKey: asset.storageKey },
        }));
    if (!candidates.length) throw new Error(options.mode === "library" ? "请先选择项目媒体库中的视频或图片素材。" : "当前时间线没有可剪辑素材，可切换到项目媒体库选择视频。" );
    const clips: TimelineClip[] = [];
    let cursor = 0;
    for (const candidate of candidates) {
        signal?.throwIfAborted();
        const ref = resolveEditorMedia(candidate, assets, nodes);
        if (!ref) {
            warnings.push(`${candidate.title || candidate.id} 缺少媒体文件，未纳入方案。`);
            continue;
        }
        let durationMs = candidate.durationMs;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            options.onProgress?.(`正在读取 ${candidate.title || candidate.id} 的真实时长…`);
            try {
                durationMs = candidate.kind === "image" ? 5000 : await deps.probeDuration(ref, candidate.kind as "video" | "audio", signal) || 0;
            } catch (error) {
                signal?.throwIfAborted();
                warnings.push(`${candidate.title || candidate.id} 时长读取失败：${error instanceof Error ? error.message : "无法解码"}`);
            }
        }
        signal?.throwIfAborted();
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            warnings.push(`${candidate.title || candidate.id} 没有可信时长，未按默认五秒裁切。`);
            continue;
        }
        const kind = candidate.kind as "video" | "audio" | "image";
        const clip: TimelineClip = {
            ...candidate, durationMs: Math.round(durationMs),
            startMs: options.mode === "timeline" ? candidate.startMs : kind === "audio" ? 0 : cursor,
            sourceDurationMs: candidate.sourceDurationMs || (kind !== "image" ? (candidate.sourceStartMs || 0) + Math.round(durationMs) : undefined),
            directMedia: { ...candidate.directMedia, id: candidate.directMedia?.id || candidate.nodeId, kind, title: candidate.title || candidate.directMedia?.title || candidate.id, storageKey: ref.storageKey, url: ref.url },
        };
        clips.push(clip);
        if (kind !== "audio") cursor += clip.durationMs;
    }
    if (!clips.some(clip => clip.kind === "video" || clip.kind === "image")) throw new Error(`没有可读取的视频或图片素材。${warnings.join("\n")}`);
    const tracks = options.mode === "timeline" ? project.tracks : ["video", "image", "audio"].map((kind, order) => ({ id: `source-${kind}`, kind: kind as "video" | "image" | "audio", order, label: kind }));
    return { project: { version: 2, tracks, clips, durationMs: clips.reduce((end, clip) => Math.max(end, clip.startMs + clip.durationMs), 0) }, warnings };
}

export function directorSpeechWithSubtitles(source: TimelineProject, original: TimelineProject, speech: Record<string, EditorSpeechSegment[]>): Record<string, EditorSpeechSegment[]> {
    const result = { ...speech };
    for (const clip of source.clips.filter(item => item.kind === "video")) {
        if (Object.hasOwn(result, clip.id)) continue;
        const matchingClip = original.clips.find(item => item.id === clip.id);
        if (!matchingClip) continue;
        const captions = original.clips.filter(item => item.kind === "subtitle" && item.text?.trim()
            && item.nodeId === matchingClip.nodeId
            && item.startMs >= matchingClip.startMs && item.startMs + item.durationMs <= matchingClip.startMs + matchingClip.durationMs);
        if (captions.length) result[clip.id] = captions.map(caption => ({
            startMs: (clip.sourceStartMs || 0) + caption.startMs - matchingClip.startMs,
            endMs: (clip.sourceStartMs || 0) + caption.startMs - matchingClip.startMs + caption.durationMs,
            text: caption.text!,
        }));
    }
    return result;
}
