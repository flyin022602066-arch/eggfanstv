import { describe, expect, test } from "bun:test";
import { canvasSunoClipForNode, collectCanvasSunoSources, resolveCanvasSunoPreferredChannelId } from "../src/lib/canvas/canvas-suno-context";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import type { SunoStudioClip, SunoStudioJob } from "../src/stores/use-suno-studio-store";

function createNode(id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id, type, title: id, position: { x: 10, y: 20 }, width: 320, height: 180, metadata } as CanvasNodeData;
}

function createClip(id = "clip-1"): SunoStudioClip {
    return { id, title: "Generated track", audioUrl: "https://media.invalid/track.mp3", storageKey: "asset://track", mimeType: "audio/mpeg" } as SunoStudioClip;
}

function createJob(channelId: string, clip: SunoStudioClip, taskId = "task-1"): SunoStudioJob {
    return { id: "job-1", channelId, taskId, status: "succeeded", values: {}, clips: [clip] } as SunoStudioJob;
}

describe("canvas Suno context", () => {
    test("collects only directed incoming text and Suno audio sources", () => {
        const lyric = createNode("lyric", CanvasNodeType.Text, { content: "Original lyrics" });
        const audio = createNode("audio", CanvasNodeType.Audio, { source: "suno", sunoClipId: "clip-1", content: "https://media.invalid/track.mp3" } as CanvasNodeData["metadata"]);
        const output = createNode("output", CanvasNodeType.Text, { content: "not an input" });
        const unrelated = createNode("other", CanvasNodeType.Audio, { source: "suno", sunoClipId: "other-clip" } as CanvasNodeData["metadata"]);
        const current = createNode("current", CanvasNodeType.Audio, { sunoChannelId: "preferred-channel" } as CanvasNodeData["metadata"]);
        const connections: CanvasConnection[] = [
            { id: "incoming-text", fromNodeId: lyric.id, toNodeId: current.id },
            { id: "outgoing", fromNodeId: current.id, toNodeId: output.id },
            { id: "unrelated", fromNodeId: unrelated.id, toNodeId: output.id },
        ];

        const sources = collectCanvasSunoSources(current.id, [lyric, audio, output, unrelated, current], connections, []);

        expect(sources.textSources).toEqual([{ id: lyric.id, title: lyric.title, text: "Original lyrics" }]);
        expect(sources.audioSources.map((source) => source.id)).toEqual([current.id]);
        expect(collectCanvasSunoSources(lyric.id, [lyric, audio, output, unrelated, current], [
            { id: "audio-input", fromNodeId: audio.id, toNodeId: lyric.id },
        ], []).audioSources.map((source) => source.id)).toEqual([audio.id]);
        expect(collectCanvasSunoSources(lyric.id, [lyric, audio, output, unrelated, current], connections, []).textSources).toEqual([
            { id: lyric.id, title: lyric.title, text: "Original lyrics" },
        ]);
    });

    test("prefers persisted channel then logical Suno model channel", () => {
        const node = createNode("audio", CanvasNodeType.Audio, {
            sunoChannelId: "stored-channel",
            model: "logical-channel::suno-v4",
        } as CanvasNodeData["metadata"]);

        expect(resolveCanvasSunoPreferredChannelId(node, [])).toBe("stored-channel");
        expect(resolveCanvasSunoPreferredChannelId({
            ...node,
            metadata: { model: "logical-channel::suno-v4" },
        }, [])).toBe("logical-channel");
    });

    test("returns imported Suno source channel and matched clip metadata", () => {
        const clip = createClip();
        const job = createJob("job-channel", clip);
        const imported = createNode("imported", CanvasNodeType.Audio, {
            source: "suno",
            channelId: "asset-channel",
            sunoClipId: clip.id,
            content: clip.audioUrl,
        } as CanvasNodeData["metadata"]);
        const sources = collectCanvasSunoSources(imported.id, [imported], [], [job]);

        expect(sources.audioSources[0]).toMatchObject({ id: imported.id, channelId: "asset-channel", taskId: job.taskId });
        expect(sources.audioSources[0]?.clips[0]).toMatchObject({ id: clip.id, storageKey: clip.storageKey });
    });

    test("writes any returned clip and its job identifiers into node metadata", () => {
        const node = createNode("audio", CanvasNodeType.Audio, { content: "old media" });
        const clip = createClip("different-job-clip");
        const job = createJob("return-channel", clip, "return-task");

        const updated = canvasSunoClipForNode(node, job, clip);

        expect(updated.metadata).toMatchObject({
            sunoTaskId: "return-task",
            sunoChannelId: "return-channel",
            storageKey: clip.storageKey,
            sunoClips: [{ clipId: clip.id, storageKey: clip.storageKey }],
        });
    });
});
