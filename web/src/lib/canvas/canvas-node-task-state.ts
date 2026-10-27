import type { CanvasNodeData } from "@/types/canvas";

export function canvasNodeInterruptedTaskId(node: CanvasNodeData) {
    const metadata = node.metadata;
    return metadata?.status === "error" && (metadata.taskStatus === "queued" || metadata.taskStatus === "running") ? metadata.taskId : undefined;
}

export function canvasNodeActiveTaskId(node: CanvasNodeData) {
    const metadata = node.metadata;
    return metadata?.taskStatus === "queued" || metadata?.taskStatus === "running" ? metadata.taskId : undefined;
}

/** A historical taskId is not a lock. Only live task states / submission are. */
export function isCanvasNodeGenerating(node: CanvasNodeData | undefined, runningNodeId?: string | null) {
    if (!node) return false;
    const meta = node.metadata;
    if (["succeeded", "failed", "cancelled"].includes(meta?.taskStatus || "") && meta?.status !== "loading") return false;
    if (runningNodeId === node.id) return true;
    if (meta?.taskId && (meta.taskStatus === "queued" || meta.taskStatus === "running")) return true;
    if (meta?.taskStatus === "succeeded" && !meta.content && !meta.storageKey) return true;
    if (["succeeded", "failed", "cancelled"].includes(meta?.taskStatus || "")) return false;
    return meta?.status === "loading" || Boolean(meta?.taskId && meta.status !== "success" && meta.status !== "error");
}
