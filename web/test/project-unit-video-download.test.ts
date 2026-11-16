import { afterEach, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { apiClient } from "@/services/api/request";
import { getActiveUserScope, setActiveUserScope } from "@/lib/user-scope";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import { chapterVideoDownloadFiles, downloadProjectUnitVideos } from "@/pages/projects/detail/workflow-unit-video-download";

const originalWindow = globalThis.window;
const originalAdapter = apiClient.defaults.adapter;
const originalScope = getActiveUserScope();
afterEach(() => { globalThis.window = originalWindow; apiClient.defaults.adapter = originalAdapter; setActiveUserScope(originalScope); });

function fixture() {
    const shot = (id: string, unitId: string, position: number) => ({ id, unitId, position, title: "镜头:同名" } as ProjectShot);
    const artifact = (shotId: string, version: number, selected = false, status = "ready") => ({ id: shotId + version, shotId, unitId: "episode", type: "video", resourceId: shotId + "-v" + version, version, selected, status } as ShotArtifact);
    return { project: { name: "测试剧" }, units: [{ id: "episode", title: "第7集" }], shots: [shot("b", "episode", 1), shot("other", "other", 0), shot("a", "episode", 0)], shotArtifacts: [artifact("a", 3), artifact("a", 1, true, "stale"), artifact("b", 2), artifact("other", 1)] } as ProjectDetail;
}
function nativeSave(save: (name: string, data: string) => Promise<boolean>) {
    setActiveUserScope("episode-download-test");
    Object.assign(globalThis, { window: { location: { protocol: "wails:" }, go: { main: { DesktopApp: { SaveOwnedArtifact: save } } } } });
}

test("episode download follows shot order, selected versions and excludes other episodes", () => {
    const files = chapterVideoDownloadFiles(fixture(), "episode");
    expect(files.map((file) => file.resourceId)).toEqual(["a-v1", "b-v2"]);
    expect(files.map((file) => file.fileName)).toEqual(["001_镜头_同名_v1.mp4", "002_镜头_同名_v2.mp4"]);
});
test("missing current media blocks a misleading complete-episode archive", async () => {
    const detail = fixture();
    detail.shotArtifacts.find((artifact) => artifact.resourceId === "b-v2")!.resourceId = undefined;
    let calls = 0; nativeSave(async () => { calls++; return true; });
    apiClient.defaults.adapter = async () => { calls++; throw new Error("unexpected request"); };
    await expect(downloadProjectUnitVideos(detail, "episode")).rejects.toThrow("镜头02");
    expect(calls).toBe(0);
});
test("empty episode cannot export a false-success empty archive", async () => {
    await expect(downloadProjectUnitVideos(fixture(), "missing")).rejects.toThrow("没有分镜");
});
test("unavailable selected versions never silently fall back to another historical video", () => {
    const detail = fixture();
    detail.shotArtifacts.find((artifact) => artifact.resourceId === "a-v1")!.resourceId = undefined;
    expect(() => chapterVideoDownloadFiles(detail, "episode")).toThrow("镜头01");
});
test("unfinished artifacts with a resource id are not counted as complete", () => {
    const detail = fixture();
    detail.shotArtifacts.find((artifact) => artifact.resourceId === "b-v2")!.status = "pending";
    expect(() => chapterVideoDownloadFiles(detail, "episode")).toThrow("镜头02");
});
test("one click saves one valid ZIP with original bytes and reports progress", async () => {
    const saved: Array<{ name: string; data: string }> = [], requested: string[] = [], progress: number[] = [];
    nativeSave(async (name, data) => { saved.push({ name, data }); return true; });
    apiClient.defaults.adapter = async (config) => {
        requested.push(config.url!);
        return { data: new Blob([config.url!.includes("a-v1") ? "original-first" : "original-second"], { type: "video/mp4" }), status: 200, statusText: "OK", headers: {}, config };
    };
    expect(await downloadProjectUnitVideos(fixture(), "episode", (completed) => progress.push(completed))).toBe("saved");
    expect(saved).toHaveLength(1); expect(saved[0]!.name).toBe("测试剧_第7集_全部镜头.zip");
    const files = unzipSync(new Uint8Array(Buffer.from(saved[0]!.data, "base64")));
    expect(Object.keys(files)).toEqual(["001_镜头_同名_v1.mp4", "002_镜头_同名_v2.mp4"]);
    expect(Object.values(files).map(strFromU8)).toEqual(["original-first", "original-second"]);
    expect(requested).toEqual(["/resources/a-v1/file?proxy=1", "/resources/b-v2/file?proxy=1"]);
    expect(progress).toEqual([0, 1, 2]);
});
test("resource read failures never save a partial ZIP", async () => {
    let saves = 0; nativeSave(async () => { saves++; return true; });
    apiClient.defaults.adapter = async () => { throw new Error("missing media"); };
    await expect(downloadProjectUnitVideos(fixture(), "episode")).rejects.toThrow("镜头01");
    expect(saves).toBe(0);
});
test("original WebM video keeps its extension without re-encoding", async () => {
    let saved = ""; nativeSave(async (_name, data) => { saved = data; return true; });
    const detail = fixture(); detail.shots = detail.shots.filter((shot) => shot.id === "a");
    apiClient.defaults.adapter = async (config) => ({ data: new Blob(["original-webm"], { type: "video/webm" }), status: 200, statusText: "OK", headers: {}, config });
    await downloadProjectUnitVideos(detail, "episode");
    const archive = unzipSync(new Uint8Array(Buffer.from(saved, "base64")));
    expect(Object.keys(archive)).toEqual(["001_镜头_同名_v1.webm"]);
    expect(strFromU8(Object.values(archive)[0]!)).toBe("original-webm");
});
test("cancelling save is not reported as saved", async () => {
    nativeSave(async () => false);
    apiClient.defaults.adapter = async (config) => ({ data: new Blob(["video"], { type: "video/mp4" }), status: 200, statusText: "OK", headers: {}, config });
    expect(await downloadProjectUnitVideos(fixture(), "episode")).toBe("cancelled");
});
test("changing account during export prevents saving another user's videos", async () => {
    let saves = 0; nativeSave(async () => { saves++; return true; });
    apiClient.defaults.adapter = async (config) => { setActiveUserScope("another-owner"); return { data: new Blob(["video"], { type: "video/mp4" }), status: 200, statusText: "OK", headers: {}, config }; };
    await expect(downloadProjectUnitVideos(fixture(), "episode")).rejects.toThrow();
    expect(saves).toBe(0);
});
test("large episode ZIP uses bounded native chunks and preserves original media bytes", async () => {
    nativeSave(async () => { throw new Error("large ZIP cannot use one base64 call"); });
    const chunks: Uint8Array[] = [];
    let expectedSize = 0, written = 0, aborted = false;
    Object.assign(window.go!.main!.DesktopApp!, {
        BeginOwnedArtifact: async (_name: string, size: number) => { expectedSize = size; return "episode-archive"; },
        AppendOwnedArtifact: async (id: string, offset: number, data: string) => {
            expect(id).toBe("episode-archive"); expect(offset).toBe(written);
            const bytes = new Uint8Array(Buffer.from(data, "base64"));
            expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
            chunks.push(bytes); written += bytes.length; return written === expectedSize;
        },
        AbortOwnedArtifact: async () => { aborted = true; },
    });
    const detail = fixture(); detail.shots = detail.shots.filter((shot) => shot.id === "a");
    const original = new Uint8Array(33 * 1024 * 1024).fill(7);
    apiClient.defaults.adapter = async (config) => ({ data: new Blob([original], { type: "video/mp4" }), status: 200, statusText: "OK", headers: {}, config });
    expect(await downloadProjectUnitVideos(detail, "episode")).toBe("saved");
    const archive = Buffer.concat(chunks);
    const content = Object.values(unzipSync(archive))[0]!;
    expect(content.length).toBe(original.length); expect(content.every((value) => value === 7)).toBe(true);
    expect(aborted).toBe(false);
});
