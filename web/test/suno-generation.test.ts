import { expect, test } from "bun:test";
import { canvasSunoBody, isSunoModel, sunoMusicSettings } from "../src/lib/suno-generation";

test("Suno canvas uses music versions and native fields without TTS parameters", () => {
    expect(isSunoModel("channel::suno_music_open")).toBe(true);
    expect(isSunoModel("minimax-music-2.0")).toBe(false);
    expect(isSunoModel("chirp-v6-mini")).toBe(true);
    const body = canvasSunoBody({ model: "suno_music_open", audioSunoParams: JSON.stringify({ mv: "chirp-v5-5", mode: "custom", make_instrumental: true, tags: "piano", title: "Fixture", audioVoice: "alloy" }) }, "[Verse] 原创歌词");
    expect(body).toEqual({ mv: "chirp-v5-5", make_instrumental: true, tags: "piano", title: "Fixture", prompt: "[Verse] 原创歌词" });
    expect(sunoMusicSettings("", "chirp-v6").mv).toBe("chirp-v6");
    expect(() => canvasSunoBody({ audioSunoParams: "bad" }, "fixture")).toThrow("JSON");
});
