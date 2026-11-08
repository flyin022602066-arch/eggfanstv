import { expect, test } from "bun:test";
import { musicVideoAudioSegmentSeconds, musicVideoAudioStartLimit, musicVideoEffectiveDuration, musicVideoMinimumImages } from "../src/lib/suno-music-video";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocol } from "../src/lib/model-protocols";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { compatibleMusicVideoModels } from "../src/pages/music/studio-mv-helpers";

test("MV audio references stay within both model and generated-video limits", () => {
    expect(musicVideoAudioSegmentSeconds(30, { maxAudioDurationSeconds: 20, maxAudioTotalDurationSeconds: 15 })).toBe(15);
    expect(musicVideoAudioSegmentSeconds(12, { maxAudioDurationSeconds: 20, maxAudioTotalDurationSeconds: 0 })).toBe(12);
    expect(musicVideoAudioSegmentSeconds(0, { maxAudioDurationSeconds: 0, maxAudioTotalDurationSeconds: 0 })).toBe(5);
});

test("MV audio start never passes the end of the selected song", () => {
    expect(musicVideoAudioStartLimit(180, 30)).toBe(150);
    expect(musicVideoAudioStartLimit(12, 30)).toBe(0);
});

test("automatic MV duration selects a valid audio-reference segment", () => {
    const profile = {
        duration: { default: -1, max: 30, values: [-1, 5, 10, 15, 30] },
        references: { minImages: 0, maxAudioDurationSeconds: 15, maxAudioTotalDurationSeconds: 15 },
        operations: ["image_to_video"],
    } as import("../src/lib/model-capabilities").VideoCapabilityConfig;
    const duration = musicVideoEffectiveDuration(-1, profile);
    expect(duration).toBe(30);
    expect(musicVideoAudioSegmentSeconds(duration, profile.references)).toBe(15);
    expect(musicVideoMinimumImages(profile)).toBe(1);
});

test("audio-to-video models may generate without an image, but other models require one", () => {
    const profile = {
        duration: { default: 5 },
        references: { minImages: 0 },
        operations: ["audio_to_video"],
    } as import("../src/lib/model-capabilities").VideoCapabilityConfig;
    expect(musicVideoMinimumImages(profile)).toBe(0);
});

test("MV model list includes only configured video models with image and audio references", () => {
    const makeChannel = (id: string, protocol: ModelProtocol, maxImages: number, operations: string[]) => {
        const capabilityConfig = defaultModelCapabilityConfig(protocol, id);
        return createModelChannel({
            id,
            name: id,
            baseUrl: `https://${id}.example`,
            models: [id],
            modelProfiles: [{
                model: id,
                capability: "video",
                protocol,
                capabilityConfig: {
                    ...capabilityConfig,
                    video: {
                        ...capabilityConfig.video!,
                        references: { ...capabilityConfig.video!.references, maxAudios: 1, maxImages },
                        operations,
                    },
                },
            }],
        });
    };
    const config = {
        ...defaultConfig,
        channels: [
            makeChannel("seedance-2.0", "newapi-channel-2", 4, ["image_to_video"]),
            makeChannel("audio-to-video", "newapi-channel-2", 0, ["audio_to_video"]),
            makeChannel("video-only-audio-ref", "newapi-channel-2", 0, ["video_to_video"]),
            makeChannel("ark-audio-ref", "ark-task-gateway-video-25", 4, ["image_to_video"]),
        ],
    };
    expect(compatibleMusicVideoModels(config)).toEqual(["seedance-2.0::seedance-2.0"]);
});
