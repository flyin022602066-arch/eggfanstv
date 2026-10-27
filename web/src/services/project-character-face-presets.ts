import { readFileAsDataUrl, readImageMeta } from "@/lib/image-utils";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import type { CharacterFacePreset } from "@/lib/project-character-face-presets";
import { uploadResourceFile } from "@/services/api/resources";

export async function uploadCharacterFaceReference(file: File, dependencies = { readFileAsDataUrl, readImageMeta, uploadResourceFile }): Promise<Pick<CharacterFacePreset, "resourceId" | "fileName">> {
    const expectedScope = captureUserScope();
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请上传 JPG、PNG 或 WebP 人脸图片");
    const dataUrl = await dependencies.readFileAsDataUrl(file);
    assertUserScope(expectedScope);
    const meta = await dependencies.readImageMeta(dataUrl);
    assertUserScope(expectedScope);
    if (!meta.width || !meta.height) throw new Error("无法读取人脸图片，请更换有效图片");
    const resource = await dependencies.uploadResourceFile(file, "image", { fileName: file.name, width: meta.width, height: meta.height, expectedScope });
    assertUserScope(expectedScope);
    if (resource.status !== "ready" || !resource.id) throw new Error("人脸参考图尚未保存完成，请重试");
    return { resourceId: resource.id, fileName: file.name };
}
