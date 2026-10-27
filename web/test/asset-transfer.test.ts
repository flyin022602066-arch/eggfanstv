import { describe, expect, test } from "bun:test";
import { createAssetPackage, readAssetPackage } from "@/pages/assets/asset-transfer";
import { createZip, readZip } from "@/lib/zip";
import { ExportIntegrityError } from "@/lib/export-integrity";
import type { Asset } from "@/stores/use-asset-store";

const timestamp = "2026-10-19T00:00:00.000Z";
const base = { title: "同名资产", coverUrl: "", tags: [], createdAt: timestamp, updatedAt: timestamp, folderId: "foreign-folder", metadata: { canvasId: "foreign-flow", nodeId: "foreign-node", resourceKey: "resource:foreign", projectIds: ["foreign-project"], workflowName: "项目甲" } };
const image: Asset = { ...base, id: "picture", kind: "image", data: { storageKey: "resource:foreign", dataUrl: "", width: 4096, height: 2160, bytes: 8, mimeType: "image/png" } };
const text: Asset = { ...base, id: "text", kind: "text", data: { content: "第一行\n第二行：完整歌词与剧本。" } };
const video: Asset = { ...base, id: "video", kind: "video", data: { url: "blob:expired", width: 1920, height: 1080, durationMs: 30_000, bytes: 10, mimeType: "video/mp4" } };

describe("complete asset package transfer", () => {
    test("preserves originals and text, remaps resource addresses and keeps workflow isolation", async () => {
        const originals = new Map([[image.id, new Blob(["原图4K"], { type: "image/png" })], [video.id, new Blob(["完整30秒原视频"], { type: "video/mp4" })]]);
        const zip = await createAssetPackage([image, text, video], { workflow: { id: "foreign-flow", name: "项目甲" } }, { readMedia: async (asset) => originals.get(asset.id)! });
        const contents = await readZip(zip);
        expect([...contents.keys()].filter((path) => path.startsWith("assets/"))).toHaveLength(3);
        expect(await contents.get([...contents.keys()].find((path) => path.endsWith(".txt"))!)!.text()).toBe(text.data.content);
        const stored = new Map<string, Blob>();
        const dependencies = { storeMedia: async (blob: Blob, asset: { id: string }) => { stored.set(asset.id, blob); return { storageKey: `resource:new-${asset.id}`, url: `/api/resources/new-${asset.id}/file` }; } };
        const imported = await readAssetPackage(new File([zip], "项目甲.zip"), dependencies);
        expect(imported.find((asset) => asset.kind === "text")?.data).toEqual(text.data);
        expect(await stored.get(image.id)!.text()).toBe("原图4K");
        expect(await stored.get(video.id)!.text()).toBe("完整30秒原视频");
        const restored = imported.find((asset) => asset.kind === "image")!;
        expect(restored.kind === "image" && restored.data.width).toBe(4096);
        expect(restored.kind === "image" && restored.data.storageKey).toBe("resource:new-picture");
        expect(imported.every((asset) => asset.folderId === undefined && asset.metadata?.canvasId === undefined && asset.metadata?.projectIds === undefined)).toBe(true);
        expect(new Set(imported.map((asset) => asset.metadata?.workflowId)).size).toBe(1);
        expect(imported[0].metadata?.workflowName).toBe("项目甲");
        const again = await readAssetPackage(new File([zip], "项目甲.zip"), dependencies);
        expect(again[0].metadata?.workflowId).not.toBe(imported[0].metadata?.workflowId);
    });

    test("refuses incomplete archives before storing any media", async () => {
        const broken = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", version: 2, assets: [image], files: [{ storageKey: image.data.storageKey, assetId: image.id, path: "assets/missing.png", mimeType: "image/png", bytes: 8 }] }) }]);
        let stored = false;
        await expect(readAssetPackage(new File([broken], "损坏.zip"), { storeMedia: async () => { stored = true; throw new Error("must not store"); } })).rejects.toThrow("缺失或损坏");
        expect(stored).toBe(false);
    });

    test("does not report a successful export when an original is unavailable", async () => {
        await expect(createAssetPackage([image], {}, { readMedia: async () => { throw new Error("资源不存在"); } })).rejects.toBeInstanceOf(ExportIntegrityError);
    });

    test("imports previous version resource packages using the correct media type", async () => {
        const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", version: 1, assets: [image], files: [{ storageKey: "resource:foreign", path: "files/image.png", bytes: 4, mimeType: "image/png" }] }) }, { name: "files/image.png", data: "data" }]);
        const imported = await readAssetPackage(new File([zip], "legacy.zip"), { storeMedia: async (blob, asset) => { expect(asset.kind).toBe("image"); expect(blob.type).toBe("image/png"); return { storageKey: "resource:local", url: "/api/resources/local/file" }; } });
        expect(imported[0].coverUrl).toBe("/api/resources/local/file");
    });
});
