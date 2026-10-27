import { nanoid } from "nanoid";
import { parseAssetRecordList } from "@/lib/asset-record";
import { createZip, readZip } from "@/lib/zip";
import { saveOwnedOrBrowserBlob, type OwnedMediaSaveResult } from "@/services/desktop-media-save";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { normalizeLocalAsset } from "@/lib/local-workspace-migration";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { Asset } from "@/stores/use-asset-store";
import { archiveFileExtension, assertUniqueArchiveNames, ExportIntegrityError, type MissingExportFile } from "@/lib/export-integrity";

type MediaAsset = Exclude<Asset, { kind: "text" | "entity" }>;
type AssetExportItem = { storageKey: string; assetId?: string; role?: "media" | "cover"; path: string; mimeType: string; bytes: number };
type AssetExportFile = { app: "infinite-canvas"; version: 1 | 2; exportedAt: string; workflow?: { id: string; name: string }; assets: Asset[]; files: AssetExportItem[] };
type PackageOptions = { workflow?: { id: string; name: string }; fileName?: string };
type TransferDependencies = {
    readMedia: (asset: MediaAsset) => Promise<Blob>;
    readCover: (url: string) => Promise<Blob>;
    storeMedia: (blob: Blob, asset: MediaAsset) => Promise<{ storageKey: string; url: string }>;
};

