import localforage from "localforage";

import { detectCanvasFaces } from "@/lib/canvas/canvas-face-detection";
import { clampJiasuFaceRegion, jiasuFaceMaskCacheKey, renderJiasuFaceMask, type JiasuFaceMaskMode, type JiasuFaceMaskOverride, type JiasuFaceRegion } from "@/lib/jiasu-face-mask";
import { getActiveUserScope } from "@/lib/user-scope";
import { getImageBlob } from "@/services/image-storage";
import { ApiError } from "@/services/api/request";
import { getResource, importResourceFromUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

const cache = localforage.createInstance({ name: "infinite-canvas", storeName: "jiasu_face_mask_resources" });

export type JiasuFaceMaskInspection = {
    source: Blob;
    sourceHash: string;
    width: number;
    height: number;
    regions: JiasuFaceRegion[];
};

function checkAbort(signal?: AbortSignal) {
    signal?.throwIfAborted();
}

export async function inspectJiasuFaceMask(image: ReferenceImage, override?: JiasuFaceMaskOverride, signal?: AbortSignal, detect = true): Promise<JiasuFaceMaskInspection> {
    checkAbort(signal);
    let source = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (!source) {
        const url = image.dataUrl || image.url || "";
        if (!url || /^asset:\/\//i.test(url)) throw new Error("人脸遮罩需要原始图片，请重新连接图片素材");
        if (/^https?:\/\//i.test(url)) {
            const resource = await importResourceFromUrl(url, "image");
            checkAbort(signal);
            source = await getImageBlob(resourceStorageKey(resource.id));
        } else {
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error("读取人脸遮罩原图失败");
            source = await response.blob();
        }
    }
    if (!source) throw new Error("原始图片无法读取，请重新上传后再处理");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await source.arrayBuffer()));
    const sourceHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    checkAbort(signal);
    if (override?.sourceHash === sourceHash || !detect) {
        const bitmap = await createImageBitmap(source);
        const result = { source, sourceHash, width: bitmap.width, height: bitmap.height, regions: override?.sourceHash === sourceHash ? override.regions.map(clampJiasuFaceRegion) : [] };
        bitmap.close();
        checkAbort(signal);
        return result;
    }
    const detectionKey = `detection-v1:${getActiveUserScope()}:${sourceHash}`;
    const savedDetection = await cache.getItem<Omit<JiasuFaceMaskInspection, "source">>(detectionKey);
    if (savedDetection) return { ...savedDetection, source };
    const objectUrl = URL.createObjectURL(source);
    try {
        const detection = await detectCanvasFaces(objectUrl, signal);
        checkAbort(signal);
        const result = {
            sourceHash, width: detection.imageWidth, height: detection.imageHeight,
            regions: detection.faces.map((face, index) => clampJiasuFaceRegion({ id: `face-${index}`, x: (face.x - face.width * 0.08) / detection.imageWidth, y: (face.y - face.height * 0.12) / detection.imageHeight, width: face.width * 1.16 / detection.imageWidth, height: face.height * 1.24 / detection.imageHeight })),
        };
        await cache.setItem(detectionKey, result);
        return { ...result, source };
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`自动人脸识别失败：${error instanceof Error ? error.message : "无法识别"}。请在视频节点的“人脸遮罩”中手动框选，或关闭遮罩后再生成。`);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export async function prepareJiasuFaceMaskedImage(image: ReferenceImage, mode: JiasuFaceMaskMode, override?: JiasuFaceMaskOverride, signal?: AbortSignal, channel: "jiasu" | "eggfans-sd2" = "jiasu"): Promise<ReferenceImage> {
    if (mode === "off") return image;
    const inspection = await inspectJiasuFaceMask(image, override, signal);
    if (!inspection.regions.length) return image;
    const key = jiasuFaceMaskCacheKey(getActiveUserScope(), inspection.sourceHash, mode, inspection.regions, channel);
    const saved = await cache.getItem<ReferenceImage>(key);
    if (saved?.storageKey) {
        try {
            await getResource(resourceIdFromStorageKey(saved.storageKey));
            checkAbort(signal);
            return { ...saved, id: image.id, name: image.name };
        } catch (error) {
            if (!(error instanceof ApiError && error.status === 404)) throw error;
            await cache.removeItem(key);
        }
    }
    const blob = await renderJiasuFaceMask(inspection.source, inspection.regions, mode);
    checkAbort(signal);
    const keyDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
    const idempotencyKey = `${channel}-face-mask:${Array.from(keyDigest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const resource = await uploadResourceFile(blob, "image", { fileName: `${channel}-face-mask.png`, width: inspection.width, height: inspection.height, idempotencyKey });
    checkAbort(signal);
    const prepared: ReferenceImage = { id: image.id, name: image.name, type: resource.mimeType || blob.type, dataUrl: "", storageKey: resourceStorageKey(resource.id), width: inspection.width, height: inspection.height, bytes: blob.size };
    await cache.setItem(key, prepared);
    return prepared;
}
