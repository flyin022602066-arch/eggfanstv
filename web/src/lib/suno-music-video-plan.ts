import type { ReferenceImage } from "@/types/image";
import { characterFacePresetForAsset, parseCharacterFacePresets, type CharacterFacePresets } from "@/lib/project-character-face-presets";

export type SunoMusicVideoAssetCategory = "character" | "scene" | "prop";

export type SunoMusicVideoAsset = {
    id: string;
    name: string;
    category: SunoMusicVideoAssetCategory;
    description: string;
    imagePrompt: string;
    reference?: ReferenceImage;
};

export type SunoMusicVideoSegment = {
    id: string;
    index: number;
    startSeconds: number;
    durationSeconds: number;
    lyricExcerpt: string;
    visualSummary: string;
    prompt: string;
    assetIds: string[];
};

export type SunoMusicVideoPlan = {
    songJobId: string;
    songClipId: string;
    lyrics: string;
    visualStyle: string;
    assets: SunoMusicVideoAsset[];
    segments: SunoMusicVideoSegment[];
    createdAt: string;
};

export type MusicVideoRange = { index: number; startSeconds: number; durationSeconds: number };

export function updateSunoMusicVideoFacePresets(plan: SunoMusicVideoPlan, previous: CharacterFacePresets, next: CharacterFacePresets): SunoMusicVideoPlan {
    const oldRaw = JSON.stringify(previous);
    const newRaw = JSON.stringify(next);
    parseCharacterFacePresets(newRaw);
    return { ...plan, assets: plan.assets.map((asset) => {
        if (asset.category !== "character") return asset;
        const before = characterFacePresetForAsset(oldRaw, asset.id);
        const after = characterFacePresetForAsset(newRaw, asset.id);
        return before?.resourceId === after?.resourceId && before?.role === after?.role ? asset : { ...asset, reference: undefined };
    }) };
}

export function rebindSunoMusicVideoFacePresets(presets: CharacterFacePresets, previous: SunoMusicVideoPlan | undefined, next: SunoMusicVideoPlan): CharacterFacePresets {
    const sameSong = previous?.songJobId === next.songJobId && previous?.songClipId === next.songClipId;
    const used = new Set<string>();
    return Object.fromEntries(Object.entries(presets).filter(([, preset]) => preset).map(([role, preset]) => {
        const assetIds = sameSong ? preset.assetIds.flatMap((id) => {
            const before = previous?.assets.find((asset) => asset.id === id && asset.category === "character");
            const matches = before ? next.assets.filter((asset) => asset.category === "character" && asset.name.trim() === before.name.trim()) : [];
            if (matches.length !== 1 || used.has(matches[0]!.id)) return [];
            used.add(matches[0]!.id);
            return [matches[0]!.id];
        }) : [];
        return [role, { ...preset, assetIds }];
    }));
}

export function buildSunoMusicVideoBreakdownPrompt(input: { songTitle: string; songDuration: number; lyrics: string; ranges: MusicVideoRange[]; maxImagesPerSegment: number }) {
    const rangeList = input.ranges.map((range) => ({ index: range.index, startSeconds: range.startSeconds, endSeconds: range.startSeconds + range.durationSeconds, durationSeconds: range.durationSeconds }));
    return [
        "Preserve every lyric line in its original order and wording, including repeated choruses. Assign whole lyric lines to segments by estimating natural singing pace and the supplied time ranges; never cut a line across segments, omit, rewrite, or invent lyrics. Instrumental sections may have an empty lyricExcerpt.",
        "你是专业音乐 MV 导演，按短剧分镜流程工作：先理解整首歌的情绪弧线与歌词叙事，提取跨段复用的角色、场景、道具资产；再按 30 秒段落拆出可独立生成的视频分镜。",
        `歌曲：${input.songTitle}`,
        `歌曲时长：${input.songDuration} 秒。必须严格输出 ${input.ranges.length} 段，分段边界：${JSON.stringify(rangeList)}。除最后一段外每段完整覆盖 30 秒，最后一段覆盖剩余时长。严格按时间顺序，不得增删、合并或重排分段；按自然演唱速度将歌词整句分配给对应段落。`,
        `每段最多引用 ${input.maxImagesPerSegment} 张参考资产图；每段必须绑定至少一个场景资产，角色/道具只绑定本段实际出现者。assetIndexes 使用 assets 数组的 1 起始序号。`,
        "每段 prompt 都是可直接交给视频模型的完整提示词：先写本段情绪和歌词意象，再写镜头1、镜头2等内部镜头序列。每个镜头写清运镜、起幅、落幅、主体动作表情、空间变化、转场和音乐节拍关系；每镜只用一种运镜，不写绝对秒数。按 30 秒短剧分镜的节奏设计多个有因果和情绪递进的画面，不得整段只有单一静态画面。",
        "assets 只提取跨镜头有复用价值的核心人物、地点和关键道具。每个资产提供适合独立生图的 imagePrompt，角色要单人、完整造型清晰；场景图不出现人物；道具图主体清晰、背景简洁。",
        '仅返回一个 JSON 对象，不要 Markdown 或额外文字，结构：{"visualStyle":"整体统一的视觉风格","assets":[{"name":"资产名","category":"character|scene|prop","description":"资产设定","imagePrompt":"独立资产生图提示词"}],"segments":[{"lyricExcerpt":"本段对应歌词","visualSummary":"本段画面概述","prompt":"可直接提交的视频提示词","assetIndexes":[1]}]}。',
        `完整歌词：\n${input.lyrics.trim()}`,
    ].join("\n\n");
}

