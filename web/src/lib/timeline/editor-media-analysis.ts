import type { TimelineClip, TimelineProject } from "@/types/timeline";

export type EditorFrameSample = { clipId: string; sourceMs: number; timelineMs: number };
export type EditorMediaRef = { storageKey?: string; url?: string; version?: string };
type AssetRef = { id: string; storageKey?: string; updatedAt?: string };
type NodeRef = { id: string; metadata?: { storageKey?: string; content?: string } };

export function resolveEditorMedia(clip: TimelineClip, assets: AssetRef[], nodes: NodeRef[]): EditorMediaRef | null {
    const direct = clip.directMedia;
    if (direct?.storageKey || direct?.url || direct?.dataUrl) return { storageKey: direct.storageKey, url: direct.dataUrl || direct.url };
    const assetId = direct?.assetId || direct?.id || (clip.nodeId.startsWith("asset:") ? clip.nodeId.slice(6) : clip.nodeId);
    const asset = assets.find(item => item.id === assetId);
    if (asset?.storageKey) return { storageKey: asset.storageKey, version: asset.updatedAt };
    const node = nodes.find(item => item.id === clip.nodeId);
    if (node?.metadata?.storageKey || node?.metadata?.content) return { storageKey: node.metadata.storageKey, url: node.metadata.content };
    return null;
}

export function planEditorFrames(project: TimelineProject, maxImages: number): EditorFrameSample[] {
    const clips = project.clips.filter(clip => (clip.kind === "video" || clip.kind === "image") && clip.durationMs > 0).sort((left, right) => left.startMs - right.startMs);
    const budget = Math.max(0, Math.min(24, Math.floor(maxImages)));
    const counts: number[] = clips.map((_, index) => index < budget ? 1 : 0);
    let remaining = budget - counts.reduce((sum, count) => sum + count, 0);
    while (remaining > 0) {
        let allocated = false;
        for (let index = 0; index < clips.length && remaining > 0; index++) {
            if (clips[index].kind !== "video" || !counts[index] || counts[index] >= 12) continue;
            counts[index]++;
            remaining--;
            allocated = true;
        }
        if (!allocated) break;
    }
    return clips.flatMap((clip, index) => Array.from({ length: counts[index] }, (_, frameIndex) => {
        const offset = counts[index] === 1 ? Math.floor(clip.durationMs / 2) : Math.round(Math.max(0, clip.durationMs - 100) * frameIndex / (counts[index] - 1));
        return { clipId: clip.id, sourceMs: (clip.sourceStartMs || 0) + offset, timelineMs: clip.startMs + offset };
    }));
}

export function editorSubtitleContext(project: TimelineProject, maxChars = 12000): string {
    const lines = project.clips.filter(clip => clip.kind === "subtitle" || clip.kind === "text").sort((left, right) => left.startMs - right.startMs)
        .map(clip => `clip ${clip.id} | ${clip.startMs}-${clip.startMs + clip.durationMs}ms | ${clip.text || clip.directMedia?.content || clip.title || ""}`);
    const result = lines.join("\n");
    return result.length > maxChars ? `${result.slice(0, maxChars)}\n[其余字幕因上下文预算省略]` : result;
}

export type EditorSpeechSegment = { startMs: number; endMs: number; text: string };
export function mapEditorTranscript(clip: TimelineClip, segments: EditorSpeechSegment[]): EditorSpeechSegment[] {
    const start = clip.sourceStartMs || 0;
    return segments.filter(segment => segment.endMs > start && segment.startMs < start + clip.durationMs && segment.text.trim())
        .map(segment => ({ startMs: clip.startMs + Math.max(0, segment.startMs - start), endMs: clip.startMs + Math.min(clip.durationMs, segment.endMs - start), text: segment.text }));
}

export function summarizeEditorAudio(channels: Float32Array[], sampleRate: number, clip: TimelineClip) {
    const silence: Array<{ startMs: number; endMs: number }> = [];
    const start = Math.floor((clip.sourceStartMs || 0) * sampleRate / 1000);
    const end = Math.min(channels[0]?.length || 0, start + Math.floor(clip.durationMs * sampleRate / 1000));
    let peak = 0;
    let silentStart: number | null = null;
    const windowSize = Math.max(1, Math.floor(sampleRate / 4));
    for (let offset = start; offset < end; offset += windowSize) {
        const windowEnd = Math.min(end, offset + windowSize);
        let squares = 0;
        for (const channel of channels) {
            for (let index = offset; index < windowEnd; index++) {
                const value = channel[index] || 0;
                peak = Math.max(peak, Math.abs(value));
                squares += value * value;
            }
        }
        const rms = Math.sqrt(squares / Math.max(1, (windowEnd - offset) * channels.length));
        if (rms < 0.01 && silentStart === null) silentStart = offset;
        if ((rms >= 0.01 || windowEnd === end) && silentStart !== null) {
            const silentEnd = rms >= 0.01 ? offset : windowEnd;
            if ((silentEnd - silentStart) / sampleRate >= 0.75) silence.push({ startMs: clip.startMs + Math.round((silentStart - start) * 1000 / sampleRate), endMs: clip.startMs + Math.round((silentEnd - start) * 1000 / sampleRate) });
            silentStart = null;
        }
    }
    return { peak, silence };
}
