import { describe, expect, test } from "bun:test";
import { buildSunoRequest, SUNO_MODELS, SUNO_OPERATIONS, sunoDefaultValues, sunoOperation } from "../src/lib/suno-contract";

const musicId = "post-suno-submit-music";
const custom = { mode: "custom", prompt: "新歌词" };
const fixtures: Array<[string, Record<string, unknown>, Record<string, unknown> | undefined]> = [
    [musicId, { gpt_description_prompt: "钢琴小夜曲" }, { mv: "chirp-v5", make_instrumental: false, gpt_description_prompt: "钢琴小夜曲" }],
    ["get-suno-fetch-id", { id: "task-1" }, undefined],
    ["post-suno-uploads-audio", { url: "https://example.com/song.mp3", name: "曲名", upload_type: "MUSIC_COPYRIGHT", speed_multiplier: 1, speed_multiplier_fix: false }, { url: "https://example.com/song.mp3", name: "曲名", upload_type: "MUSIC_COPYRIGHT", speed_multiplier: 1, speed_multiplier_fix: false }],
    ["post-suno-submit-lyrics", { prompt: "主题" }, { prompt: "主题" }],
    ["post-suno-submit-persona", { root_clip_id: "clip-1", user_input_styles: "女声", vocal_start_s: 0, vocal_end_s: 30 }, { root_clip_id: "clip-1", user_input_styles: "女声", vocal_start_s: 0, vocal_end_s: 30 }],
    ["get-suno-account-integral", {}, undefined],
    ["get-suno-act-midi", { clipId: "clip-1", stemClipId: "stem-1" }, undefined],
    ["get-suno-act-mp4-state", { taskBatchId: "batch-1" }, undefined],
    ["get-suno-act-music-style", {}, undefined],
    ["get-suno-act-my-musics", { pageNum: 1, pageSize: 10 }, undefined],
    ["get-suno-act-timing-id", { id: "clip-1" }, undefined],
    ["get-suno-act-wav-clip-id", { clip_id: "clip-1" }, undefined],
    ["get-suno-act-waveform", { clipId: "clip-1" }, undefined],
    ["post-suno-fetch", { ids: '["task-1", "clip-1"]', action: "music" }, { ids: ["task-1", "clip-1"], action: "music" }],
    ["post-suno-submit-adjust-speed", { clip_id: "clip-1", speed: 1, keep_pitch: false }, { clip_id: "clip-1", speed: 1, keep_pitch: false }],
    ["post-suno-submit-concat", { clip_id: "clip-1" }, { clip_id: "clip-1" }],
    ["post-suno-submit-fade", { clip_id: "clip-1", fade_in_s: 0, fade_out_s: 2 }, { clip_id: "clip-1", fade_in_s: 0, fade_out_s: 2 }],
    ["post-suno-submit-mp4", { clip_id: "clip-1" }, { clip_id: "clip-1" }],
    ["post-suno-submit-regen-img", { task_batch_id: "batch-1" }, { task_batch_id: "batch-1" }],
    ["post-suno-submit-set-metadata", { clip_id: "clip-1", title: "新标题", image_url: "https://example.com/cover.jpg" }, { clip_id: "clip-1", title: "新标题", image_url: "https://example.com/cover.jpg" }],
    ["post-suno-submit-stems", { clip_id: "clip-1" }, { clip_id: "clip-1" }],
    ["post-suno-submit-stems-all", { clip_id: "clip-1" }, { clip_id: "clip-1" }],
    ["post-suno-submit-stems-all-by-url", { url: "https://example.com/song.mp3" }, { url: "https://example.com/song.mp3" }],
    ["post-suno-submit-stems-by-url", { url: "https://example.com/song.mp3" }, { url: "https://example.com/song.mp3" }],
    ["post-suno-submit-upsample-tags", { original_tags: "深度浩室" }, { original_tags: "深度浩室" }],
    ["post-suno-submit-url-transfer", { url: "https://example.com/song.mp3" }, { url: "https://example.com/song.mp3" }],
];
const infillTasks = ["infill", "fixed_infill", "infill_intro", "infill_outro", "cover_infill", "artist_infill"];
const extendTasks = ["extend", "upload_extend", "cover_extend"];
const taskValues: Record<string, Record<string, unknown>> = {
    ...Object.fromEntries(extendTasks.map((task) => [task, { continue_clip_id: "clip-1", continue_at: 0 }])),
    ...Object.fromEntries(infillTasks.map((task) => [task, { continue_clip_id: "clip-1", "metadata_params.infill_start_s": 0, "metadata_params.infill_end_s": 10 }])),
    artist_consistency: { mv: "chirp-v4-tau", persona_id: "persona-1", artist_clip_id: "clip-1" },
    cover: { "metadata_params.clip_id": "clip-1" },
    image_to_song: { metadata_params: '{"reference_image":"https://example.com/image.png"}' },
    video_to_song: { metadata_params: '{"reference_video":"https://example.com/video.mp4"}' },
    concat: {},
    sound: { "metadata_params.sound": "雨声", "metadata_params.type": "loop" },
    underpainting: { "metadata_params.underpainting_clip_id": "clip-1", "metadata_params.underpainting_start_s": 0, "metadata_params.underpainting_end_s": 10 },
    remaster: { "metadata_params.clip_id": "clip-1", "metadata_params.variation_category": "normal" },
    vox: { artist_clip_id: "clip-1" },
    mashup_condition: { "metadata_params.mashup_clip_ids": '["clip-1","clip-2"]' },
};

