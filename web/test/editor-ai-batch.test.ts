import { expect, test } from "bun:test";
import { createEditorStore } from "@/stores/editor/editor-store";
import type { TimelineProject } from "@/types/timeline";

const project: TimelineProject = { version: 2, durationMs: 10000, tracks: [{ id: "video", kind: "video", label: "video", order: 0 }], clips: [{ id: "clip", nodeId: "node", kind: "video", trackId: "video", startMs: 0, durationMs: 10000 }] };
test("an AI batch applies atomically and one undo restores the original timeline", () => {
    const store = createEditorStore();
    store.getState().load(project);
    expect(store.getState().dispatchBatch([{ op: "trimClip", payload: { id: "clip", durationMs: 5000 } }, { op: "moveClip", payload: { id: "clip", startMs: 2000 } }], project)).toBe(true);
    expect(store.getState().project!.clips[0].startMs).toBe(2000);
    store.getState().undo();
    expect(store.getState().project).toEqual(project);
});
test("an invalid later command cannot partially modify the timeline", () => {
    const store = createEditorStore();
    store.getState().load(project);
    expect(store.getState().dispatchBatch([{ op: "trimClip", payload: { id: "clip", durationMs: 5000 } }, { op: "removeClip", payload: { id: "missing" } }], project)).toBe(false);
    expect(store.getState().project).toBe(project);
});
test("a plan generated for an older timeline or an active gesture is rejected", () => {
    const store = createEditorStore();
    store.getState().load(project);
    store.getState().dispatch({ op: "moveClip", payload: { id: "clip", startMs: 3000 } });
    const current = store.getState().project;
    expect(store.getState().dispatchBatch([{ op: "removeClip", payload: { id: "clip" } }], project)).toBe(false);
    expect(store.getState().project).toBe(current);
    store.getState().previewGesture({ op: "moveClip", payload: { id: "clip", startMs: 4000 } });
    expect(store.getState().dispatchBatch([], store.getState().project!)).toBe(false);
});
