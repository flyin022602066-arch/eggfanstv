export const EGGFANS_SEEDANCE_PROTOCOL = "eggfans-seedance-video";
export const EGGFANS_VOLC_PROTOCOL = "eggfans-volc-video";
export const EGGFANS_AVATAR_MODEL = "doubao-seedance-2-0-260128";

export type EggfansReferenceMode = "uri" | "url";

export function normalizeEggfansReferenceMode(value: unknown): EggfansReferenceMode {
    return value === "url" ? "url" : "uri";
}

export function isEggfansSeedanceProtocol(protocol?: string) {
    return protocol === EGGFANS_SEEDANCE_PROTOCOL || protocol === EGGFANS_VOLC_PROTOCOL;
}

export function isEggfansBaseUrl(baseUrl: string) {
    try {
        return new URL(baseUrl).hostname.toLowerCase() === "api.eggfans.com";
    } catch {
        return false;
    }
}

export function isSeedanceModelName(model: string) {
    return /(?:^|::)(?:doubao-)?seedance[-.]/i.test(model);
}
