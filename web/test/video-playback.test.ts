import { afterEach, expect, mock, test } from "bun:test";

let status = "ready";
let polls = 0;
const downloads: Array<{ key: string; variant?: string }> = [];
const originals: string[] = [];

mock.module("@/services/api/resources", () => ({
    ownedResourceIdFromMediaRef: (key?: string) => key?.startsWith("resource:") ? key.slice(9) : "",
    refreshResource: async () => ({ playbackStatus: ++polls > 1 && status === "processing" ? "ready" : status }),
    resourceStorageKey: (id: string) => `resource:${id}`,
}));
mock.module("@/services/resource-blob-cache", () => ({
    cacheResourceObjectUrl: async (key: string, variant?: string) => {
        downloads.push({ key, variant });
        return "blob:compatible";
    },
}));
mock.module("@/services/file-storage", () => ({
    resolveMediaUrl: async (key?: string, fallback?: string) => {
        originals.push(key || fallback || "");
        return "blob:original";
    },
}));

const { resolveVideoPlaybackUrl } = await import("@/services/video-playback");

afterEach(() => {
    status = "ready";
    polls = 0;
    downloads.length = 0;
    originals.length = 0;
});

test("a ready H.264 copy bypasses the cached HEVC original", async () => {
    expect(await resolveVideoPlaybackUrl("resource:video", "blob:old-original")).toBe("blob:compatible");
    expect(downloads).toEqual([{ key: "resource:video", variant: "playback" }]);
    expect(originals).toEqual([]);
});

test("ordinary videos and browser-local media retain their original source", async () => {
    status = "none";
    expect(await resolveVideoPlaybackUrl("resource:h264", "fallback")).toBe("blob:original");
    expect(await resolveVideoPlaybackUrl("local:video", "fallback")).toBe("blob:original");
    expect(originals).toEqual(["resource:h264", "local:video"]);
    expect(downloads).toEqual([]);
});

test("a processing copy waits for readiness and never downloads an unsupported original", async () => {
    status = "processing";
    const hints: string[] = [];
    expect(await resolveVideoPlaybackUrl("resource:video", "", { onStatus: (hint) => hints.push(hint) })).toBe("blob:compatible");
    expect(polls).toBe(2);
    expect(hints.some((hint) => hint.includes("兼容"))).toBe(true);
    expect(originals).toEqual([]);
});

test("failed transcoding surfaces an actionable error instead of retrying HEVC", async () => {
    status = "failed";
    await expect(resolveVideoPlaybackUrl("resource:video", "")).rejects.toThrow("兼容副本生成失败");
    expect(originals).toEqual([]);
    expect(downloads).toEqual([]);
});

test("deactivation cancels a pending compatibility wait", async () => {
    status = "processing";
    const controller = new AbortController();
    const pending = resolveVideoPlaybackUrl("resource:video", "", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(downloads).toEqual([]);
});
