import { buildCanvasSpatialIndex, canvasNodeBounds, type CanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import type { CanvasNodeData, Position } from "@/types/canvas";

export function createCanvasConnectionTargetIndex() {
    let source: CanvasNodeData[] | null = null;
    let index: CanvasSpatialIndex<CanvasNodeData> | null = null;
    return {
        query(nodes: CanvasNodeData[], point: Position, radius: number) {
            if (source !== nodes || !index) {
                const byId = new Map(nodes.map((node) => [node.id, node]));
                const visible = nodes.filter((node) => {
                    const batch = node.metadata?.batchRootId ? byId.get(node.metadata.batchRootId) : undefined;
                    const parent = node.parentId ? byId.get(node.parentId) : undefined;
                    return !isFrameNode(node) && !(batch && !batch.metadata?.imageBatchExpanded) && !(parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed);
                });
                index = buildCanvasSpatialIndex(visible.map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node })), 512);
                source = nodes;
            }
            return index.query({ left: point.x - radius, top: point.y - radius, right: point.x + radius, bottom: point.y + radius }).reverse();
        },
    };
}