describe("Suno published operation catalog", () => {
    test("represents exactly 26 native operation IDs with Chinese labels and schemas", () => {
        expect(SUNO_OPERATIONS.map((operation) => operation.id).sort()).toEqual(fixtures.map(([id]) => id).sort());
        for (const operation of SUNO_OPERATIONS) {
            expect(sunoOperation(operation.id)).toBe(operation);
            expect(operation.path.startsWith("/suno/")).toBe(true);
            expect(operation.label).toMatch(/[\u4e00-\u9fff]/);
            expect(["create", "edit", "voice", "tools", "library"]).toContain(operation.group);
            expect(["music", "text", "data"]).toContain(operation.result);
            expect(new Set(operation.fields.map((field) => field.key)).size).toBe(operation.fields.length);
            for (const field of operation.fields) {
                expect(field.label).toMatch(/[\u4e00-\u9fff]/);
                expect(field.key.trim()).toBe(field.key);
            }
        }
        expect(() => sunoOperation("not-published")).toThrow();
        expect(() => sunoDefaultValues("not-published")).toThrow();
        expect(() => buildSunoRequest("not-published", {})).toThrow();
    });

    test.each(fixtures)("builds native payload for %s without leaking unrelated fields", (id, values, expected) => {
        const request = buildSunoRequest(id, { ...values, apiKey: "not-a-payload", mv: id === musicId ? "chirp-v5" : "not-this-operation", "callback_url ": "https://example.com/callback", callback_url: "https://example.com/callback" });
        expect(request.method).toBe(sunoOperation(id).method);
        expect(request.body).toEqual(expected);
        if (request.method === "GET") expect(Object.hasOwn(request, "body")).toBe(false);
    });

    test("only MP4 submission uses MP4 polling, async submissions use task polling", () => {
        expect(SUNO_OPERATIONS.filter((operation) => operation.poll === "mp4").map((operation) => operation.id)).toEqual(["post-suno-submit-mp4"]);
        const taskSubmissions = ["music", "lyrics", "persona", "concat", "regen-img", "stems", "stems-all", "stems-by-url", "stems-all-by-url"];
        expect(SUNO_OPERATIONS.filter((operation) => operation.poll === "task").map((operation) => operation.id).sort()).toEqual(taskSubmissions.map((name) => `post-suno-submit-${name}`).sort());
        for (const name of taskSubmissions) expect(sunoOperation(`post-suno-submit-${name}`).poll).toBe("task");
        for (const operation of SUNO_OPERATIONS.filter((candidate) => candidate.method === "GET")) expect(operation.poll).toBe("none");
        expect(sunoOperation("post-suno-uploads-audio").poll).toBe("none");
        expect(sunoOperation("post-suno-fetch").poll).toBe("none");
        expect(sunoOperation("post-suno-submit-lyrics").result).toBe("text");
        expect(sunoOperation("get-suno-fetch-id").fields[0].label).toContain("任务");
        expect(sunoOperation("get-suno-act-timing-id").fields[0].label).toContain("片段");
    });

    test("explicit synchronous descriptions take precedence over copied numeric ID examples", () => {
        for (const name of ["adjust-speed", "fade", "set-metadata", "url-transfer"]) expect(sunoOperation(`post-suno-submit-${name}`).poll).toBe("none");
    });

    test("style expansion does not assume asynchronous completion from a numeric example alone", () => {
        expect(sunoOperation("post-suno-submit-upsample-tags").poll).toBe("none");
    });

    test("returns independent ordinary defaults without fabricated identifiers", () => {
        const initial = sunoDefaultValues(musicId);
        expect(initial).toEqual({ mode: "description", task: "", mv: "chirp-v5", make_instrumental: false });
        initial.mv = "changed";
        expect(sunoDefaultValues(musicId).mv).toBe("chirp-v5");
        expect(sunoDefaultValues("post-suno-submit-stems")).toEqual({});
    });
});

