import { Zip, ZipPassThrough } from "fflate";
import { mediaFileExtension, sanitizeDownloadFileName } from "@/lib/canvas/canvas-media-download";
import { assertUserScope, captureUserScope } from "@/lib/user-scope-guard";
import type { ProjectDetail } from "@/services/api/projects";
import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";
import { saveOwnedOrBrowserBlob } from "@/services/desktop-media-save";
import { currentArtifact } from "./workflow-shared";

export function chapterVideoDownloadFiles(detail: ProjectDetail, unitId: string) {
    const shots = detail.shots.filter((shot) => shot.unitId === unitId).slice().sort((left, right) => left.position - right.position);
    if (!shots.length) throw new Error("本集还没有分镜");
    const missing: string[] = [];
    const files = shots.map((shot, index) => {
        const artifact = currentArtifact(detail, shot.id, "video");
        const label = `镜头${String(index + 1).padStart(2, "0")}`;
        if (!artifact?.resourceId || !["ready", "stale"].includes(artifact.status)) missing.push(label);
        return { resourceId: artifact?.resourceId || "", label, fileName: sanitizeDownloadFileName(`${String(index + 1).padStart(3, "0")}_${shot.title || label}_v${artifact?.version || 1}.mp4`) };
    });
    if (missing.length) throw new Error(`本集尚未全部生成并取回视频：${missing.join("、")}。请完成后再下载整集。`);
    return files;
}
export async function downloadProjectUnitVideos(detail: ProjectDetail, unitId: string, onProgress?: (completed: number, total: number) => void) {
    const scope = captureUserScope();
    const files = chapterVideoDownloadFiles(detail, unitId);
    const chunks: BlobPart[] = [];
    let archiveError: Error | undefined, finalized = false;
    const archive = new Zip((error, data, final) => {
        if (error) { archiveError = error; return; }
        chunks.push(Uint8Array.from(data));
        finalized = final;
    });
    try {
        onProgress?.(0, files.length);
        for (const [index, file] of files.entries()) {
            assertUserScope(scope);
            const blob = await getResourceBlob(resourceStorageKey(file.resourceId), { expectedScope: scope });
            assertUserScope(scope);
            if (!blob?.size) throw new Error(`${file.label}下载失败：无法读取视频原文件，请重新取回后再试`);
            const extension = mediaFileExtension(blob.type);
            const entry = new ZipPassThrough(extension ? file.fileName.replace(/\.mp4$/, "." + extension) : file.fileName);
            archive.add(entry);
            const chunkSize = 1024 * 1024;
            for (let offset = 0; offset < blob.size; offset += chunkSize) {
                const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
                assertUserScope(scope);
                entry.push(bytes, offset + bytes.length === blob.size);
                if (archiveError) throw archiveError;
            }
            onProgress?.(index + 1, files.length);
        }
        archive.end();
        if (archiveError) throw archiveError;
        if (!finalized) throw new Error("本集视频打包未完成，请重试");
        assertUserScope(scope);
        const title = detail.units.find((unit) => unit.id === unitId)?.title || "本集";
        return await saveOwnedOrBrowserBlob(sanitizeDownloadFileName(`${detail.project.name}_${title}_全部镜头.zip`), new Blob(chunks, { type: "application/zip" }));
    } finally {
        archive.terminate();
    }
}
