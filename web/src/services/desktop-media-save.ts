import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { assertUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { uploadResourceFile } from "@/services/api/resources";

export type OwnedMediaSaveResult = "saved" | "cancelled";

export const MAX_OWNED_ARTIFACT_BYTES = 32 * 1024 * 1024;

export function isWailsNativeShell() {
    if (typeof window === "undefined") return false;
    return window.location?.protocol === "wails:" || typeof window.go?.main?.DesktopApp?.SaveOwnedMedia === "function" || typeof window.go?.main?.DesktopApp?.SaveOwnedArtifact === "function";
}

export async function downloadOwnedOrBrowserMedia(options: { fileName: string; resourceId?: string; browserUrl?: string }): Promise<OwnedMediaSaveResult> {
    const fileName = sanitizeDownloadFileName(options.fileName);
    if (isWailsNativeShell()) {
        const resourceId = options.resourceId?.trim();
        if (!resourceId) throw new Error("没有可导出的本机文件");
        const save = window.go?.main?.DesktopApp?.SaveOwnedMedia;
        if (!save) throw new Error("当前应用还不能把文件存到所选位置");
        const saved = await save(fileName, resourceId);
        return saved ? "saved" : "cancelled";
    }
    const browserUrl = options.browserUrl?.trim();
    if (!browserUrl) throw new Error("没有可导出的文件");
    saveAs(browserUrl, fileName);
    return "saved";
}

export async function saveOwnedOrBrowserBlob(fileName: string, blob: Blob): Promise<OwnedMediaSaveResult> {
    const name = sanitizeDownloadFileName(fileName, "未命名导出");
    if (isWailsNativeShell()) {
        if (blob.size > MAX_OWNED_ARTIFACT_BYTES) return saveChunkedArtifact(name, blob);
        const save = window.go?.main?.DesktopApp?.SaveOwnedArtifact;
        if (!save) throw new Error("当前应用还不能把文件存到所选位置");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await save(name, bytesToBase64(bytes));
        return saved ? "saved" : "cancelled";
    }
    saveAs(blob, name);
    return "saved";
}

async function saveChunkedArtifact(name: string, blob: Blob): Promise<OwnedMediaSaveResult> {
    const binding = window.go?.main?.DesktopApp;
    if (!binding?.BeginOwnedArtifact || !binding.AppendOwnedArtifact || !binding.AbortOwnedArtifact) throw new Error("当前应用不支持大资产包，请更新后再导出");
    const id = await binding.BeginOwnedArtifact(name, blob.size);
    if (!id) return "cancelled";
    let complete = false;
    try {
        const chunkSize = 1024 * 1024;
        for (let offset = 0; offset < blob.size; offset += chunkSize) {
            const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
            const saved = await binding.AppendOwnedArtifact(id, offset, bytesToBase64(chunk));
            if (saved !== (offset + chunk.length === blob.size)) throw new Error("导出文件未完整保存，请重新导出");
            complete = saved;
        }
        return "saved";
    } finally {
        if (!complete) await binding.AbortOwnedArtifact(id);
    }
}

/** Video exports use the resource upload path so large files never cross Wails as base64. */
export async function saveOwnedOrBrowserVideoBlob(fileName: string, blob: Blob, expectedScope: CapturedUserScope): Promise<OwnedMediaSaveResult> {
    assertUserScope(expectedScope);
    if (!isWailsNativeShell()) return saveOwnedOrBrowserBlob(fileName, blob);
    if (!window.go?.main?.DesktopApp?.SaveOwnedMedia) throw new Error("当前应用还不能把文件存到所选位置");
    const name = sanitizeDownloadFileName(fileName, "未命名导出.mp4");
    const resource = await uploadResourceFile(blob, "video", {
        fileName: name,
        expectedScope,
        idempotencyKey: `video-export:${nanoid()}`,
    });
    assertUserScope(expectedScope);
    return downloadOwnedOrBrowserMedia({ fileName: name, resourceId: resource.id });
}

function bytesToBase64(bytes: Uint8Array) {
    const toBase64 = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
    if (typeof toBase64 === "function") return toBase64.call(bytes);
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

export function reportOwnedMediaSave(message: { success: (text: string) => void; error: (text: string) => void }, result: Promise<OwnedMediaSaveResult>) {
    return result
        .then((status) => {
            if (status === "saved" && isWailsNativeShell()) message.success("已保存到所选位置");
        })
        .catch((error) => {
            message.error(error instanceof Error && error.message.trim() ? error.message : "保存没有完成，请再试一次");
        });
}
