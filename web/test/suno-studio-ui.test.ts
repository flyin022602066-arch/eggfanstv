import { describe, expect, test } from "bun:test";
import { SUNO_OPERATIONS, sunoDefaultValues, sunoOperation } from "@/lib/suno-contract";
import type { SunoStudioClip, SunoStudioJob } from "@/stores/use-suno-studio-store";
import { clampRange, clipSourceValues, fieldValue, fieldVisible, formatStudioTime, playableUrl, rangeValues, STUDIO_GROUPS, studioResultDetails, studioSourceSelection, studioTextResults, updateStudioValues, validateStudioValues } from "../src/pages/music/studio-helpers";
import { audioPeaks } from "../src/pages/music/studio-waveform";

const music = sunoOperation("post-suno-submit-music");
const clip: SunoStudioClip = { id: "clip-source", title: "Fixture", audioUrl: "https://example.invalid/audio.mp3" };
const job: SunoStudioJob = { id: "local-job", channelId: "test-channel", baseUrl: "https://example.invalid", operationId: music.id, label: "测试任务", status: "succeeded", taskId: "remote-task", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", values: {}, clips: [clip] };

describe("music studio parameters", () => {
    test("all 26 APIs are reachable through visible groups", () => {
        expect(SUNO_OPERATIONS).toHaveLength(26);
        expect(SUNO_OPERATIONS.every((operation) => STUDIO_GROUPS.some((group) => group.value === operation.group))).toBe(true);
    });
    test("switching creation mode drops the previous prompt and special task fields", () => {
        const values: Record<string, unknown> = { ...sunoDefaultValues(music.id), mode: "custom", task: "infill", prompt: "old lyrics", "metadata_params.infill_start_s": 5, metadata_params: { retained: false } };
        const next = updateStudioValues(music, values, "mode", "description");
        expect(next.task).toBe("");
        expect(next.prompt).toBeUndefined();
        expect(next.metadata_params).toBeUndefined();
        expect(next["metadata_params.infill_start_s"]).toBeUndefined();
        expect(next.mv).toBe(values.mv);
    });
    test("special tasks expose custom lyrics and clear prior task metadata", () => {
        const next = updateStudioValues(music, { mode: "description", task: "infill", gpt_description_prompt: "old idea", "metadata_params.infill_start_s": 3, metadata_params: { clip_id: "old" } }, "task", "cover");
        expect(next.mode).toBe("custom");
        expect(next.gpt_description_prompt).toBeUndefined();
        expect(next.metadata_params).toBeUndefined();
        expect(next["metadata_params.infill_start_s"]).toBeUndefined();
        expect(fieldVisible(music.fields.find((field) => field.key === "metadata_params.clip_id")!, next)).toBe(true);
        expect(fieldVisible(music.fields.find((field) => field.key === "continue_clip_id")!, next)).toBe(false);
    });
    test("visible required fields, range order and numeric bounds validate inline", () => {
        const errors = validateStudioValues(music, { ...sunoDefaultValues(music.id), mode: "custom", task: "infill", "metadata_params.infill_start_s": 10, "metadata_params.infill_end_s": 4 });
        expect(errors["metadata_params.infill_end_s"]).toContain("结束时间");
        expect(errors["metadata_params.clip_id"]).toBeUndefined();
        expect(validateStudioValues(sunoOperation("post-suno-submit-adjust-speed"), { clip_id: clip.id, speed: -1 }).speed).toContain("小于");
        expect(validateStudioValues(music, sunoDefaultValues(music.id)).gpt_description_prompt).toBeTruthy();
        expect(validateStudioValues(music, { ...sunoDefaultValues(music.id), mode: "custom", make_instrumental: true }).prompt).toBeUndefined();
    });
    test("nested source metadata remains readable with flat editor overrides", () => {
        expect(fieldValue({ metadata_params: { clip_id: "nested" } }, "metadata_params.clip_id")).toBe("nested");
        expect(fieldValue({ metadata_params: { clip_id: "nested" }, "metadata_params.clip_id": "flat" }, "metadata_params.clip_id")).toBe("flat");
    });
    test("invalid advanced JSON is rejected without discarding the draft", () => {
        const values = { ...sunoDefaultValues(music.id), task: "cover", "metadata_params.clip_id": clip.id, metadata_params: "{" };
        expect(validateStudioValues(music, values).metadata_params).toContain("JSON");
        expect(values.metadata_params).toBe("{");
    });
});

describe("music studio clip reuse", () => {
    test("clip IDs and upstream task IDs never replace one another", () => {
        expect(clipSourceValues(sunoOperation("get-suno-fetch-id"), {}, clip, job).id).toBe(job.taskId);
        expect(clipSourceValues(sunoOperation("get-suno-act-timing-id"), {}, clip, job).id).toBe(clip.id);
        expect(clipSourceValues(sunoOperation("post-suno-submit-regen-img"), {}, clip, job).task_batch_id).toBe(job.taskId);
        expect(clipSourceValues(sunoOperation("post-suno-submit-stems"), {}, clip, job).clip_id).toBe(clip.id);
        expect(clipSourceValues(sunoOperation("get-suno-fetch-id"), {}, clip, { ...job, taskId: undefined }).id).toBe("");
    });
    test("source URL and selected range populate only relevant operation fields", () => {
        expect(clipSourceValues(sunoOperation("post-suno-submit-stems-by-url"), {}, clip, job).url).toBe(clip.audioUrl);
        const values = rangeValues(music, { mode: "custom", task: "infill" }, [4.2, 12.8]);
        expect(values["metadata_params.infill_start_s"]).toBe(4.2);
        expect(values["metadata_params.infill_end_s"]).toBe(12.8);
        expect(values.continue_at).toBeUndefined();
        expect(rangeValues(sunoOperation("post-suno-submit-persona"), {}, [1, 3])).toEqual({ vocal_start_s: 1, vocal_end_s: 3 });
    });
    test("a selected source keeps clip IDs and task IDs attached to the right Suno tools", () => {
        const sourceJob = { ...job, taskId: "task-9007199254740993", taskIds: ["task-9007199254740993", "task-second"] };
        expect(studioSourceSelection(sourceJob, clip)).toEqual({ jobId: sourceJob.id, clipId: clip.id });
        expect(clipSourceValues(sunoOperation("post-suno-submit-adjust-speed"), {}, clip, sourceJob).clip_id).toBe(clip.id);
        expect(clipSourceValues(sunoOperation("post-suno-submit-regen-img"), {}, clip, sourceJob).task_batch_id).toBe(sourceJob.taskId);
        expect(clipSourceValues(sunoOperation("post-suno-fetch"), {}, clip, { ...sourceJob, operationId: "post-suno-fetch" }).ids).toEqual(sourceJob.taskIds);
        expect(clipSourceValues(sunoOperation("get-suno-fetch-id"), {}, clip, { ...sourceJob, taskId: undefined }).id).toBe("");
    });
    test("range bounds and time formatting stay stable", () => {
        expect(clampRange(-1, 200, 60)).toEqual([0, 60]);
        expect(clampRange(30, 2, 60)).toEqual([30, 30]);
        expect(formatStudioTime(125.7)).toBe("2:05");
        expect(formatStudioTime(Infinity)).toBe("0:00");
    });
    test("text results support lyrics and tags without treating URLs as text", () => {
        expect(studioTextResults({ data: { lyrics: "Verse", tags: "piano", audio_url: "https://example.invalid/audio.mp3" } }).map((item) => item.kind)).toEqual(["lyrics", "tags"]);
        expect(studioTextResults("Result")[0].text).toBe("Result");
        expect(studioResultDetails({ api_key: "secret", content: "safe" })).not.toContain("secret");
        expect(playableUrl("javascript:alert(1)")).toBeUndefined();
    });
    test("decoded waveform peaks use actual channel samples including silence", () => {
        expect(audioPeaks([new Float32Array([0, 0, 0, 0])], 2)).toEqual([0, 0]);
        expect(audioPeaks([new Float32Array([0.2, -0.5, 0.75, 0])], 2)[0]).toBeCloseTo(0.5);
        expect(audioPeaks([new Float32Array([0.2, -0.5, 0.75, 0])], 2)[1]).toBeCloseTo(0.75);
        expect(audioPeaks([])).toEqual([]);
    });
});
