import type { VideoCapabilityConfig } from "@/lib/model-capabilities";

export function musicVideoMinimumImages(profile: VideoCapabilityConfig) {
    return Math.max(profile.references.minImages || 0, profile.operations.includes("audio_to_video") ? 0 : 1);
}

export function musicVideoEffectiveDuration(videoSeconds: number, profile: VideoCapabilityConfig) {
    if (videoSeconds > 0) return videoSeconds;
    const candidates = [
        profile.duration.max,
        ...(profile.duration.values || []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0),
        profile.references.maxAudioDurationSeconds,
        profile.references.maxAudioTotalDurationSeconds,
        profile.duration.default,
        5,
    ];
    return candidates.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0) || 5;
}

export function musicVideoAudioSegmentSeconds(videoSeconds: number, limits: VideoCapabilityConfig["references"]) {
    const candidates = [videoSeconds, limits.maxAudioDurationSeconds || videoSeconds, limits.maxAudioTotalDurationSeconds || videoSeconds].filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length ? Math.min(...candidates) : 5;
}

export function musicVideoAudioStartLimit(songDuration: number, segmentDuration: number) {
    return Math.max(0, Math.floor(songDuration - segmentDuration));
}
