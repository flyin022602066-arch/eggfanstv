import { isSunoModel } from "@/lib/suno-generation";
import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

type SunoCanvasNodeMetadata = CanvasNodeMetadata & {
    sunoChannelId?: string;
    sunoClipId?: string;
    source?: string;
    channelId?: string;
};

type StoredSunoClip = NonNullable<CanvasNodeMetadata["sunoClips"]>[number];

export function collectCanvasSunoSources(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], jobs: SunoStudioJob[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const currentNode = nodeById.get(nodeId);
    if (!currentNode) return { textSources: [], audioSources: [] };

    const connectedNodes = connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodeById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node));
    const sourceNodes = [currentNode, ...connectedNodes.filter((node) => node.id !== currentNode.id)];
    const textSources = sourceNodes
        .filter((node) => node.type === CanvasNodeType.Text)
        .map((node) => ({ id: node.id, title: node.title, text: node.metadata?.content || "" }));
    const audioSources = sourceNodes
        .filter((node) => node.type === CanvasNodeType.Audio)
        .map((node) => audioSourceForNode(node, jobs))
        .filter((source): source is NonNullable<typeof source> => Boolean(source));

    return { textSources, audioSources };
}

export function resolveCanvasSunoPreferredChannelId(node: CanvasNodeData, jobs: SunoStudioJob[]) {
    const metadata = (node.metadata || {}) as SunoCanvasNodeMetadata;
    const modelChannelId = channelIdFromSunoModel(metadata.model);
    const clipIds = [...(metadata.sunoClips || []).map((clip) => clip.clipId), metadata.sunoClipId].filter((id): id is string => Boolean(id));
    const matchedJob = clipIds.map((clipId) => findJobClip(jobs, clipId, metadata.sunoTaskId)).find(Boolean)?.job;
    const taskJob = metadata.sunoTaskId ? jobs.find((job) => job.taskId === metadata.sunoTaskId || job.taskIds?.includes(metadata.sunoTaskId!)) : undefined;

    return metadata.sunoChannelId
        || modelChannelId
        || (metadata.source === "suno" ? metadata.channelId : undefined)
        || matchedJob?.channelId
        || taskJob?.channelId;
}

function audioSourceForNode(node: CanvasNodeData, jobs: SunoStudioJob[]) {
    const metadata = (node.metadata || {}) as SunoCanvasNodeMetadata;
    const storedClips = [...(metadata.sunoClips || [])];
    if (metadata.sunoClipId && !storedClips.some((clip) => clip.clipId === metadata.sunoClipId)) {
        storedClips.push({ clipId: metadata.sunoClipId, title: node.title, url: metadata.content, storageKey: metadata.storageKey, mimeType: metadata.mimeType });
    }
    const taskJob = metadata.sunoTaskId ? jobs.find((job) => job.taskId === metadata.sunoTaskId || job.taskIds?.includes(metadata.sunoTaskId!)) : undefined;
    const storedMatches = storedClips.map((stored) => ({ stored, match: findJobClip(jobs, stored.clipId, metadata.sunoTaskId) }));
    const modelChannelId = channelIdFromSunoModel(metadata.model);
    const sourceIsSuno = metadata.source === "suno" || Boolean(metadata.sunoChannelId || metadata.sunoTaskId || metadata.sunoClipId || storedClips.length || modelChannelId);
    if (!sourceIsSuno) return null;

    const clipsById = new Map<string, SunoStudioClip>();
    for (const { stored, match } of storedMatches) {
        const id = stored.clipId || match?.clip.id;
        if (!id) continue;
        const clip = match?.clip;
        clipsById.set(id, {
            ...clip,
            id,
            title: stored.title || clip?.title || node.title,
            audioUrl: stored.url || clip?.audioUrl,
            storageKey: stored.storageKey || clip?.storageKey,
            imageUrl: clip?.imageUrl,
            videoUrl: clip?.videoUrl,
            duration: clip?.duration,
            lyrics: clip?.lyrics,
            tags: clip?.tags,
            assetId: clip?.assetId,
        });
    }
    if (!clipsById.size && taskJob) {
        for (const clip of taskJob.clips) clipsById.set(clip.id, clip);
    }
    const matchedJob = storedMatches.find((item) => item.match)?.match?.job || taskJob;

    return {
        id: node.id,
        title: node.title,
        channelId: resolveCanvasSunoPreferredChannelId(node, jobs) || matchedJob?.channelId,
        taskId: metadata.sunoTaskId || matchedJob?.taskId,
        clips: [...clipsById.values()],
    };
}

function channelIdFromSunoModel(model?: string) {
    const separator = model?.indexOf("::") ?? -1;
    if (separator <= 0 || !isSunoModel(model?.slice(separator + 2))) return undefined;
    return model?.slice(0, separator);
}

function findJobClip(jobs: SunoStudioJob[], clipId?: string, taskId?: string) {
    if (!clipId) return undefined;
    for (const job of jobs) {
        if (taskId && job.taskId !== taskId && !job.taskIds?.includes(taskId)) continue;
        const clip = job.clips.find((candidate) => candidate.id === clipId);
        if (clip) return { job, clip };
    }
    return undefined;
}

export function canvasSunoClipMetadata(job: SunoStudioJob, clip: SunoStudioClip, current: CanvasNodeMetadata = {}): CanvasNodeMetadata {
    const storedClip: StoredSunoClip = {
        clipId: clip.id,
        title: clip.title,
        url: clip.audioUrl || clip.videoUrl,
        storageKey: clip.storageKey,
        mimeType: clip.videoUrl && !clip.audioUrl ? "video/mp4" : "audio/mpeg",
    };
    const clips = [...(current.sunoClips || []).filter((item) => item.clipId !== clip.id), storedClip];
    const next = {
        ...current,
        content: clip.audioUrl || clip.videoUrl || current.content,
        storageKey: clip.storageKey || current.storageKey,
        mimeType: current.mimeType || storedClip.mimeType,
        durationMs: clip.duration ? Math.round(clip.duration * 1000) : current.durationMs,
        sunoTaskId: job.taskId || current.sunoTaskId,
        sunoClips: clips,
    } as CanvasNodeMetadata & { sunoChannelId?: string };
    next.sunoChannelId = job.channelId || (current as SunoCanvasNodeMetadata).sunoChannelId;
    return next;
}

export function canvasSunoClipForNode(node: CanvasNodeData, job: SunoStudioJob, clip: SunoStudioClip) {
    return {
        ...node,
        metadata: {
            ...canvasSunoClipMetadata(job, clip, node.metadata),
            status: "success" as const,
        },
    };
}

export function sunoClipStoredMetadata(clip: SunoStudioClip): StoredSunoClip {
    return {
        clipId: clip.id,
        title: clip.title,
        url: clip.audioUrl || clip.videoUrl,
        storageKey: clip.storageKey,
        mimeType: clip.videoUrl && !clip.audioUrl ? "video/mp4" : "audio/mpeg",
    };
}
