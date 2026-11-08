import { sunoMusicVideoAssetRequest } from "@/lib/suno-music-video-generation";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import type { SunoMusicVideoAsset } from "@/lib/suno-music-video-plan";
import type { CharacterFacePresets } from "@/lib/project-character-face-presets";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export { analyzeSunoMusicVideoLyrics, refreshSunoMusicVideo, submitSunoMusicVideo } from "../../src/services/suno-music-video";

const requests: { assetId: string; input: unknown }[] = [];
const pending = new Map<string, { resolve: (value: ReferenceImage) => void; reject: (error: Error) => void }>();
Object.assign(window, { mvAssetService: {
    requests,
    finish: (assetId: string, error?: string) => {
        const task = pending.get(assetId);
        if (!task) throw new Error(`Missing fixture request ${assetId}`);
        pending.delete(assetId);
        if (error) task.reject(new Error(error));
        else task.resolve({ id: assetId, name: assetId, type: "image/png", dataUrl: "", storageKey: `resource:generated-${assetId}` });
    },
} });

export async function generateSunoMusicVideoAssetImage(asset: SunoMusicVideoAsset, model: string, visualStyle: string, presets: CharacterFacePresets, config: AiConfig) {
    const prepared = await prepareBackendGenerationTask(sunoMusicVideoAssetRequest(asset, model, visualStyle, config, presets));
    requests.push({ assetId: asset.id, input: prepared.input });
    return new Promise<ReferenceImage>((resolve, reject) => pending.set(asset.id, { resolve, reject }));
}
