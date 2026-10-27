import { expect, test } from "bun:test";
import { directorSpeechWithSubtitles, prepareDirectorSources } from "@/services/editor-director-sources";
import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";

const empty: TimelineProject = { version: 2, tracks: [], clips: [], durationMs: 0 };
const asset = (id: string, position: number, durationMs?: number): ProjectAsset => ({ id, position, durationMs, title: id, mediaType: "video", category: "scene", status: "ready", versionCount: 1, usages: [], updatedAt: "version-a", storageKey: `resource:${id}` });
const probe = { probeDuration: async () => 12000 };

test("a director can assemble selected project media without first changing the empty timeline", async () => {
    const result = await prepareDirectorSources({ project: empty, assets: [asset("later", 2, 9000), asset("first", 1, 7000), asset("unused", 3, 8000)], nodes: [], mode: "library", selectedAssetIds: ["later", "first"] }, probe);
    expect(result.project.clips.map(clip => [clip.id, clip.startMs, clip.durationMs])).toEqual([["asset:first", 0, 7000], ["asset:later", 7000, 9000]]);
    expect(result.project.clips[0].sourceDurationMs).toBe(7000);
    expect(empty.clips).toEqual([]);
});

test("missing durations are probed rather than silently limited to five seconds", async () => {
    const result = await prepareDirectorSources({ project: empty, assets: [asset("unknown", 1)], nodes: [], mode: "library", selectedAssetIds: ["unknown"] }, probe);
    expect(result.project.clips[0].durationMs).toBe(12000);
    expect(result.project.clips[0].sourceDurationMs).toBe(12000);
    await expect(prepareDirectorSources({ project: empty, assets: [asset("unknown", 1)], nodes: [], mode: "library", selectedAssetIds: ["unknown"] }, { probeDuration: async () => undefined })).rejects.toThrow("没有可信时长");
});

test("canvas reference sources acquire exportable direct media and keep trimmed source bounds", async () => {
    const original: TimelineProject = { ...empty, tracks: [{ id: "video", kind: "video", order: 0, label: "video" }], clips: [{ id: "clip", kind: "video", nodeId: "canvas", trackId: "video", startMs: 4000, durationMs: 8000, sourceStartMs: 20000, sourceDurationMs: 40000 }] };
    const result = await prepareDirectorSources({ project: original, assets: [], nodes: [{ id: "canvas", metadata: { storageKey: "resource:actual" } }], mode: "timeline", selectedAssetIds: [] }, probe);
    expect(result.project.clips[0]).toMatchObject({ sourceStartMs: 20000, sourceDurationMs: 40000, durationMs: 8000, directMedia: { storageKey: "resource:actual" } });
    expect(original.clips[0].directMedia).toBeUndefined();
});

test("existing subtitles map by source identity and successful empty speech remains authoritative", () => {
    const source: TimelineProject = { ...empty, clips: [{ id: "clip", kind: "video", trackId: "v", nodeId: "node", startMs: 4000, sourceStartMs: 20000, durationMs: 8000 }] };
    const original: TimelineProject = { ...source, clips: [...source.clips, { id: "caption", kind: "subtitle", trackId: "s", nodeId: "node", startMs: 5000, durationMs: 2000, text: "完整对白" }, { id: "unrelated", kind: "subtitle", trackId: "s", nodeId: "other", startMs: 5000, durationMs: 1000, text: "其他素材" }] };
    expect(directorSpeechWithSubtitles(source, original, {})).toEqual({ clip: [{ startMs: 21000, endMs: 23000, text: "完整对白" }] });
    expect(directorSpeechWithSubtitles(source, original, { clip: [] })).toEqual({ clip: [] });
});

test("cancelled source preparation cannot return a plan", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareDirectorSources({ project: empty, assets: [asset("a", 1, 10000)], nodes: [], mode: "library", selectedAssetIds: ["a"], signal: controller.signal }, probe)).rejects.toThrow();
});
