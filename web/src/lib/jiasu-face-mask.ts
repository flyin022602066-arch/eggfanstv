export type GridFaceMaskMode = "grid" | "grid-60" | "grid-75";
export type JiasuFaceMaskMode = GridFaceMaskMode | "mosaic" | "off";

export const faceMaskGridOptions = [
    { value: "grid", label: "50%", density: 50 },
    { value: "grid-60", label: "60%", density: 60 },
    { value: "grid-75", label: "75%", density: 75 },
] as const;

export function isGridFaceMaskMode(value: unknown): value is GridFaceMaskMode {
    return faceMaskGridOptions.some((option) => option.value === value);
}

export type JiasuFaceRegion = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type JiasuFaceMaskOverride = {
    sourceHash: string;
    storageKey?: string;
    regions: JiasuFaceRegion[];
};

export type JiasuFaceMaskOverrides = Record<string, JiasuFaceMaskOverride>;

export function normalizeJiasuFaceMaskMode(value: unknown): JiasuFaceMaskMode {
    return value === "off" || value === "mosaic" || isGridFaceMaskMode(value) ? value : "grid";
}

export function isJiasuSdModel(protocol: string | undefined, model: string) {
    return protocol === "jiasu-video" && /^(?:dola-sd-2\.(?:0|5)|sd-2\.5-j2-v)$/i.test(model.split("::").at(-1)?.trim() || "");
}

export function jiasuModelSupportsServerFace(model: string) {
    return (model.split("::").at(-1)?.trim().toLowerCase() || "") !== "sd-2.5-j2-v";
}

export function clampJiasuFaceRegion(region: JiasuFaceRegion): JiasuFaceRegion {
    const finite = [region.x, region.y, region.width, region.height].every(Number.isFinite);
    if (!finite) throw new Error("人脸遮罩区域无效，请重新框选");
    const left = Math.max(0, Math.min(1, Math.min(region.x, region.x + region.width)));
    const top = Math.max(0, Math.min(1, Math.min(region.y, region.y + region.height)));
    const right = Math.max(left, Math.min(1, Math.max(region.x, region.x + region.width)));
    const bottom = Math.max(top, Math.min(1, Math.max(region.y, region.y + region.height)));
    return { ...region, x: left, y: top, width: right - left, height: bottom - top };
}

export function jiasuFaceMaskCacheKey(scope: string, sourceHash: string, mode: JiasuFaceMaskMode, regions: JiasuFaceRegion[], channel: "jiasu" | "eggfans-sd2" = "jiasu") {
    return JSON.stringify([`${channel}-face-mask-v1`, scope, sourceHash, mode, regions.map(({ x, y, width, height }) => ({ x, y, width, height }))]);
}

export async function renderJiasuFaceMask(source: Blob, regions: JiasuFaceRegion[], mode: JiasuFaceMaskMode): Promise<Blob> {
    if (mode === "off" || !regions.length) return source;
    const bitmap = await createImageBitmap(source);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建人脸遮罩预览");
        context.drawImage(bitmap, 0, 0);
        for (const value of regions) {
            const region = clampJiasuFaceRegion(value);
            const left = region.x * canvas.width;
            const top = region.y * canvas.height;
            const width = region.width * canvas.width;
            const height = region.height * canvas.height;
            if (width < 1 || height < 1) continue;
            if (mode === "mosaic") {
                const tile = document.createElement("canvas");
                tile.width = Math.max(1, Math.ceil(width / Math.max(8, width / 16)));
                tile.height = Math.max(1, Math.ceil(height / Math.max(8, width / 16)));
                const tileContext = tile.getContext("2d");
                if (!tileContext) throw new Error("无法创建人脸马赛克");
                tileContext.drawImage(bitmap, left, top, width, height, 0, 0, tile.width, tile.height);
                context.imageSmoothingEnabled = false;
                context.drawImage(tile, left, top, width, height);
                context.imageSmoothingEnabled = true;
            } else {
                const density = faceMaskGridOptions.find((option) => option.value === mode)?.density ?? 50;
                const step = Math.max(6, width / 18) * 50 / density;
                context.save();
                context.beginPath();
                context.rect(left, top, width, height);
                context.clip();
                context.fillStyle = "rgba(150,150,150,0.18)";
                context.fillRect(left, top, width, height);
                context.strokeStyle = "rgba(255,255,255,0.42)";
                context.lineWidth = Math.max(0.6, width / 280);
                context.beginPath();
                for (let horizontal = left; horizontal <= left + width; horizontal += step) {
                    context.moveTo(horizontal, top);
                    context.lineTo(horizontal, top + height);
                }
                for (let vertical = top; vertical <= top + height; vertical += step) {
                    context.moveTo(left, vertical);
                    context.lineTo(left + width, vertical);
                }
                context.stroke();
                context.restore();
            }
        }
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("人脸遮罩图片保存失败")), "image/png"));
    } finally {
        bitmap.close();
    }
}
