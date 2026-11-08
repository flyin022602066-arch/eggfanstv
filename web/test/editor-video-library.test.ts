import { describe, expect, test } from "bun:test";

import { buildEditorVideoGroups, createVideoAppendCommands } from "@/lib/timeline/editor-video-library";
import { createEditorStore } from "@/stores/editor/editor-store";
import { normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import type { ProjectAsset, ProjectDetail, ProjectShot, ProjectUnit, ShotArtifact } from "@/services/api/projects";
import type { TimelineClip } from "@/types/timeline";

function video(id: string, overrides: Partial<ProjectAsset> = {}): ProjectAsset {
    return {
        id, title: id, mediaType: "video", category: "material", status: "ready",
        versionCount: 1, usages: [], position: 0, storageKey: `resource:${id}`,
        durationMs: 30_000, updatedAt: "", ...overrides,
    };
}

function unit(id: string, position: number): ProjectUnit {
    return { id, projectId: "project", kind: "episode", title: `第${position}集`, sourceText: "", wordCount: 0, status: "ready", position, createdAt: "", updatedAt: "" };
}

function shot(id: string, unitId: string, position: number): ProjectShot {
    return { id, projectId: "project", unitId, title: `镜头${position}`, description: "", position, durationMs: 30_000, status: "ready", createdAt: "", updatedAt: "" };
}

function artifact(resourceId: string, shotId: string, overrides: Partial<ShotArtifact> = {}): ShotArtifact {
    return { id: `artifact-${resourceId}`, projectId: "project", shotId, resourceId, type: "video", version: 1, status: "ready", selected: true, metadataJson: "{}", createdAt: "", updatedAt: "", ...overrides };
}

const context: Pick<ProjectDetail, "units" | "shots" | "shotArtifacts"> = {
    units: [unit("ep2", 2), unit("ep1", 1)],
    shots: [shot("s12", "ep1", 2), shot("s21", "ep2", 1), shot("s11", "ep1", 1)],
    shotArtifacts: [artifact("v12", "s12"), artifact("v21", "s21"), artifact("v11", "s11")],
};

describe("editor episode video library", () => {
    test("only videos are grouped by real episode and shot order, not filename or asset order", () => {
        const groups = buildEditorVideoGroups([video("v21"), video("image", { mediaType: "image" }), video("v12"), video("audio", { mediaType: "audio" }), video("v11")], context);
        expect(groups.map((group) => group.label)).toEqual(["第1集", "第2集"]);
        expect(groups[0].items.map((asset) => asset.id)).toEqual(["v11", "v12"]);
        expect(groups[1].items.map((asset) => asset.id)).toEqual(["v21"]);
    });

    test("unit associations work without artifacts and unassigned uploads are kept separately", () => {
        const groups = buildEditorVideoGroups([video("local", { source: "uploaded" }), video("bound", { unitIds: ["ep2"] })], context);
        expect(groups.map((group) => group.id)).toEqual(["ep2", "unassigned"]);
        expect(groups[1].label).toBe("未分集视频");
        expect(groups[1].items[0].id).toBe("local");
    });

    test("shot duration is preserved when project asset metadata has no duration", () => {
        const groups = buildEditorVideoGroups([video("v11", { durationMs: undefined })], context);
        const project = normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
        const command = createVideoAppendCommands(project, groups[0].items)[0].payload as { clip: TimelineClip };
        expect(command.clip.durationMs).toBe(30_000);
    });

    test("regenerated videos use the currently adopted result, not obsolete versions", () => {
        const history = { ...context, shotArtifacts: [...context.shotArtifacts, artifact("old", "s11", { selected: false, version: 2 })] };
        const groups = buildEditorVideoGroups([video("old"), video("v11")], history);
        expect(groups.flatMap((group) => group.items.map((asset) => asset.id))).toEqual(["v11"]);
    });

    test("one asset associated with multiple episodes appears in each episode without duplicate entries", () => {
        const groups = buildEditorVideoGroups([video("shared", { unitIds: ["ep2", "ep1", "ep1"] })], context);
        expect(groups.map((group) => [group.id, group.items.length])).toEqual([["ep1", 1], ["ep2", 1]]);
    });

    test("each episode appends sequentially after existing clips and is one undo step", () => {
        const store = createEditorStore({ saveTimeline: async () => {} });
        store.getState().load(normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 }));
        const first = store.getState().project!;
        expect(store.getState().dispatchBatch(createVideoAppendCommands(first, [video("v11"), video("v12", { durationMs: 12_000 })]), first)).toBe(true);
        const second = store.getState().project!;
        expect(store.getState().dispatchBatch(createVideoAppendCommands(second, [video("v21")]), second)).toBe(true);
        expect(store.getState().project!.clips.map((clip) => [clip.directMedia?.id, clip.startMs, clip.durationMs])).toEqual([["v11", 0, 30_000], ["v12", 30_000, 12_000], ["v21", 42_000, 30_000]]);
        store.getState().undo();
        expect(store.getState().project!.clips).toHaveLength(2);
        store.getState().undo();
        expect(store.getState().project!.clips).toHaveLength(0);
    });

    test("append uses actual video end and allocates unique clip IDs on repeated imports", () => {
        const project = normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
        const first = createVideoAppendCommands(project, [video("v11")])[0].payload as { clip: TimelineClip };
        project.clips.push(first.clip, { ...first.clip, id: "tail", startMs: 70_000, durationMs: 8_000 });
        const repeated = createVideoAppendCommands(project, [video("v11"), video("v11")]).map((command) => (command.payload as { clip: TimelineClip }).clip);
        expect(repeated.map((clip) => clip.startMs)).toEqual([78_000, 108_000]);
        expect(new Set([first.clip.id, ...repeated.map((clip) => clip.id)]).size).toBe(3);
    });

    test("locked tracks and missing media reject the whole import", () => {
        const project = normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
        expect(() => createVideoAppendCommands(project, [video("v11"), video("missing", { storageKey: undefined })])).toThrow("missing");
        project.tracks.find((track) => track.kind === "video")!.locked = true;
        expect(() => createVideoAppendCommands(project, [video("v11")])).toThrow("锁定");
        expect(project.clips).toHaveLength(0);
    });

    test("append waits for existing footage on every video track", () => {
        const project = normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
        const track = project.tracks.find((entry) => entry.kind === "video")!;
        project.tracks.push({ ...track, id: "second-video", order: 10 });
        const existing = (createVideoAppendCommands(project, [video("existing")])[0].payload as { clip: TimelineClip }).clip;
        project.clips.push({ ...existing, trackId: "second-video", startMs: 60_000 });
        const appended = (createVideoAppendCommands(project, [video("next")])[0].payload as { clip: TimelineClip }).clip;
        expect(appended.startMs).toBe(90_000);
    });
});