describe("Suno music payload isolation", () => {
    test("keeps description and custom prompts mutually exclusive after switching modes", () => {
        const values = { prompt: "歌词", gpt_description_prompt: "灵感", title: "标题", tags: "pop", task: "" };
        expect(buildSunoRequest(musicId, { ...values, mode: "description" }).body).toEqual({ mv: "chirp-v5", make_instrumental: false, gpt_description_prompt: "灵感", title: "标题", tags: "pop" });
        expect(buildSunoRequest(musicId, { ...values, mode: "custom" }).body).toEqual({ mv: "chirp-v5", make_instrumental: false, prompt: "歌词", title: "标题", tags: "pop" });
        expect(() => buildSunoRequest(musicId, values)).toThrow();
        expect(buildSunoRequest(musicId, { prompt: "歌词" }).body?.prompt).toBe("歌词");
        expect(buildSunoRequest(musicId, { mode: "custom", make_instrumental: true, tags: "piano" }).body).toEqual({ mv: "chirp-v5", make_instrumental: true, tags: "piano" });
        expect(() => buildSunoRequest(musicId, { mode: "custom", prompt: " " })).toThrow();
        expect(() => buildSunoRequest(musicId, { gpt_description_prompt: " " })).toThrow();
    });

    test("exposes all 19 task options, documented metadata controls and no invented media fields", () => {
        const fields = sunoOperation(musicId).fields;
        expect(fields.find((field) => field.key === "task")?.options?.map((option) => option.value).sort()).toEqual(["", ...Object.keys(taskValues)].sort());
        for (const key of ["artist_clip_id", "clip_id", "continue_clip_id", "continued_aligned_prompt", "infill_context_end_s", "infill_context_start_s", "infill_end_s", "infill_start_s", "mashup_clip_ids", "metadata.infill_lyrics", "persona_id", "sound", "type", "underpainting_clip_id", "underpainting_end_s", "underpainting_start_s", "variation_category"]) {
            const field = fields.find((item) => item.key === `metadata_params.${key}`);
            expect(field).toBeDefined();
            expect(field?.visibleWhen?.key).toBe("task");
        }
        expect(fields.find((field) => field.key === "metadata_params")?.type).toBe("json");
        expect(fields.some((field) => ["image_url", "video_url", "audio_url"].includes(field.key))).toBe(false);
    });

    test.each(Object.entries(taskValues))("supports valid native task %s", (task, values) => {
        expect(buildSunoRequest(musicId, { ...custom, task, ...values }).body?.task).toBe(task);
    });

    test("removes hidden stale task values before parsing or validation", () => {
        const stale = { ...custom, artist_clip_id: "stale", persona_id: "stale", continue_clip_id: "stale", continue_at: Number.NaN, "metadata_params.infill_start_s": -1, "metadata_params.mashup_clip_ids": "invalid JSON" };
        expect(buildSunoRequest(musicId, { ...stale, task: "cover", "metadata_params.clip_id": "cover-clip" }).body).toEqual({ mv: "chirp-v5", make_instrumental: false, prompt: "新歌词", task: "cover", metadata_params: { clip_id: "cover-clip" } });
        expect(buildSunoRequest(musicId, { ...stale, task: "", metadata_params: "invalid JSON" }).body).toEqual({ mv: "chirp-v5", make_instrumental: false, prompt: "新歌词" });
        expect(buildSunoRequest(musicId, { ...custom, task: "cover", metadata_params: { clip_id: "clip-1", infill_start_s: -1, persona_id: "stale" } }).body?.metadata_params).toEqual({ clip_id: "clip-1" });
    });

    test("reconstructs case-sensitive nested metadata without mutating inputs", () => {
        const values = { ...custom, task: "infill", continue_clip_id: "clip-1", "metadata_params.infill_start_s": "0", "metadata_params.infill_end_s": "10.5", "metadata_params.infill_context_start_s": 0, "metadata_params.infill_context_end_s": 20, "metadata_params.continued_aligned_prompt": "对齐", "metadata_params.metadata.infill_lyrics": "替换歌词" };
        const snapshot = structuredClone(values);
        expect(buildSunoRequest(musicId, values).body?.metadata_params).toEqual({ infill_start_s: 0, infill_end_s: 10.5, infill_context_start_s: 0, infill_context_end_s: 20, continued_aligned_prompt: "对齐", metadata: { infill_lyrics: "替换歌词" } });
        expect(values).toEqual(snapshot);
        const nested = { ...custom, task: "infill", metadata_params: { continue_clip_id: "clip-1", infill_start_s: 0, infill_end_s: 10, metadata: { infill_lyrics: "替换歌词" } } };
        expect(buildSunoRequest(musicId, nested).body?.metadata_params).toEqual(nested.metadata_params);
        expect(buildSunoRequest(musicId, { ...nested, metadata_params: { ...nested.metadata_params, metadata: { infill_lyrics: "替换歌词", extra: false } } }).body?.metadata_params).toEqual({ ...nested.metadata_params, metadata: { infill_lyrics: "替换歌词", extra: false } });
    });

    test("canonicalizes documented metadata wrappers and merges consistent aliases", () => {
        const metadata_params = { continue_clip_id: "clip-1", infill_start_s: 0, infill_end_s: 10, metadata: { infill_lyrics: "新歌词" } };
        const expected = buildSunoRequest(musicId, { ...custom, task: "infill", metadata_params });
        for (const key of ["metadata_params", "metadataParams"]) {
            const values = { ...custom, metadata: { task: "infill", [key]: metadata_params } };
            const snapshot = structuredClone(values);
            expect(buildSunoRequest(musicId, values)).toEqual(expected);
            expect(values).toEqual(snapshot);
        }
        expect(buildSunoRequest(musicId, { ...custom, task: "infill", metadata_params: { continue_clip_id: "clip-1", infill_start_s: 0 }, metadata: { task: "infill", metadata_params: { infill_end_s: 10, metadata: { infill_lyrics: "新歌词" } }, metadataParams: { infill_start_s: 0 } } })).toEqual(expected);
    });

    test("rejects conflicting metadata wrapper aliases without reviving a hidden task", () => {
        expect(() => buildSunoRequest(musicId, { ...custom, task: "", metadata: { task: "cover", metadata_params: { clip_id: "clip-1" } } })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, task: "cover", metadata_params: { clip_id: "clip-1" }, metadata: { metadata_params: { clip_id: "clip-2" } } })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, metadata: { task: "cover", metadata_params: { clip_id: "clip-1" }, metadataParams: { clip_id: "clip-2" } } })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, task: "cover", metadata: { prompt: "override", metadata_params: { clip_id: "clip-1" } } })).toThrow();
    });

    test("allows unpublished extension keys only inside metadata_params and preserves false and zero", () => {
        const extension = { reference: { url: "https://example.com/reference.png" }, strength: 0, enabled: false };
        const request = buildSunoRequest(musicId, { ...custom, task: "image_to_song", metadata_params: JSON.stringify(extension), reference_image: "not-a-root-key", image_url: "not-a-root-key" });
        expect(request.body?.metadata_params).toEqual(extension);
        expect(request.body).not.toHaveProperty("reference_image");
        expect(request.body).not.toHaveProperty("image_url");
        const objectRequest = buildSunoRequest(musicId, { ...custom, task: "image_to_song", metadata_params: extension });
        (objectRequest.body?.metadata_params as typeof extension).reference.url = "changed";
        expect(extension.reference.url).toBe("https://example.com/reference.png");
    });

    test.each(["{", "null", "[]", "42", '{"mv":"override"}', '{"task":"cover"}', '{"prompt":"override"}', '{"gpt_description_prompt":"override"}', '{"make_instrumental":true}', '{"mode":"custom"}', '{"callback_url ":"https://example.com/callback"}', '{"__proto__":{"polluted":true}}', '{"reference":{"constructor":{}}}'])("rejects malformed JSON and protected overrides: %s", (metadata_params) => {
        expect(() => buildSunoRequest(musicId, { ...custom, task: "image_to_song", metadata_params })).toThrow();
    });

    test("rejects non-JSON extension objects and conflicting native aliases", () => {
        for (const metadata_params of [{ value: Number.NaN }, { value: Infinity }, { value: undefined }, { value: () => 1 }, new Date()]) expect(() => buildSunoRequest(musicId, { ...custom, task: "image_to_song", metadata_params })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, task: "cover", metadata_params: { clip_id: "clip-1" }, "metadata_params.clip_id": "clip-2" })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, task: "artist_consistency", ...taskValues.artist_consistency, "metadata_params.artist_clip_id": "another-clip" })).toThrow();
    });

    test("supports every published model version and both Persona tau models", () => {
        const versions = ["chirp-v3-0", "chirp-v3-5", "chirp-v4", "chirp-v4-5", "chirp-v5", "chirp-v5-5", "chirp-v6", "chirp-v6-wild", "chirp-v6-mini", "chirp-v3-5-tau", "chirp-v4-tau"];
        expect(SUNO_MODELS.map((model) => model.value)).toEqual(versions);
        for (const mv of versions) expect(buildSunoRequest(musicId, { ...custom, mv }).body?.mv).toBe(mv);
        for (const mv of versions.filter((value) => !value.endsWith("-tau"))) expect(() => buildSunoRequest(musicId, { ...custom, task: "artist_consistency", ...taskValues.artist_consistency, mv })).toThrow();
        for (const mv of versions.filter((value) => value.endsWith("-tau"))) expect(buildSunoRequest(musicId, { ...custom, task: "artist_consistency", ...taskValues.artist_consistency, mv }).body?.mv).toBe(mv);
        expect(() => buildSunoRequest(musicId, { ...custom, mv: "invented-model" })).toThrow();
    });
});

