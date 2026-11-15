import { normalizeSd2FaceMaskMode } from "./eggfans-sd2-face-mask";
import type { JiasuFaceMaskMode } from "./jiasu-face-mask";

export function normalizeDoubaoBrowserFaceMaskMode(value: unknown): JiasuFaceMaskMode {
    return value === "blur" || value === "solid" ? value : normalizeSd2FaceMaskMode(value);
}

export const DOUBAO_BROWSER_PROTOCOL = "doubao-browser-video";
export const DOUBAO_BROWSER_MODELS = ["seedance_v2.5", "seedance_v2.0_std", "seedance_v2.0", "seedance_v2.0_mini"];
export const DOUBAO_BROWSER_MODEL_NAMES: Record<string, string> = {
    "seedance_v2.5": "Seedance 2.5", "seedance_v2.0_std": "Seedance 2.0", "seedance_v2.0": "Seedance 2.0 Fast", "seedance_v2.0_mini": "Seedance 2.0 Mini",
};
export function isDoubaoBrowserChannel(channel: { id: string; interfaceType?: string; modelProfiles?: Array<{ protocol?: string }> }) {
    return channel.id === "doubao-browser" && (channel.interfaceType === DOUBAO_BROWSER_PROTOCOL || Boolean(channel.modelProfiles?.some(profile => profile.protocol === DOUBAO_BROWSER_PROTOCOL)));
}
