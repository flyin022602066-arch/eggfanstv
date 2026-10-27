import { describe, expect, test } from "bun:test";
import { planEditorFrames, resolveEditorMedia, editorSubtitleContext, mapEditorTranscript, summarizeEditorAudio } from "@/lib/timeline/editor-media-analysis";
import type { TimelineProject, TimelineClip } from "@/types/timeline";

const clip: TimelineClip = { id: "clip-a", nodeId: "asset:asset-a", kind: "video", trackId: "video", startMs: 5000, sourceStartMs: 30000, durationMs: 10000 };
const project: TimelineProject = { version: 2, durationMs: 15000, tracks: [{ id: "video", kind: "video", order: 0, label: "视频" }], clips: [clip] };

describe("editor media analysis", () => {
    test("samples the trimmed source and maps frames to timeline milliseconds", () => {
        const frames = planEditorFrames(project, 3);
        expect(frames.map(frame => frame.sourceMs)).toEqual([30000, 34950, 39900]);
        expect(frames.map(frame => frame.timelineMs)).toEqual([5000, 9950, 14900]);
    });
    test("shares a strict frame budget across clips and reports unsampled clips", () => {
        const many = { ...project, clips: Array.from({ length: 20 }, (_, index) => ({ ...clip, id: `clip-${index}`, startMs: index * 10000 })) };
        const frames = planEditorFrames(many, 12);
        expect(frames).toHaveLength(12);
        expect(new Set(frames.map(frame => frame.clipId)).size).toBe(12);
        expect(planEditorFrames(project, 0)).toEqual([]);
    });
    test("resolves assets by identity, never by a matching title", () => {
        const assets = [{ id: "asset-a", storageKey: "resource:real" }, { id: "other", title: "asset-a", storageKey: "resource:wrong" }];
        expect(resolveEditorMedia(clip, assets, [])?.storageKey).toBe("resource:real");
        expect(resolveEditorMedia({ ...clip, nodeId: "missing" }, assets, [])).toBeNull();
    });
    test("resolves canvas media and preserves direct-media precedence", () => {
        const nodes = [{ id: "canvas-a", type: "video", metadata: { storageKey: "resource:canvas" } }];
        expect(resolveEditorMedia({ ...clip, nodeId: "canvas-a" }, [], nodes)?.storageKey).toBe("resource:canvas");
        expect(resolveEditorMedia({ ...clip, directMedia: { id: "direct", title: "direct", kind: "video", url: "data:video/mp4;base64,AA==" } }, [], nodes)?.url).toContain("data:video");
    });
    test("includes complete subtitle text rather than the short title", () => {
        const sentence = "这是一条超过二十四个字符的真实字幕，助手必须看到后半句才能理解剪辑内容。";
        const result = editorSubtitleContext({ ...project, clips: [{ ...clip, id: "subtitle", kind: "subtitle", text: sentence }] });
        expect(result).toContain(sentence);
        expect(result).toContain("5000-15000ms");
    });
    test("clips transcribed speech to the actual source range", () => {
        const result = mapEditorTranscript(clip, [{ startMs: 0, endMs: 2000, text: "未使用" }, { startMs: 29000, endMs: 32000, text: "保留语音" }, { startMs: 39000, endMs: 42000, text: "尾部" }]);
        expect(result).toEqual([{ startMs: 5000, endMs: 7000, text: "保留语音" }, { startMs: 14000, endMs: 15000, text: "尾部" }]);
    });
    test("detects silence only within the trimmed source interval", () => {
        const samples = Float32Array.from({ length: 4000 }, (_, index) => index < 2000 ? 0 : 0.25);
        const result = summarizeEditorAudio([samples], 1000, { ...clip, sourceStartMs: 1000, durationMs: 2000 });
        expect(result.silence).toEqual([{ startMs: 5000, endMs: 6000 }]);
        expect(result.peak).toBeCloseTo(0.25);
    });
});