describe("Suno required fields and number validation", () => {
    test.each([...extendTasks, ...infillTasks, "artist_consistency", "cover", "sound", "underpainting", "remaster", "vox", "mashup_condition"])("rejects missing source parameters for %s", (task) => {
        expect(() => buildSunoRequest(musicId, { ...custom, task })).toThrow();
    });

    test("requires prompt for Persona, remaster and mashup even for instrumentals", () => {
        for (const task of ["artist_consistency", "remaster", "mashup_condition"]) {
            expect(() => buildSunoRequest(musicId, { mode: "custom", make_instrumental: true, task, ...taskValues[task] })).toThrow();
        }
        for (const key of ["persona_id", "artist_clip_id"]) {
            const values = { ...custom, task: "artist_consistency", ...taskValues.artist_consistency, [key]: "" };
            expect(() => buildSunoRequest(musicId, values)).toThrow();
        }
        expect(buildSunoRequest(musicId, { ...custom, task: "artist_consistency", mv: "chirp-v4-tau", "metadata_params.persona_id": "persona-1", "metadata_params.artist_clip_id": "clip-1" }).body?.metadata_params).toEqual({ persona_id: "persona-1", artist_clip_id: "clip-1" });
    });

    test("requires infill, context, underpainting and Persona intervals to end after start", () => {
        for (const [start, end] of [[0, 0], [10, 5]]) {
            for (const task of infillTasks) expect(() => buildSunoRequest(musicId, { ...custom, task, ...taskValues[task], "metadata_params.infill_start_s": start, "metadata_params.infill_end_s": end })).toThrow();
            expect(() => buildSunoRequest(musicId, { ...custom, task: "underpainting", ...taskValues.underpainting, "metadata_params.underpainting_start_s": start, "metadata_params.underpainting_end_s": end })).toThrow();
            expect(() => buildSunoRequest("post-suno-submit-persona", { root_clip_id: "clip-1", user_input_styles: "pop", vocal_start_s: start, vocal_end_s: end })).toThrow();
        }
        expect(() => buildSunoRequest(musicId, { ...custom, task: "infill", ...taskValues.infill, "metadata_params.infill_context_start_s": 1 })).toThrow();
        expect(() => buildSunoRequest(musicId, { ...custom, task: "infill", ...taskValues.infill, "metadata_params.infill_context_start_s": 10, "metadata_params.infill_context_end_s": 5 })).toThrow();
    });

    test("validates every active numeric field against negatives and non-finite input", () => {
        const cases: Array<[string, Record<string, unknown>]> = fixtures.map(([id, values]) => [id, values]);
        cases.push(...Object.entries(taskValues).map(([task, values]): [string, Record<string, unknown>] => [musicId, { ...custom, task, ...values }]));
        for (const [id, values] of cases) {
            const resolved = { ...sunoDefaultValues(id), ...values };
            for (const field of sunoOperation(id).fields.filter((item) => item.type === "number" && (!item.visibleWhen || item.visibleWhen.values.includes(String(resolved[item.visibleWhen.key]))))) {
                for (const invalid of [-1, NaN, Infinity, -Infinity, "NaN", "Infinity", "abc", true, [], {}]) expect(() => buildSunoRequest(id, { ...values, [field.key]: invalid })).toThrow();
            }
        }
    });

    test("enforces upload and playback speed boundaries", () => {
        for (const [id, field, max] of [["post-suno-uploads-audio", "speed_multiplier", 2], ["post-suno-submit-adjust-speed", "speed", 4]] as const) {
            const values = fixtures.find(([fixtureId]) => fixtureId === id)![1];
            for (const valid of [0.25, 1, max]) expect(buildSunoRequest(id, { ...values, [field]: valid }).body?.[field]).toBe(valid);
            for (const invalid of [0, 0.24, max + 0.01]) expect(() => buildSunoRequest(id, { ...values, [field]: invalid })).toThrow();
        }
    });

    test("rejects wrong scalar and list types without coercing identifiers or booleans", () => {
        expect(() => buildSunoRequest(musicId, { ...custom, make_instrumental: "false" })).toThrow();
        expect(() => buildSunoRequest("get-suno-fetch-id", { id: 1268154180129529857 })).toThrow();
        expect(() => buildSunoRequest("post-suno-submit-persona", { ...fixtures[4][1], vocal_end_s: 1.5 })).toThrow();
        expect(() => buildSunoRequest("get-suno-act-my-musics", { pageNum: 1.5 })).toThrow();
        for (const ids of ["not JSON", "[]", '[""]', '[1]', "{}", []]) expect(() => buildSunoRequest("post-suno-fetch", { ids })).toThrow();
        for (const ids of ['["clip-1"]', '["clip-1",0]']) expect(() => buildSunoRequest(musicId, { ...custom, task: "mashup_condition", "metadata_params.mashup_clip_ids": ids })).toThrow();
    });
});

