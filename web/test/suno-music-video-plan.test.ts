import { expect, test } from "bun:test";
import { buildSunoMusicVideoBreakdownPrompt, musicVideoAudioRange, musicVideoSegmentRanges, parseSunoMusicVideoPlan, rebindSunoMusicVideoFacePresets, updateSunoMusicVideoAssetPrompt, updateSunoMusicVideoFacePresets, updateSunoMusicVideoVisualStyle, type SunoMusicVideoPlan } from "../src/lib/suno-music-video-plan";

test("reanalysis preserves unique named face bindings even when asset IDs change, without leaking to other songs", () => {
    const asset = { id: "old", name: "歌者", category: "character" as const, description: "歌者", imagePrompt: "造型" };
    const previous: SunoMusicVideoPlan = { songJobId: "job", songClipId: "clip", lyrics: "歌词", visualStyle: "电影感", createdAt: "before", assets: [asset], segments: [] };
    const next = { ...previous, createdAt: "after", assets: [{ ...asset, id: "new" }] };
    const presets = { male: { resourceId: "face", assetIds: ["old"] } };
    expect(rebindSunoMusicVideoFacePresets(presets, previous, next).male?.assetIds).toEqual(["new"]);
    expect(rebindSunoMusicVideoFacePresets(presets, previous, { ...next, songClipId: "another" }).male?.assetIds).toEqual([]);
    expect(rebindSunoMusicVideoFacePresets(presets, previous, { ...next, assets: [{ ...asset, id: "new" }, { ...asset, id: "duplicate" }] }).male?.assetIds).toEqual([]);
});

test("MV lyric breakdown ranges cover the song in consecutive thirty-second segments", () => {
    expect(musicVideoSegmentRanges(74)).toEqual([
        { index: 1, startSeconds: 0, durationSeconds: 30 },
        { index: 2, startSeconds: 30, durationSeconds: 30 },
        { index: 3, startSeconds: 60, durationSeconds: 14 },
    ]);
});

test("MV breakdown prompt requires complete lyric coverage and short-drama shot plans", () => {
    const prompt = buildSunoMusicVideoBreakdownPrompt({ songTitle: "夜航", songDuration: 74, lyrics: "主歌歌词\n副歌歌词", ranges: musicVideoSegmentRanges(74), maxImagesPerSegment: 10 });

    expect(prompt).toContain("Preserve every lyric line in its original order");
    expect(prompt).toContain("严格输出 3 段");
    expect(prompt).toContain("除最后一段外每段完整覆盖 30 秒");
    expect(prompt).toContain("每个镜头写清运镜、起幅、落幅");
    expect(prompt).toContain("每段必须绑定至少一个场景资产");
    expect(prompt).toContain("主歌歌词\n副歌歌词");
});

test("MV prompt contract keeps scene bindings and exact segment ranges", () => {
    const ranges = musicVideoSegmentRanges(40);
    const plan = parseSunoMusicVideoPlan(
        JSON.stringify({
            visualStyle: "写实电影感，冷暖对照",
            assets: [
                { name: "夜港", category: "scene", description: "雨夜港口", imagePrompt: "无人港口场景图" },
                { name: "歌者", category: "character", description: "黑衣歌者", imagePrompt: "单人全身造型" },
            ],
            segments: [
                { lyricExcerpt: "第一段歌词", visualSummary: "歌者走入雨港", prompt: "镜头1：远景推进。起幅空港，落幅歌者入画。", assetIndexes: [1, 2] },
                { lyricExcerpt: "副歌歌词", visualSummary: "歌者迎向灯火", prompt: "镜头1：侧向跟拍。起幅背影，落幅转身。", assetIndexes: [1, 2] },
            ],
        }),
        { songJobId: "job", songClipId: "clip", lyrics: "完整歌词", ranges, maxImagesPerSegment: 3 },
    );

    expect(plan.segments.map(({ startSeconds, durationSeconds }) => [startSeconds, durationSeconds])).toEqual([
        [0, 30],
        [30, 10],
    ]);
    expect(plan.segments[1]?.assetIds).toEqual(["mv-asset-1", "mv-asset-2"]);
});

test("MV breakdown rejects missing scene binding and over-limit image references", () => {
    const base = {
        visualStyle: "电影感",
        assets: [
            { name: "歌者", category: "character", description: "歌者", imagePrompt: "歌者造型" },
            { name: "夜港", category: "scene", description: "港口", imagePrompt: "港口场景" },
        ],
        segments: [{ lyricExcerpt: "", visualSummary: "港口", prompt: "港口镜头", assetIndexes: [1, 2] }],
    };
    const input = { songJobId: "job", songClipId: "clip", lyrics: "歌词", ranges: musicVideoSegmentRanges(20), maxImagesPerSegment: 1 };
    expect(() => parseSunoMusicVideoPlan(JSON.stringify(base), input)).toThrow("超过当前模型");
    expect(() => parseSunoMusicVideoPlan(JSON.stringify({ ...base, segments: [{ ...base.segments[0], assetIndexes: [1] }] }), { ...input, maxImagesPerSegment: 2 })).toThrow("没有绑定场景资产");
});

