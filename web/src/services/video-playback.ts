import { ownedResourceIdFromMediaRef, refreshResource, resourceStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";

type VideoPlaybackOptions = {
    signal?: AbortSignal;
    onStatus?: (hint: string) => void;
};

export async function resolveVideoPlaybackUrl(storageKey?: string, fallback = "", options: VideoPlaybackOptions = {}) {
    const { signal, onStatus } = options;
    signal?.throwIfAborted();
    const resourceId = ownedResourceIdFromMediaRef(storageKey, fallback);
    if (!resourceId) return resolveMediaUrl(storageKey, fallback);
    let resource = await refreshResource(resourceId, { signal });
    const deadline = Date.now() + 300_000;
    while (resource.playbackStatus === "processing") {
        onStatus?.("正在准备兼容视频，请稍候");
        await waitForPlayback(signal);
        if (Date.now() >= deadline) throw new Error("视频兼容版本准备超时，请稍后重试或下载原片观看");
        resource = await refreshResource(resourceId, { signal });
    }
    signal?.throwIfAborted();
    if (resource.playbackStatus === "failed") throw new Error("视频兼容副本生成失败，可下载原片后用本地播放器观看");
    const key = resourceStorageKey(resourceId);
    if (resource.playbackStatus !== "ready") return resolveMediaUrl(key, fallback);
    onStatus?.("正在加载兼容视频");
    const url = await cacheResourceObjectUrl(key, "playback");
    signal?.throwIfAborted();
    if (!url) throw new Error("视频兼容副本读取失败，请重试");
    return url;
}

function waitForPlayback(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, 2_500);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
    });
}
