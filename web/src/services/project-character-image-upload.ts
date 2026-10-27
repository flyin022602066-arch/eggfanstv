import { readFileAsDataUrl, readImageMeta } from "@/lib/image-utils";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { ImageAsset, NewAsset } from "@/stores/use-asset-store";
import { assertUserScope, captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";

type CharacterImageUploadDependencies = {
    uploadMediaFile?: typeof uploadMediaFile;
    readFileAsDataUrl?: typeof readFileAsDataUrl;
    readImageMeta?: typeof readImageMeta;
};

export async function uploadCharacterImageAssets(
    files: FileList | readonly File[],
    addAsset: (asset: NewAsset) => string,
    dependencies: CharacterImageUploadDependencies = {},
    expectedScope: CapturedUserScope = captureUserScope(),
) {
    const upload = dependencies.uploadMediaFile || uploadMediaFile;
    const readDataUrl = dependencies.readFileAsDataUrl || readFileAsDataUrl;
    const readMeta = dependencies.readImageMeta || readImageMeta;
    const ids: string[] = [];

    assertUserScope(expectedScope);
    for (const file of Array.from(files)) {
        assertUserScope(expectedScope);
        if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
        const dataUrl = await readDataUrl(file);
        assertUserScope(expectedScope);
        const meta = await readMeta(dataUrl);
        assertUserScope(expectedScope);
        const uploaded = await upload(file, "character-image", undefined, expectedScope);
        assertUserScope(expectedScope);
        ids.push(addAsset({
            kind: "image",
            title: file.name.replace(/\.[^.]+$/, "") || "角色三视图",
            coverUrl: uploaded.url,
            tags: ["角色三视图"],
            category: "character",
            status: "confirmed",
            source: "角色替换上传",
            data: {
                dataUrl: uploaded.url,
                storageKey: uploaded.storageKey,
                width: uploaded.width ?? meta.width,
                height: uploaded.height ?? meta.height,
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType || file.type || meta.mimeType,
            },
        }));
    }

    return ids;
}

export function characterImageRepresentations(resourceId: string, sourceAssetId: string) {
    return [
        { role: "turnaround_sheet" as const, resourceId, metadata: { sourceAssetId } },
        { role: "primary" as const, resourceId, metadata: { source: "turnaround_sheet", sourceAssetId } },
    ];
}

export type CharacterImageAsset = ImageAsset;
export type UploadedCharacterImage = UploadedFile;