test("audio segments retain their requested later-song start and trim only at song end", () => {
    expect(musicVideoAudioRange(95, 60, 15)).toEqual({ startSeconds: 60, durationSeconds: 15 });
    expect(musicVideoAudioRange(67, 60, 15)).toEqual({ startSeconds: 60, durationSeconds: 7 });
    expect(musicVideoAudioRange(67, -4, 15)).toEqual({ startSeconds: 0, durationSeconds: 15 });
});

test("editing an asset prompt invalidates its stale reference image", () => {
    const plan = parseSunoMusicVideoPlan(
        JSON.stringify({
            visualStyle: "电影感",
            assets: [{ name: "夜港", category: "scene", description: "雨夜港口", imagePrompt: "无人港口" }],
            segments: [{ lyricExcerpt: "歌词", visualSummary: "夜港", prompt: "港口镜头", assetIndexes: [1] }],
        }),
        { songJobId: "job", songClipId: "clip", lyrics: "歌词", ranges: musicVideoSegmentRanges(20), maxImagesPerSegment: 2 },
    );
    const withReference = { ...plan, assets: [{ ...plan.assets[0]!, reference: { id: "asset", name: "夜港", type: "image/png", dataUrl: "", url: "https://example.test/old.png" } }] };

    expect(updateSunoMusicVideoAssetPrompt(withReference, "mv-asset-1", "新的港口画面").assets[0]?.reference).toBeUndefined();
    expect(updateSunoMusicVideoAssetPrompt(withReference, "mv-asset-1", "无人港口").assets[0]?.reference?.url).toBe("https://example.test/old.png");
});

test("changing a face preset clears only references for characters whose binding changed", () => {
    const plan = parseSunoMusicVideoPlan(
        JSON.stringify({
            visualStyle: "电影感",
            assets: [
                { name: "男主", category: "character", description: "歌者", imagePrompt: "男主造型" },
                { name: "女主", category: "character", description: "舞者", imagePrompt: "女主造型" },
                { name: "夜港", category: "scene", description: "港口", imagePrompt: "无人港口" },
            ],
            segments: [{ lyricExcerpt: "歌词", visualSummary: "夜港", prompt: "港口镜头", assetIndexes: [1, 2, 3] }],
        }),
        { songJobId: "job", songClipId: "clip", lyrics: "歌词", ranges: musicVideoSegmentRanges(20), maxImagesPerSegment: 3 },
    );
    const withReferences = { ...plan, assets: plan.assets.map((asset) => ({ ...asset, reference: { id: asset.id, name: asset.name, type: "image/png", dataUrl: "", url: `https://example.test/${asset.id}.png` } })) };
    const previous = { male: { resourceId: "old-male", assetIds: ["mv-asset-1"] }, female: { resourceId: "female", assetIds: ["mv-asset-2"] } };
    const next = { male: { resourceId: "new-male", assetIds: ["mv-asset-1"] }, female: previous.female };
    const result = updateSunoMusicVideoFacePresets(withReferences, previous, next);

    expect(result.assets.map((asset) => asset.reference?.url)).toEqual([undefined, "https://example.test/mv-asset-2.png", "https://example.test/mv-asset-3.png"]);
    expect(() => updateSunoMusicVideoFacePresets(withReferences, previous, { male: { resourceId: "new-male", assetIds: ["mv-asset-1"] }, female: { resourceId: "female", assetIds: ["mv-asset-1"] } })).toThrow("同一角色不能同时绑定");
});

test("changing the unified visual style invalidates all asset references", () => {
    const plan = parseSunoMusicVideoPlan(
        JSON.stringify({
            visualStyle: "电影感",
            assets: [
                { name: "夜港", category: "scene", description: "雨夜港口", imagePrompt: "无人港口" },
                { name: "歌者", category: "character", description: "歌者", imagePrompt: "单人造型" },
            ],
            segments: [{ lyricExcerpt: "歌词", visualSummary: "夜港", prompt: "港口镜头", assetIndexes: [1] }],
        }),
        { songJobId: "job", songClipId: "clip", lyrics: "歌词", ranges: musicVideoSegmentRanges(20), maxImagesPerSegment: 2 },
    );
    const withReferences = { ...plan, assets: plan.assets.map((asset) => ({ ...asset, reference: { id: asset.id, name: asset.name, type: "image/png", dataUrl: "", url: `https://example.test/${asset.id}.png` } })) };

    expect(updateSunoMusicVideoVisualStyle(withReferences, "胶片风").assets.every((asset) => !asset.reference)).toBe(true);
    expect(updateSunoMusicVideoVisualStyle(withReferences, "电影感").assets[0]?.reference?.url).toBe("https://example.test/mv-asset-1.png");
});
