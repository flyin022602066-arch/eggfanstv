import { expect, test } from "bun:test";
import { activeConnectionPath, canvasConnectionPath, connectionHandleY } from "../src/components/canvas/canvas-connections";
import { applyCanvasConnectionPreview, subscribeCanvasConnectionPreview, type CanvasConnectionPreview } from "../src/lib/canvas/canvas-live-viewport";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { createCanvasConnectionTargetIndex } from "../src/lib/canvas/canvas-connection-target-index";

const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Image, title: "source", position: { x: 80, y: 90 }, width: 240, height: 160 };
const target: CanvasNodeData = { ...source, id: "target", position: { x: 600, y: 350 } };

test("connection endpoints follow node movement and resizing at every zoom", () => {
    const connection = { id: "wire", fromNodeId: source.id, toNodeId: target.id };
    for (const scale of [0.25, 1, 2]) {
        for (let frame = 0; frame < 100; frame++) {
            const moving = { ...source, position: { x: source.position.x + frame / scale, y: source.position.y - frame / scale }, width: source.width + frame, height: source.height + frame };
            const path = canvasConnectionPath(connection, moving, target);
            expect(path.startX).toBe(moving.position.x + moving.width);
            expect(path.startY).toBe(moving.position.y + moving.height / 2);
            expect(path.endX).toBe(target.position.x);
            expect(path.endY).toBe(target.position.y + target.height / 2);
        }
    }
});

test("draft snaps to the same scrolled storyboard row as the committed connection", () => {
    const script: CanvasNodeData = { ...target, type: CanvasNodeType.Script, height: 600, metadata: { storyboard: { rows: [{ id: "row-1" }, { id: "row-2" }] } } } as CanvasNodeData;
    const handleId = "row:row-2";
    const scrollTop = 37;
    const draft = activeConnectionPath(source, { nodeId: source.id, handleType: "source" }, { x: 600, y: 400 }, script, 0, handleId, scrollTop);
    const anchorY = connectionHandleY(script, handleId, scrollTop);
    const committed = canvasConnectionPath({ id: "row-wire", fromNodeId: source.id, toNodeId: script.id, toHandleId: handleId }, source, script, 0, scrollTop);
    expect(draft.endsWith(`, ${script.position.x} ${anchorY}`)).toBe(true);
    expect(committed.endY).toBe(anchorY);
});

test("connection pointer previews notify the graphics layer immediately and unsubscribe cleanly", () => {
    const container = new EventTarget() as HTMLDivElement;
    const received: Array<CanvasConnectionPreview | null> = [];
    const unsubscribe = subscribeCanvasConnectionPreview(container, (preview) => received.push(preview));
    const preview: CanvasConnectionPreview = { handle: { nodeId: source.id, handleType: "source" }, mouseWorld: { x: 500, y: 400 }, targetNodeId: target.id, targetHandleId: "row:row-2" };
    applyCanvasConnectionPreview(container, preview);
    applyCanvasConnectionPreview(container, null);
    expect(received).toEqual([preview, null]);
    unsubscribe();
    applyCanvasConnectionPreview(container, preview);
    expect(received).toHaveLength(2);
});

test("connection target lookup keeps stacking and excludes collapsed children without scanning distant nodes", () => {
    const index = createCanvasConnectionTargetIndex();
    const batch = { ...source, id: "batch", metadata: { isBatchRoot: true, imageBatchExpanded: false } };
    const child = { ...target, id: "hidden", metadata: { batchRootId: batch.id } };
    const farther = Array.from({ length: 5000 }, (_, nodeIndex) => ({ ...source, id: `far-${nodeIndex}`, position: { x: 10000 + nodeIndex * 300, y: 10000 } }));
    const upper = { ...target, id: "upper" };
    const nodes = [batch, target, child, ...farther, upper];
    expect(index.query(nodes, { x: target.position.x, y: target.position.y + target.height / 2 }, 56).map((node) => node.id)).toEqual([upper.id, target.id]);
    const moved = nodes.map((node) => node.id === target.id ? { ...node, position: { x: 2000, y: 2000 } } : node);
    expect(index.query(moved, { x: target.position.x, y: target.position.y + target.height / 2 }, 56).map((node) => node.id)).toEqual([upper.id]);
});
