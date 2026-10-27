import { isGridFaceMaskMode, type JiasuFaceMaskMode } from "@/lib/jiasu-face-mask";

export function isEggfansSd2DModel(protocol: string | undefined, model: string) {
    return protocol === "eggfans-sd2-video" && /^sd-2\.5-D$/i.test(model.split("::").at(-1)?.trim() || "");
}

export function normalizeSd2FaceMaskMode(value: unknown): JiasuFaceMaskMode {
    return isGridFaceMaskMode(value) || value === "mosaic" ? value : "off";
}

export function usesSd2LocalFaceMask(protocol: string | undefined, model: string, mode: unknown) {
    return isEggfansSd2DModel(protocol, model) && normalizeSd2FaceMaskMode(mode) !== "off";
}
