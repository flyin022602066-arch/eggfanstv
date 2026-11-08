import type { Asset } from "@/stores/use-asset-store";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { replaceProjectAssetImage, type ProjectAsset } from "@/services/api/projects";
import { uploadCharacterLookImage } from "@/services/api/project-character-references";
import { assertUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import type { ReferenceImage } from "@/types/image";

export function projectAssetLibraryReference(asset: Asset | undefined): ReferenceImage {
    if (asset?.kind !== "image") throw new Error("请选择一张图片素材");
    if (!resourceIdFromStorageKey(asset.data.storageKey)) throw new Error("所选图片尚未保存到资源库，请先完成同步");
    return { id: asset.id, name: asset.title, storageKey: asset.data.storageKey, dataUrl: "", type: asset.data.mimeType || "image/*" };
}

const dependencies = { replaceImage: replaceProjectAssetImage, bindCharacter: uploadCharacterLookImage };

export async function useLibraryImageForProjectAsset(projectId: string, asset: ProjectAsset, source: Asset | undefined, expectedScope: CapturedUserScope, api = dependencies) {
    assertUserScope(expectedScope);
    const reference = projectAssetLibraryReference(source);
    const resourceId = resourceIdFromStorageKey(reference.storageKey)!;
    if (asset.character) return api.bindCharacter(projectId, asset.id, asset.character.versionId, resourceId, expectedScope);
    if (asset.category !== "environment" && asset.category !== "prop") throw new Error("请选择角色、场景或道具资产");
    return api.replaceImage(projectId, asset.id, resourceId, expectedScope);
}