describe("Suno GET native casing and encoding", () => {
    test("encodes all query parameters with URLSearchParams", () => {
        const clipId = "clip /中文?&+#";
        const stemClipId = "stem=1&injected=true";
        const query = new URLSearchParams({ clipId, stemClipId });
        expect(buildSunoRequest("get-suno-act-midi", { clipId, stemClipId })).toEqual({ method: "GET", path: `/suno/act/midi?${query}` });
        expect(buildSunoRequest("get-suno-act-waveform", { clipId }).path).toBe(`/suno/act/waveform?${new URLSearchParams({ clipId })}`);
        expect(buildSunoRequest("get-suno-act-mp4-state", { taskBatchId: clipId }).path).toBe(`/suno/act/mp4-state?${new URLSearchParams({ taskBatchId: clipId })}`);
        expect(buildSunoRequest("get-suno-act-my-musics", { pageNum: "2", pageSize: "20" }).path).toBe("/suno/act/my-musics?pageNum=2&pageSize=20");
    });

    test("encodes path IDs as individual segments", () => {
        const id = "clip /中文?&+#";
        expect(buildSunoRequest("get-suno-fetch-id", { id }).path).toBe(`/suno/fetch/${encodeURIComponent(id)}`);
        expect(buildSunoRequest("get-suno-act-timing-id", { id }).path).toBe(`/suno/act/timing/${encodeURIComponent(id)}`);
        expect(buildSunoRequest("get-suno-act-wav-clip-id", { clip_id: id }).path).toBe(`/suno/act/wav/${encodeURIComponent(id)}`);
        expect(() => buildSunoRequest("get-suno-act-waveform", { clip_id: id })).toThrow();
        expect(() => buildSunoRequest("post-suno-submit-stems", { task_id: "task-1" })).toThrow();
    });
});
