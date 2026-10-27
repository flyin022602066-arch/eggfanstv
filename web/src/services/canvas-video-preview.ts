import { captureVideoPoster } from "@/lib/video-poster";
import { acquireCanvasVideoSource } from "@/services/canvas-video-source";
import { captureUserScopeEpoch, subscribeUserScope, userScopeEpochMatches } from "@/lib/user-scope";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type VideoPreview = NonNullable<CanvasNodeMetadata["videoPreview"]>;

export const CANVAS_VIDEO_PREVIEW_VERSION = 2;

export function canvasDerivedPreviewSourceKey(node: CanvasNodeData) {
    return JSON.stringify([node.metadata?.storageKey || "", node.metadata?.content || "", node.metadata?.importSource?.provider || ""]);
}

type PreviewEntry = { refs: number; controller: AbortController; url?: string; promise: Promise<VideoPreview | null> };
const previewRequests = new Map<string, PreviewEntry>();
const MAX_ACTIVE_PREVIEWS = 32;

function disposeEntry(key: string, entry: PreviewEntry) {
    entry.controller.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    if (previewRequests.get(key) === entry) previewRequests.delete(key);
}

subscribeUserScope(() => {
    for (const [key, entry] of previewRequests) disposeEntry(key, entry);
});

/** Display-only leases: never upload a poster or mutate the durable canvas. */
export function acquireCanvasVideoPreview(node: CanvasNodeData) {
    const epoch = captureUserScopeEpoch();
    const sourceKey = node.metadata?.storageKey || node.metadata?.content || "";
    const requestKey = JSON.stringify([epoch.scope, epoch.generation, canvasDerivedPreviewSourceKey(node)]);
    let entry = previewRequests.get(requestKey);
    if (!entry && sourceKey && previewRequests.size < MAX_ACTIVE_PREVIEWS) {
        const controller = new AbortController();
        const created: PreviewEntry = { refs: 0, controller, promise: Promise.resolve(null) };
        const forgetFailedRequest = () => {
            // Existing consumers still own their leases; never remove a newer retry.
            if (previewRequests.get(requestKey) === created) previewRequests.delete(requestKey);
        };
        created.promise = generateCanvasVideoPreview(node, controller.signal).then((preview) => {
            if (!preview) { forgetFailedRequest(); return null; }
            if (controller.signal.aborted || !userScopeEpochMatches(epoch)) { URL.revokeObjectURL(preview.content); return null; }
            created.url = preview.content;
            return preview;
        }).catch(() => { forgetFailedRequest(); return null; });
        entry = created;
        previewRequests.set(requestKey, entry);
    }
    if (entry) entry.refs += 1;
    const leased = entry;
    let released = false;
    return { promise: entry?.promise || Promise.resolve(null), release() {
        if (released || !leased) return;
        released = true;
        if (--leased.refs === 0) disposeEntry(requestKey, leased);
    } };
}

export function canvasVideoPreviewNeedsHydration(node: CanvasNodeData) {
    const sourceKey = canvasVideoPreviewSourceKey(node);
    if (!sourceKey) return false;
    const preview = node.metadata?.videoPreview;
    // 完全没有首帧记录。
    if (!preview?.content && !preview?.storageKey) return true;
    if (preview.captureVersion !== CANVAS_VIDEO_PREVIEW_VERSION || preview.sourceKey !== sourceKey) return true;
    // `content` 若是 blob:/会话态地址，说明这份首帧跨会话已失效（刷新、换端口、清缓存后取不到）
    // → 必须重新水合，否则节点会永远停在「首帧暂不可用」。
    if (isSessionBoundPreviewUrl(preview.content)) return true;
    // content 是可用地址（http / /api/resources/...）：直接用，不重抓（含旧数据里没有 storageKey 的情况）。
    if (preview.content) return false;
    // 只剩本地键、没有可用地址时才做一次廉价校验：能解析就直接复用，解析不到才重新抓帧。
    return isLocalPreviewStorageKey(preview.storageKey);
}

/** 会话态地址：blob:（同源同会话才有效），不该作为首帧的长期缓存依据。 */
export function isSessionBoundPreviewUrl(url: string | undefined) {
    return String(url || "").trim().toLowerCase().startsWith("blob:");
}

/** 本地缓存键（非资源键），如 `image:<uid>:<nanoid>`。 */
export function isLocalPreviewStorageKey(storageKey: string | undefined) {
    const value = String(storageKey || "").trim();
    return Boolean(value) && !value.startsWith("resource:");
}

async function generateCanvasVideoPreview(node: CanvasNodeData, signal?: AbortSignal): Promise<VideoPreview | null> {
    await waitForBrowserIdle(signal);
    throwIfAborted(signal);
    const source = await acquireCanvasVideoSource(node.metadata?.storageKey, node.metadata?.content || "", signal);
    if (!source.url) { source.release(); return null; }
    let captured: Awaited<ReturnType<typeof captureVideoPoster>>;
    try {
        captured = await captureVideoPoster(source.url, { signal, maxWidth: 400 });
    } finally {
        source.release();
    }
    throwIfAborted(signal);
    if (!captured.poster) return null;
    return {
        content: URL.createObjectURL(captured.poster),
        width: captured.width,
        height: captured.height,
        bytes: captured.poster.size,
        mimeType: captured.poster.type,
        captureVersion: CANVAS_VIDEO_PREVIEW_VERSION,
        sourceKey: canvasVideoPreviewSourceKey(node),
        capturedAtMs: captured.capturedAtMs,
    };
}

function canvasVideoPreviewSourceKey(node: CanvasNodeData) {
    return node.metadata?.storageKey || node.metadata?.content || "";
}

function waitForBrowserIdle(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        let idleId: number | undefined;
        let timerId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const idleWindow = window as unknown as {
            requestIdleCallback?: Window["requestIdleCallback"];
            cancelIdleCallback?: Window["cancelIdleCallback"];
        };
        const cleanup = () => {
            signal?.removeEventListener("abort", handleAbort);
            if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
            if (timerId !== undefined) globalThis.clearTimeout(timerId);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const handleAbort = () => {
            cleanup();
            reject(abortError());
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        if (idleWindow.requestIdleCallback) idleId = idleWindow.requestIdleCallback(finish, { timeout: 1_000 });
        else timerId = globalThis.setTimeout(finish, 250);
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

function abortError() {
    return new DOMException("Canvas video preview hydration aborted", "AbortError");
}
