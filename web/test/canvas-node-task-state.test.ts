import { expect, test } from "bun:test";
import { isCanvasNodeGenerating } from "../src/lib/canvas/canvas-node-task-state";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";

function video(metadata: CanvasNodeMetadata): CanvasNodeData {
    return { id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 0, y: 0 }, width: 360, height: 640, metadata };
}

test("a historical failed task does not lock a manual video submission", () => {
    expect(isCanvasNodeGenerating(video({ status: "error", taskId: "old", taskStatus: "failed" }), "video")).toBe(false);
    expect(isCanvasNodeGenerating(video({ status: "error", taskId: "old", taskStatus: "cancelled" }))).toBe(false);
    expect(isCanvasNodeGenerating(video({ status: "loading", taskId: "old", taskStatus: "failed" }), "video")).toBe(true);
});

test("completed but unbound media remains protected from duplicate generation", () => {
    expect(isCanvasNodeGenerating(video({ status: "error", taskId: "done", taskStatus: "succeeded", resourceReloadAvailable: true }))).toBe(true);
    expect(isCanvasNodeGenerating(video({ status: "success", taskId: "done", taskStatus: "succeeded", content: "video.mp4" }))).toBe(false);
});

test("queued and running tasks remain locked", () => {
    for (const taskStatus of ["queued", "running"] as const) {
        expect(isCanvasNodeGenerating(video({ status: "error", taskId: "live", taskStatus }))).toBe(true);
    }
});
