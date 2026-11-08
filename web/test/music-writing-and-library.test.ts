import { expect, test } from "bun:test";
import { buildMusicWritingPrompt, MUSIC_WRITING_SKILLS, studioLibraryTracks } from "../src/pages/music/studio-helpers";
import type { SunoStudioJob } from "../src/stores/use-suno-studio-store";

function job(overrides: Partial<SunoStudioJob>): SunoStudioJob {
    return {
        id: "job-a",
        channelId: "channel-a",
        baseUrl: "https://example.invalid",
        operationId: "post-suno-submit-music",
        label: "原创歌曲",
        status: "succeeded",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        values: {},
        clips: [],
        ...overrides,
    };
}

test("music writing skills build explicit output-specific prompts", () => {
    const lyrics = buildMusicWritingPrompt(MUSIC_WRITING_SKILLS[0], "lyrics", "雨夜重逢");
    const inspiration = buildMusicWritingPrompt(MUSIC_WRITING_SKILLS[1], "inspiration", "离别后的释然");
    const tags = buildMusicWritingPrompt(MUSIC_WRITING_SKILLS[2], "tags", "轻快的城市民谣");

    expect(lyrics).toContain("[Verse]");
    expect(lyrics).toContain("雨夜重逢");
    expect(inspiration).toContain("可直接用于音乐生成");
    expect(tags).toContain("逗号分隔");
    expect(MUSIC_WRITING_SKILLS).toHaveLength(5);
});

test("music library lists only completed audio clips and supports search", () => {
    const jobs = [
        job({ id: "done", label: "夜航", updatedAt: "2026-10-03T00:00:00.000Z", clips: [
            { id: "song-a", title: "夜航", audioUrl: "https://media.invalid/a.mp3" },
            { id: "video-only", title: "MV", videoUrl: "https://media.invalid/a.mp4" },
            { id: "local-audio", title: "本地曲目", storageKey: "resource:audio-a" },
        ] }),
        job({ id: "pending", status: "running", clips: [{ id: "song-b", title: "未完成", audioUrl: "https://media.invalid/b.mp3" }] }),
    ];

    expect(studioLibraryTracks(jobs).map(({ clip }) => clip.id)).toEqual(["song-a", "local-audio"]);
    expect(studioLibraryTracks(jobs, "本地").map(({ clip }) => clip.id)).toEqual(["local-audio"]);
});
