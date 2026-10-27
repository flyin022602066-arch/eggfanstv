import { expect, test } from "bun:test";
import { characterImageRepresentations, uploadCharacterImageAssets } from "../src/services/project-character-image-upload";
import type { NewAsset } from "../src/stores/use-asset-store";

test("角色替换上传会保存图片素材并返回可选中的素材 ID", async () => {
    const added: NewAsset[] = [];
    const ids = await uploadCharacterImageAssets(
        [new File(["image"], "王大牛三视图.png", { type: "image/png" })],
        (asset) => {
            added.push(asset);
            return "asset-character-upload";
        },
        {
            readFileAsDataUrl: async () => "data:image/png;base64,fixture",
            readImageMeta: async () => ({ width: 2400, height: 1600, mimeType: "image/png" }),
            uploadMediaFile: async () => ({ url: "/api/resources/image/file", storageKey: "resource:image", bytes: 2048, mimeType: "image/png" }),
        },
    );

    expect(ids).toEqual(["asset-character-upload"]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: "image", title: "王大牛三视图", category: "character", source: "角色替换上传" });
    expect(added[0].data).toMatchObject({ storageKey: "resource:image", width: 2400, height: 1600 });
});

test("角色替换上传拒绝非图片文件", async () => {
    await expect(uploadCharacterImageAssets([new File(["text"], "王大牛.txt", { type: "text/plain" })], () => "unused")).rejects.toThrow("请选择图片文件");
});

test("角色替换使用新图片同时更新三视图和主图版本", () => {
    expect(characterImageRepresentations("resource:image", "asset-character-upload")).toEqual([
        { role: "turnaround_sheet", resourceId: "resource:image", metadata: { sourceAssetId: "asset-character-upload" } },
        { role: "primary", resourceId: "resource:image", metadata: { source: "turnaround_sheet", sourceAssetId: "asset-character-upload" } },
    ]);
});
