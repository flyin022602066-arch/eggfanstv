import { http } from "@/services/api/request";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import type { EggfansAssetBinding } from "@/services/api/eggfans-private-assets";
import { useAssetStore, flushAssetStorePersistence, type NewAsset } from "@/stores/use-asset-store";

export type VolcLibraryAsset = { id: string; resourceId: string; name: string; uri: string; assetId: string; groupId: string; baseUrl: string; imageFile: string; publicUrl: string; mimeType: string; bytes: number; width: number; height: number; createdAt: string };

export function listVolcLibraryAssets(signal?: AbortSignal) {
    return http.get<VolcLibraryAsset[]>("/volc-asset-library", { signal });
}

export function syncResourceToVolcLibrary(resourceId: string, name: string, signal?: AbortSignal) {
    return http.post<EggfansAssetBinding>(`/resources/${encodeURIComponent(resourceId)}/volc-asset`, { name }, { signal, timeout: 360000 });
}

export function volcLibraryAssetInput(record: VolcLibraryAsset): NewAsset {
    if (!record.uri.startsWith("asset://") || record.uri !== `asset://${record.assetId}` || !record.resourceId) throw new Error("火山本地资产记录缺少有效 URI 或原图");
    const url = resourceFileUrl(record.resourceId);
    return { kind: "image", title: record.name, source: "火山 URI 本地资产库", category: "character", status: "confirmed", coverUrl: url, tags: ["火山 URI"], arkAssetId: record.assetId,
        data: { dataUrl: url, storageKey: resourceStorageKey(record.resourceId), width: record.width, height: record.height, bytes: record.bytes, mimeType: record.mimeType },
        metadata: { volcLibraryId: record.id, assetUri: record.uri, volcAssetBaseUrl: record.baseUrl, volcGroupId: record.groupId, localImageFile: record.imageFile } };
}

export async function restoreVolcLibraryAssets(signal?: AbortSignal) {
    const records = await listVolcLibraryAssets(signal);
    for (const record of [...records].reverse()) {
        const input = volcLibraryAssetInput(record);
        const store = useAssetStore.getState();
        const existing = store.assets.find((asset) => asset.kind === "image" && asset.data.storageKey === `resource:${record.resourceId}`);
        if (existing) {
            if (existing.metadata?.volcLibraryId === record.id && existing.arkAssetId === record.assetId) continue;
            store.updateAsset(existing.id, { arkAssetId: record.assetId, metadata: { ...existing.metadata, ...input.metadata } });
        } else store.addAsset(input);
    }
    await flushAssetStorePersistence();
    return records;
}