async function fetchBlob(url: string) {
    if (!url) throw new Error("素材缺少文件地址");
    const response = await fetch(url, { credentials: /^(?:blob:|data:|https?:)/i.test(url) ? "same-origin" : "include" });
    if (!response.ok) throw new Error(`读取素材失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.size || blob.type.includes("text/html")) throw new Error("素材文件无效或链接已失效");
    return blob;
}

const defaults: TransferDependencies = {
    readMedia: async (asset) => {
        const key = asset.data.storageKey;
        const stored = key ? await (asset.kind === "image" ? getImageBlob(key) : getMediaBlob(key)) : null;
        return stored || fetchBlob(asset.kind === "image" ? asset.data.dataUrl : asset.data.url);
    },
    readCover: fetchBlob,
    storeMedia: async (blob, asset) => {
        if (usesBrowserLocalResourceStore()) {
            const storageKey = `${asset.kind === "image" ? "image" : "file"}:${getActiveUserScope()}:${nanoid()}`;
            const url = await (asset.kind === "image" ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
            return { storageKey, url };
        }
        const resource = await uploadResourceFile(blob, asset.kind === "model" ? "file" : asset.kind, { fileName: `${safeFileName(asset.title)}.${fileExtension(blob.type, asset.kind)}`, ...(asset.kind === "image" || asset.kind === "video" ? { width: asset.data.width, height: asset.data.height } : {}), ...("durationMs" in asset.data ? { durationMs: asset.data.durationMs } : {}) });
        return { storageKey: resourceStorageKey(resource.id), url: resourceFileUrl(resource.id) };
    },
};

export async function createAssetPackage(assets: Asset[], options: PackageOptions = {}, overrides: Partial<TransferDependencies> = {}) {
    if (!assets.length) throw new Error("暂无资产可导出");
    const dependencies = { ...defaults, ...overrides };
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedAssets: Asset[] = [];
    const missingFiles: MissingExportFile[] = [];
    for (const [index, original] of assets.entries()) {
        const asset = structuredClone(isLocalWorkspaceMode() ? normalizeLocalAsset(original) : original);
        const stem = `${String(index + 1).padStart(3, "0")}-${safeFileName(asset.title || asset.kind)}`;
        if (asset.kind === "text") {
            zipFiles.push({ name: `assets/text/${stem}.txt`, data: asset.data.content });
        } else if (asset.kind !== "entity") {
            let blob: Blob;
            try {
                blob = await dependencies.readMedia(asset);
                if (!blob.size) throw new Error("文件为空");
            } catch (error) {
                missingFiles.push({ owner: asset.title || asset.id, reference: error instanceof Error ? error.message : "原始文件不可用" });
                continue;
            }
            const path = `assets/${asset.kind}/${stem}.${fileExtension(blob.type || asset.data.mimeType, asset.kind)}`;
            files.push({ storageKey: asset.data.storageKey || `package:${asset.id}`, assetId: asset.id, role: "media", path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
            asset.data = { ...asset.data, storageKey: asset.data.storageKey || `package:${asset.id}`, ...(asset.kind === "image" ? { dataUrl: "" } : { url: "" }) } as typeof asset.data;
            if (asset.kind === "image") asset.coverUrl = "";
            else if (asset.coverUrl) {
                try {
                    const cover = await dependencies.readCover(asset.coverUrl);
                    const coverPath = `covers/${stem}.${fileExtension(cover.type, "image")}`;
                    files.push({ storageKey: `cover:${asset.id}`, assetId: asset.id, role: "cover", path: coverPath, mimeType: cover.type, bytes: cover.size });
                    zipFiles.push({ name: coverPath, data: cover });
                } catch {
                    asset.coverUrl = "";
                }
            }
        }
        exportedAssets.push(asset);
    }
    if (missingFiles.length) throw new ExportIntegrityError(missingFiles);
    assertUniqueArchiveNames(["assets.json", ...zipFiles.map((file) => file.name)]);
    const data: AssetExportFile = { app: "infinite-canvas", version: 2, exportedAt: new Date().toISOString(), workflow: options.workflow, assets: exportedAssets, files };
    return createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
}

export async function exportAssets(assets: Asset[], options: PackageOptions = {}): Promise<OwnedMediaSaveResult> {
    const zip = await createAssetPackage(assets, options);
    return saveOwnedOrBrowserBlob(`${safeFileName(options.fileName || options.workflow?.name || "我的素材")}.zip`, zip);
}

export async function readAssetPackage(file: File, overrides: Partial<TransferDependencies> = {}) {
    const dependencies = { ...defaults, ...overrides };
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("资产包缺少 assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || ![1, 2].includes(data.version) || !Array.isArray(data.files)) throw new Error("资产包格式或版本不受支持");
    if (data.workflow && (typeof data.workflow.id !== "string" || !data.workflow.id.trim() || typeof data.workflow.name !== "string" || !data.workflow.name.trim())) throw new Error("资产包工作流信息无效");
    assertUniqueArchiveNames(["assets.json", ...data.files.map((item) => item.path)]);
    const assets = parseAssetRecordList(data.assets);
    if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error("资产包包含重复资产 ID");
    const entries = new Map<string, AssetExportItem>();
    for (const item of data.files) {
        if (!item || typeof item.storageKey !== "string" || !item.storageKey || (item.assetId !== undefined && typeof item.assetId !== "string") || (item.role !== undefined && item.role !== "media" && item.role !== "cover") || typeof item.path !== "string" || item.path.startsWith("/") || item.path.includes("\\") || item.path.split("/").some((part) => part === "..") || typeof item.mimeType !== "string" || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) throw new Error("资产包文件清单无效");
        const blob = zip.get(item.path);
        if (!blob || blob.size !== item.bytes) throw new Error(`资产包文件缺失或损坏：${item.path}`);
        const key = item.assetId ? `${item.assetId}:${item.role || "media"}` : item.storageKey;
        if (entries.has(key)) throw new Error("资产包包含重复文件记录");
        entries.set(key, item);
    }
    for (const asset of assets) {
        if (asset.kind === "text" || asset.kind === "entity") continue;
        if (!entries.has(`${asset.id}:media`) && !entries.has(asset.data.storageKey || "")) throw new Error(`资产包缺少「${asset.title}」的原始文件`);
    }
    const importedWorkflows = new Map<string, string>();
    const workflowId = (source: string) => {
        if (!importedWorkflows.has(source)) importedWorkflows.set(source, `imported-workflow-${nanoid()}`);
        return importedWorkflows.get(source)!;
    };
    for (const asset of assets) {
        asset.folderId = undefined;
        const originalMetadata = asset.metadata || {};
        const origin = typeof originalMetadata.workflowId === "string" ? originalMetadata.workflowId : typeof originalMetadata.canvasId === "string" ? originalMetadata.canvasId : undefined;
        const metadata = { ...originalMetadata };
        for (const key of ["canvasId", "canvasIds", "projectIds", "nodeId", "taskId", "resourceKey", "generationEffectKey"]) delete metadata[key];
        const source = data.workflow?.id || origin;
        const name = data.workflow?.name || originalMetadata.workflowName || originalMetadata.canvasName;
        asset.metadata = { ...metadata, source: "asset-package", ...(source ? { workflowId: workflowId(source), workflowName: typeof name === "string" ? name : "导入的工作流" } : {}) };
        if (asset.kind === "text" || asset.kind === "entity") continue;
        const item = entries.get(`${asset.id}:media`) || entries.get(asset.data.storageKey || "")!;
        const blob = zip.get(item.path)!.slice(0, item.bytes, item.mimeType);
        const stored = await dependencies.storeMedia(blob, asset);
        asset.data = { ...asset.data, storageKey: stored.storageKey, bytes: blob.size, mimeType: blob.type, ...(asset.kind === "image" ? { dataUrl: stored.url } : { url: stored.url }) } as typeof asset.data;
        const coverItem = entries.get(`${asset.id}:cover`);
        asset.coverUrl = asset.kind === "image" ? stored.url : "";
        if (coverItem) {
            const cover = zip.get(coverItem.path)!.slice(0, coverItem.bytes, coverItem.mimeType);
            const storedCover = await dependencies.storeMedia(cover, { ...asset, kind: "image", data: { dataUrl: "", width: 1, height: 1, bytes: cover.size, mimeType: cover.type } });
            asset.coverUrl = storedCover.url;
        }
    }
    return assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100) || "资产";
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/ogg": "ogg", "model/gltf-binary": "glb", "model/gltf+json": "gltf" };
    return extensions[mimeType] || archiveFileExtension(mimeType, kind === "image" ? "png" : "bin");
}
