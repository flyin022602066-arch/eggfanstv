import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export { musicVideoAudioSegmentSeconds, musicVideoAudioStartLimit, musicVideoEffectiveDuration, musicVideoMinimumImages } from "@/lib/suno-music-video";

export function compatibleMusicVideoModels(config: AiConfig) {
    return selectableModelsByCapability(config, "video").filter((model) => {
        const protocol = resolveModelRequestConfig(config, model).interfaceType;
        const profile = modelCapabilityConfigFor(config, model).video;
        if (!profile || protocol === "ark-task-gateway-video-25" || profile.references.maxAudios < 1) return false;
        return profile.references.maxImages > 0;
    });
}
