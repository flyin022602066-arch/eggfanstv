import { useRef, useState } from "react";
import { characterFacePresetForAsset } from "@/lib/project-character-face-presets";
import { resolveSunoMusicVideoImageConfig } from "@/lib/suno-music-video-generation";
import type { SunoMusicVideoAsset, SunoMusicVideoPlan } from "@/lib/suno-music-video-plan";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError } from "@/lib/user-scope-guard";
import { generateSunoMusicVideoAssetImage } from "@/services/suno-music-video";
import { useConfigStore } from "@/stores/use-config-store";
import { useSunoStudioStore, type SunoMusicVideoDraft } from "@/stores/use-suno-studio-store";

function planKey(plan?: SunoMusicVideoPlan) {
    return plan ? JSON.stringify([plan.songJobId, plan.songClipId, plan.createdAt]) : "";
}

function assetInput(draft: SunoMusicVideoDraft, asset: SunoMusicVideoAsset) {
    const face = asset.category === "character" ? characterFacePresetForAsset(JSON.stringify(draft.characterFacePresets || {}), asset.id) : undefined;
    return JSON.stringify([draft.plan?.visualStyle, asset.name, asset.category, asset.description, asset.imagePrompt, face?.resourceId, face?.role]);
}

export function useMvAssetGeneration(plan: SunoMusicVideoPlan | undefined, scope: string) {
    const [states, setStates] = useState<Record<string, { pending: boolean; error?: string }>>({});
    const [batchKey, setBatchKey] = useState("");
    const active = useRef(new Map<string, Promise<void>>());
    const batches = useRef(new Set<string>());
    const key = JSON.stringify([scope, planKey(plan)]);
    const assetKey = (assetId: string) => JSON.stringify([key, assetId]);

    const generate = (assetId: string): Promise<void> => {
        const requestKey = assetKey(assetId);
        const existing = active.current.get(requestKey);
        if (existing) return existing;
        const snapshot = useSunoStudioStore.getState();
        const draft = snapshot.musicVideoDraft;
        const current = draft.plan;
        const asset = current?.assets.find((item) => item.id === assetId);
        if (snapshot.scope !== scope || !current || !asset || planKey(current) !== planKey(plan) || current.lyrics !== (draft.lyrics ?? current.lyrics).trim()) return Promise.resolve();
        const expectedScope = captureUserScope();
        const input = assetInput(draft, asset);
        setStates((previous) => ({ ...previous, [requestKey]: { pending: true } }));
        const task = Promise.resolve().then(async () => {
            try {
                assertUserScope(expectedScope);
                const config = resolveSunoMusicVideoImageConfig(useConfigStore.getState().config, asset.category, draft.assetImagePresets?.[asset.category], draft.ratio);
                const reference = await generateSunoMusicVideoAssetImage(asset, config.model, current.visualStyle, draft.characterFacePresets, config);
                assertUserScope(expectedScope);
                const latest = useSunoStudioStore.getState();
                const next = latest.musicVideoDraft;
                if (latest.scope !== scope || planKey(next.plan) !== planKey(current)) return;
                const latestAsset = next.plan?.assets.find((item) => item.id === assetId);
                if (!latestAsset || assetInput(next, latestAsset) !== input || (next.lyrics ?? next.plan?.lyrics)?.trim() !== current.lyrics) throw new Error("生成期间资产设定已更改，旧结果未替换，请按最新设定重新生成");
                latest.setMusicVideoDraft({ plan: { ...next.plan!, assets: next.plan!.assets.map((item) => item.id === assetId ? { ...item, reference } : item) } });
            } catch (cause) {
                if (!isUserScopeAbandonedError(cause)) setStates((previous) => ({ ...previous, [requestKey]: { pending: false, error: cause instanceof Error ? cause.message : "资产图片生成失败" } }));
            } finally {
                active.current.delete(requestKey);
                setStates((previous) => ({ ...previous, [requestKey]: { ...previous[requestKey], pending: false } }));
            }
        });
        active.current.set(requestKey, task);
        return task;
    };

    const generateMissing = async () => {
        if (!plan || batches.current.has(key)) return;
        batches.current.add(key);
        setBatchKey(key);
        const missing = plan.assets.filter((asset) => !asset.reference?.storageKey && !asset.reference?.url);
        let cursor = 0;
        try {
            await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
                while (cursor < missing.length) {
                    const asset = missing[cursor++]!;
                    const latest = useSunoStudioStore.getState();
                    if (latest.scope !== scope || planKey(latest.musicVideoDraft.plan) !== planKey(plan)) return;
                    const current = latest.musicVideoDraft.plan?.assets.find((item) => item.id === asset.id);
                    if (current?.reference?.storageKey || current?.reference?.url) continue;
                    await generate(asset.id);
                }
            }));
        } finally {
            batches.current.delete(key);
            setBatchKey((previous) => previous === key ? "" : previous);
        }
    };

    return {
        generate,
        generateMissing,
        batchGenerating: batchKey === key,
        pending: (assetId: string) => Boolean(states[assetKey(assetId)]?.pending),
        error: (assetId: string) => states[assetKey(assetId)]?.error,
    };
}