export function updateSunoMusicVideoAssetPrompt(plan: SunoMusicVideoPlan, assetId: string, imagePrompt: string): SunoMusicVideoPlan {
    return {
        ...plan,
        assets: plan.assets.map((asset) => (asset.id === assetId && asset.imagePrompt !== imagePrompt ? { ...asset, imagePrompt, reference: undefined } : asset)),
    };
}

export function updateSunoMusicVideoVisualStyle(plan: SunoMusicVideoPlan, visualStyle: string): SunoMusicVideoPlan {
    if (plan.visualStyle === visualStyle) return plan;
    return { ...plan, visualStyle, assets: plan.assets.map((asset) => ({ ...asset, reference: undefined })) };
}

export function musicVideoSegmentRanges(songDuration: number, segmentSeconds = 30): MusicVideoRange[] {
    if (!Number.isFinite(songDuration) || songDuration <= 0) throw new Error("歌曲时长不可用，无法按 30 秒拆分 MV");
    if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) throw new Error("MV 分段时长必须大于 0");
    const count = Math.ceil(songDuration / segmentSeconds);
    return Array.from({ length: count }, (_, index) => {
        const startSeconds = index * segmentSeconds;
        return { index: index + 1, startSeconds, durationSeconds: Math.min(segmentSeconds, songDuration - startSeconds) };
    });
}

export function parseSunoMusicVideoPlan(source: string, input: { songJobId: string; songClipId: string; lyrics: string; ranges: MusicVideoRange[]; maxImagesPerSegment: number }): SunoMusicVideoPlan {
    const json = source
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "");
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error("歌词拆解结果不是有效 JSON，请重新执行拆解");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("歌词拆解结果格式错误");
    const record = parsed as Record<string, unknown>;
    const assets = Array.isArray(record.assets) ? record.assets : [];
    const segments = Array.isArray(record.segments) ? record.segments : [];
    if (!assets.length) throw new Error("歌词拆解没有提取到可复用的角色、场景或道具资产");

    const normalizedAssets = assets.map((value, index): SunoMusicVideoAsset => {
        if (!value || typeof value !== "object") throw new Error(`第 ${index + 1} 个 MV 资产格式错误`);
        const asset = value as Record<string, unknown>;
        const category = asset.category;
        if (category !== "character" && category !== "scene" && category !== "prop") throw new Error(`第 ${index + 1} 个 MV 资产类别无效`);
        const name = stringValue(asset.name);
        const description = stringValue(asset.description);
        const imagePrompt = stringValue(asset.imagePrompt);
        if (!name || !description || !imagePrompt) throw new Error(`第 ${index + 1} 个 MV 资产缺少名称、设定或生图提示词`);
        return { id: `mv-asset-${index + 1}`, name, category, description, imagePrompt };
    });
    const assetIds = new Set(normalizedAssets.map((asset) => asset.id));
    if (segments.length !== input.ranges.length) throw new Error(`拆解应有 ${input.ranges.length} 段，模型返回了 ${segments.length} 段，请重新执行拆解`);
    const normalizedSegments = input.ranges.map((range, index): SunoMusicVideoSegment => {
        const value = segments[index];
        if (!value || typeof value !== "object") throw new Error(`第 ${index + 1} 段 MV 镜头格式错误`);
        const segment = value as Record<string, unknown>;
        const lyricExcerpt = stringValue(segment.lyricExcerpt);
        const visualSummary = stringValue(segment.visualSummary);
        const prompt = stringValue(segment.prompt);
        const rawAssetIndexes = Array.isArray(segment.assetIndexes) ? segment.assetIndexes : [];
        const indexes = rawAssetIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1 && item <= normalizedAssets.length);
        const selectedAssetIds = [...new Set(indexes)].map((assetIndex) => normalizedAssets[assetIndex - 1]!.id);
        if (!visualSummary || !prompt) throw new Error(`第 ${index + 1} 段缺少画面摘要或视频提示词`);
        if (selectedAssetIds.length > input.maxImagesPerSegment) throw new Error(`第 ${index + 1} 段引用了 ${selectedAssetIds.length} 张资产图，超过当前模型的 ${input.maxImagesPerSegment} 张上限`);
        if (!selectedAssetIds.some((id) => normalizedAssets.find((asset) => asset.id === id)?.category === "scene")) throw new Error(`第 ${index + 1} 段没有绑定场景资产，请重新执行歌词拆解`);
        return {
            id: `mv-segment-${range.index}`,
            index: range.index,
            startSeconds: range.startSeconds,
            durationSeconds: range.durationSeconds,
            lyricExcerpt,
            visualSummary,
            prompt,
            assetIds: selectedAssetIds.filter((id) => assetIds.has(id)),
        };
    });
    const visualStyle = stringValue(record.visualStyle);
    if (!visualStyle) throw new Error("歌词拆解结果缺少整体视觉风格");
    return {
        songJobId: input.songJobId,
        songClipId: input.songClipId,
        lyrics: input.lyrics,
        visualStyle,
        assets: normalizedAssets,
        segments: normalizedSegments,
        createdAt: new Date().toISOString(),
    };
}

export function musicVideoAudioRange(songDuration: number, requestedStart: number, requestedDuration: number) {
    const duration = Number.isFinite(songDuration) ? Math.max(0, songDuration) : 0;
    const startSeconds = Number.isFinite(requestedStart) ? Math.min(duration, Math.max(0, requestedStart)) : 0;
    const durationSeconds = Number.isFinite(requestedDuration) ? Math.min(Math.max(0, requestedDuration), duration - startSeconds) : 0;
    return { startSeconds, durationSeconds };
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
