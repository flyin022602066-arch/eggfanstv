import { describe, expect, spyOn, test } from "bun:test";

import { AI_EDITING_MAX_COMMANDS, parseAiCommandPlan, validateAiCommandBatch } from "@/lib/timeline/ai-command-schema";
import {
    DEFAULT_DIRECTOR_SETTINGS,
    buildDirectorSystemPrompt,
    compileDirectorPlan,
    parseDirectorPlan,
    type DirectorPlan,
    type DirectorSettings,
} from "@/lib/timeline/ai-director-plan";
import { getEditorCommandRegistry } from "@/lib/timeline/editor-commands";
import { createEditorStore } from "@/stores/editor/editor-store";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

function project(clips: TimelineClip[] = []): TimelineProject {
    return {
        version: 2,
        tracks: [
            { id: "video-1", kind: "video", label: "Video", order: 0, visible: false, muted: true },
            { id: "audio-1", kind: "audio", label: "Audio", order: 1, visible: false, muted: true },
            { id: "subtitle-1", kind: "subtitle", label: "Captions", order: 2, visible: false },
        ],
        clips,
        durationMs: clips.reduce((duration, clip) => Math.max(duration, clip.startMs + clip.durationMs), 0),
    };
}

function video(patch: Partial<TimelineClip> = {}): TimelineClip {
    return {
        id: "real-clip-a", nodeId: "asset:real-video", trackId: "video-1", kind: "video",
        title: "Confrontation", startMs: 80000, sourceStartMs: 10000, durationMs: 10000,
        sourceDurationMs: 60000, volume: 0,
        directMedia: { id: "real-video", assetId: "asset-a", kind: "video", title: "Original", storageKey: "private/original.mp4", url: "https://media.invalid/original?token=secret", width: 1920, height: 1080, durationMs: 60000 },
        ...patch,
    };
}

function plan(sequence: DirectorPlan["sequence"] = [{ clipId: "real-clip-a", sourceStartMs: 12000, durationMs: 2000, purpose: "Establish the conflict" }]): DirectorPlan {
    return { title: "A decision", reasoning: "Hook, confrontation, reaction", sequence };
}

function settings(patch: Partial<DirectorSettings> = {}): DirectorSettings {
    return { ...DEFAULT_DIRECTOR_SETTINGS, ...patch };
}

const speech = {
    "real-clip-a": [
        { startMs: 11000, endMs: 13500, text: "Why did you leave?" },
        { startMs: 15000, endMs: 18000, text: "I had no choice." },
    ],
};

describe("director plan boundary", () => {
    test("defaults to protected drama with subtitles and natural duration", () => {
        expect(DEFAULT_DIRECTOR_SETTINGS).toEqual({ style: "drama", pace: "natural", targetDurationMs: 0, protectDialogue: true, subtitles: true, musicClipId: "" });
    });

    test("parses strict JSON and a single fenced JSON object", () => {
        expect(parseDirectorPlan(JSON.stringify(plan()))).toEqual(plan());
        expect(parseDirectorPlan(`\n\`\`\`json\n${JSON.stringify(plan())}\n\`\`\`\n`)).toEqual(plan());
    });

    test("rejects empty/oversized sequences, malformed IDs, times and protocol extras", () => {
        const invalid: unknown[] = [
            plan([]), plan(Array.from({ length: 121 }, () => plan().sequence[0])),
            { ...plan(), commands: [] }, { ...plan(), url: "https://evil.invalid" },
            { ...plan(), title: 7 }, { ...plan(), reasoning: null },
            ...["", " clip-a", "https://evil.invalid/a", "javascript:alert(1)", "../clip", "clip\n-a", "__proto__"].map(clipId => plan([{ ...plan().sequence[0], clipId }])),
            ...[-1, 1.5, "12000", null, 1e100].map(sourceStartMs => ({ ...plan(), sequence: [{ ...plan().sequence[0], sourceStartMs }] })),
            ...[0, -1, 1.5, null].map(durationMs => ({ ...plan(), sequence: [{ ...plan().sequence[0], durationMs }] })),
            { ...plan(), sequence: [{ ...plan().sequence[0], directMedia: { url: "file:///evil" } }] },
            { ...plan(), sequence: [{ ...plan().sequence[0], op: "execute" }] },
        ];
        for (const value of invalid) expect(() => parseDirectorPlan(JSON.stringify(value))).toThrow();
        expect(() => parseDirectorPlan('{"title":"x","reasoning":"","sequence":[{"clipId":"a","sourceStartMs":NaN,"durationMs":1,"purpose":"x"}]}')).toThrow();
        expect(() => parseDirectorPlan(`${JSON.stringify(plan())}\n${JSON.stringify(plan())}`)).toThrow();
    });

    test("validates direct compiler input, known visual sources and selected source bounds", () => {
        const source = project([video(), video({ id: "audio", kind: "audio" })]);
        const snapshot = project([video({ id: "old" })]);
        const before = structuredClone({ source, snapshot });
        for (const clipId of ["missing", "audio"]) {
            expect(() => compileDirectorPlan(snapshot, source, plan([{ ...plan().sequence[0], clipId }]), settings(), {})).toThrow();
        }
        for (const [sourceStartMs, durationMs] of [[9999, 1000], [19000, 1001], [NaN, 1000], [12000, Infinity], [12000, 1.5]]) {
            expect(() => compileDirectorPlan(snapshot, source, plan([{ ...plan().sequence[0], sourceStartMs, durationMs }]), settings(), {})).toThrow();
        }
        expect(() => compileDirectorPlan(snapshot, source, { ...plan(), commands: [] } as DirectorPlan, settings(), {})).toThrow();
        expect(() => compileDirectorPlan(snapshot, source, plan([]), settings(), {})).toThrow();
        expect({ source, snapshot }).toEqual(before);
    });
});

describe("director assembly", () => {
    test("assembles more than eight shots with trusted metadata and one history entry", () => {
        const source = project([video()]);
        const snapshot = project([
            video({ id: "old" }),
            video({ id: "old-caption", kind: "subtitle", text: "Obsolete" }),
        ]);
        const before = structuredClone({ source, snapshot });
        const montage = plan(Array.from({ length: 12 }, (_, index) => ({ clipId: "real-clip-a", sourceStartMs: 10000 + index * 500, durationMs: 500, purpose: `Beat ${index + 1}` })));
        const result = compileDirectorPlan(snapshot, source, montage, settings({ style: "montage", protectDialogue: false, subtitles: false }), {});
        expect(result.summary).toMatchObject({ title: montage.title, durationMs: 6000, shotCount: 12, subtitleCount: 0 });
        expect(result.summary.shots.map(shot => shot.startMs)).toEqual(Array.from({ length: 12 }, (_, index) => index * 500));
        expect(result.plan.commands.length).toBeGreaterThan(8);
        expect(result.plan.commands.slice(0, 2).map(command => command.op)).toEqual(["removeClip", "removeSubtitle"]);
        expect(validateAiCommandBatch(snapshot, result.plan)).toEqual({ ok: true });
        expect(result.plan.commands.every(command => ["removeClip", "removeSubtitle", "addClip", "addSubtitle", "addTrack", "setTrackFlag"].includes(command.op))).toBe(true);
        expect(new Set(result.timeline.clips.map(clip => clip.id)).size).toBe(12);
        expect(result.timeline.clips[0].id).toBe(source.clips[0].id);
        for (const clip of result.timeline.clips) {
            expect(clip.nodeId).toBe(source.clips[0].nodeId);
            expect(clip.directMedia).toEqual(source.clips[0].directMedia);
            expect(clip.sourceDurationMs).toBe(60000);
            expect(clip.volume).toBeGreaterThan(0);
        }
        expect(result.timeline.tracks.find(track => track.id === "video-1")).toMatchObject({ visible: true, muted: false });
        const replay = result.plan.commands.reduce((state, command) => getEditorCommandRegistry().apply(state, command), snapshot);
        expect(replay).toEqual(result.timeline);
        const store = createEditorStore();
        store.getState().load(snapshot);
        expect(store.getState().dispatchBatch(result.plan.commands, snapshot)).toBe(true);
        expect(store.getState().project).toEqual(result.timeline);
        expect(store.getState().history!.undoStack).toHaveLength(1);
        store.getState().undo();
        expect(store.getState().project).toBe(snapshot);
        store.getState().redo();
        expect(store.getState().project).toEqual(result.timeline);
        expect({ source, snapshot }).toEqual(before);
        expect(compileDirectorPlan(snapshot, source, montage, settings({ protectDialogue: false, subtitles: false }), {})).toEqual(result);
        expect(AI_EDITING_MAX_COMMANDS).toBe(8);
        expect(() => parseAiCommandPlan(JSON.stringify(result.plan))).toThrow();
    });

    test("creates missing tracks via registry IDs, skips empty locked tracks and accepts images", () => {
        const snapshot: TimelineProject = { version: 2, tracks: [{ id: "video-1", kind: "audio", label: "Reserved ID", order: 0, locked: true }], clips: [], durationMs: 0 };
        const source = project([video(), video({ id: "still", nodeId: "still-node", kind: "image", sourceStartMs: 0, durationMs: 3000, sourceDurationMs: undefined, directMedia: undefined })]);
        const result = compileDirectorPlan(snapshot, source, plan([
            { clipId: "real-clip-a", sourceStartMs: 10000, durationMs: 1000, purpose: "Hook" },
            { clipId: "still", sourceStartMs: 0, durationMs: 2000, purpose: "Evidence" },
        ]), settings({ protectDialogue: false, subtitles: false }), {});
        expect(result.timeline.clips.map(clip => clip.trackId)).toEqual(["video-2", "image-1"]);
        expect(result.timeline.clips.map(clip => clip.startMs)).toEqual([0, 1000]);
        expect(result.plan.commands.filter(command => command.op === "addTrack").map(command => command.payload)).toEqual([{ kind: "video" }, { kind: "image" }]);
        expect(result.timeline.tracks[0]).toEqual(snapshot.tracks[0]);
    });

    test("rejects locked populated tracks and ambiguous/illegal sources without changing inputs", () => {
        const source = project([video()]);
        for (const kind of ["video", "audio", "subtitle"] as const) {
            const snapshot = project([video({ kind, trackId: `${kind}-1` })]);
            snapshot.tracks.find(track => track.kind === kind)!.locked = true;
            expect(() => compileDirectorPlan(snapshot, source, plan(), settings(), {})).toThrow(/lock|锁/i);
        }
        expect(() => compileDirectorPlan(project(), project([video(), video()]), plan(), settings(), {})).toThrow();
        expect(() => compileDirectorPlan(project(), project([video({ sourceDurationMs: 15000 })]), plan(), settings(), {})).toThrow();
        expect(() => compileDirectorPlan(project(), source, plan(), settings({ musicClipId: "missing" }), {})).toThrow();
        expect(() => compileDirectorPlan(project(), source, plan(), settings({ musicClipId: "real-clip-a" }), {})).toThrow();
    });

    test("a late registry rejection rejects the complete assembly without exposing partial edits", () => {
        const source = project([video()]);
        const snapshot = project([video({ id: "old" })]);
        const before = structuredClone({ snapshot, source });
        const registry = getEditorCommandRegistry();
        const apply = registry.apply;
        const mocked = spyOn(registry, "apply").mockImplementation((state, command) => {
            if (command.op === "addSubtitle") throw new Error("caption refused by registry");
            return apply(state, command);
        });
        try {
            expect(() => compileDirectorPlan(snapshot, source, plan(), settings(), speech)).toThrow(/caption refused/);
            expect(mocked.mock.calls.some(([, command]) => command.op === "removeClip")).toBe(true);
        } finally {
            mocked.mockRestore();
        }
        expect({ snapshot, source }).toEqual(before);
    });

    test("avoids colliding original/generated IDs and keeps known nonzero sound gain", () => {
        const source = project([video({ volume: 0.7 }), video({ id: "real-clip-a:director:1" }), video({ id: "director-subtitle:director:1" })]);
        const result = compileDirectorPlan(project(), source, plan([plan().sequence[0], plan().sequence[0], { ...plan().sequence[0], clipId: "real-clip-a:director:1" }]), settings(), speech);
        expect(new Set(result.timeline.clips.map(clip => clip.id)).size).toBe(result.timeline.clips.length);
        expect(result.timeline.clips.filter(clip => clip.kind === "video").map(clip => clip.id)).toEqual(["real-clip-a", "real-clip-a:director:2", "real-clip-a:director:1"]);
        expect(result.timeline.clips[0].volume).toBe(0.7);
    });
});

describe("speech protection and deterministic captions", () => {
    test("uses absolute source times and extends both cuts with lead/reaction handles", () => {
        const source = project([video()]);
        const result = compileDirectorPlan(project(), source, plan([{ clipId: "real-clip-a", sourceStartMs: 12000, durationMs: 4000, purpose: "Question and response" }]), settings({ targetDurationMs: 1000 }), speech);
        expect(result.timeline.clips.find(clip => clip.kind === "video")).toMatchObject({ startMs: 0, sourceStartMs: 10850, durationMs: 7500 });
        expect(result.summary.durationMs).toBe(7500);
        expect(result.timeline.clips.filter(clip => clip.kind === "subtitle").map(clip => ({ startMs: clip.startMs, durationMs: clip.durationMs, text: clip.text }))).toEqual([
            { startMs: 150, durationMs: 2500, text: "Why did you leave?" },
            { startMs: 4150, durationMs: 3000, text: "I had no choice." },
        ]);
        expect(result.summary.warnings.length).toBeGreaterThan(0);
        expect(result.timeline.tracks.find(track => track.kind === "subtitle")?.visible).toBe(true);
    });

    test("protection cannot end its reaction padding inside another utterance", () => {
        const chained = { "real-clip-a": [
            { startMs: 11000, endMs: 13000, text: "First" },
            { startMs: 13200, endMs: 15000, text: "Second" },
            { startMs: 15200, endMs: 17000, text: "Third" },
        ] };
        const result = compileDirectorPlan(project(), project([video()]), plan(), settings(), chained);
        expect(result.timeline.clips[0]).toMatchObject({ sourceStartMs: 10850, durationMs: 6500 });
        expect(result.summary.subtitleCount).toBe(3);
    });

    test("missing transcription retains the full allowed video clip, warns once and does not copy unmapped timeline captions", () => {
        const source = project([video(), video({ id: "existing-sub", kind: "subtitle", text: "Caller must map this evidence" })]);
        const result = compileDirectorPlan(project(), source, plan(), settings(), {});
        expect(result.timeline.clips).toHaveLength(1);
        expect(result.timeline.clips[0]).toMatchObject({ sourceStartMs: 10000, durationMs: 10000, sourceDurationMs: 60000 });
        expect(result.summary.warnings.some(warning => /transcri|转写|证据/i.test(warning))).toBe(true);
        expect(result.summary.subtitleCount).toBe(0);
        const empty = compileDirectorPlan(project(), source, plan(), settings(), { "real-clip-a": [] });
        expect(empty.timeline.clips[0]).toMatchObject({ sourceStartMs: 12000, durationMs: 2000 });
        expect(empty.summary.warnings).toEqual([]);
        const montage = compileDirectorPlan(project(), source, plan(), settings({ style: "montage", protectDialogue: false }), {});
        expect(montage.timeline.clips[0].durationMs).toBe(2000);
    });

    test("clamps handles to allowed clip bounds, refuses impossible sentence protection and validates evidence", () => {
        const source = project([video()]);
        const edgeSpeech = { "real-clip-a": [{ startMs: 10000, endMs: 20000, text: "A full sentence" }] };
        expect(compileDirectorPlan(project(), source, plan(), settings(), edgeSpeech).timeline.clips[0]).toMatchObject({ sourceStartMs: 10000, durationMs: 10000 });
        expect(() => compileDirectorPlan(project(), source, plan(), settings(), { "real-clip-a": [{ startMs: 9000, endMs: 14000, text: "Already truncated source" }] })).toThrow();
        for (const entry of [{ startMs: NaN, endMs: 14000, text: "bad" }, { startMs: 13000, endMs: 12000, text: "bad" }]) {
            expect(() => compileDirectorPlan(project(), source, plan(), settings(), { "real-clip-a": [entry] })).toThrow();
        }
    });

    test("montage opt-out clips caption times to the selected source interval", () => {
        const result = compileDirectorPlan(project(), project([video()]), plan(), settings({ style: "montage", protectDialogue: false }), speech);
        expect(result.timeline.clips.find(clip => clip.kind === "subtitle")).toMatchObject({ startMs: 0, durationMs: 1500, sourceStartMs: 12000, text: "Why did you leave?" });
        expect(result.timeline.clips[0].durationMs).toBe(2000);
    });

    test("distinguishes analyzed silence from missing evidence and uses only own clip keys", () => {
        const source = project([video()]);
        const silence = compileDirectorPlan(project(), source, plan(), settings(), { "real-clip-a": [] });
        expect(silence.summary).toMatchObject({ durationMs: 2000, subtitleCount: 0, warnings: [] });
        const inherited = Object.create({ "real-clip-a": [] }) as typeof speech;
        const unavailable = compileDirectorPlan(project(), source, plan(), settings(), inherited);
        expect(unavailable.summary.durationMs).toBe(10000);
        expect(unavailable.summary.warnings).toHaveLength(1);
        expect(() => compileDirectorPlan(project(), source, plan(), settings(), { "real-clip-a": undefined } as unknown as typeof speech)).toThrow();
    });

    test("sorts/deduplicates speech and remaps each playback occurrence without multiplying original captions", () => {
        const source = project([video(), video({ id: "stale-caption", kind: "subtitle", text: "old" })]);
        const repeated = plan([plan().sequence[0], plan().sequence[0]]);
        const duplicateSpeech = { "real-clip-a": [speech["real-clip-a"][1], speech["real-clip-a"][0], speech["real-clip-a"][0]] };
        const result = compileDirectorPlan(project(), source, repeated, settings(), duplicateSpeech);
        expect(result.timeline.clips.filter(clip => clip.kind === "subtitle").map(clip => clip.startMs)).toEqual([150, 3300]);
        expect(result.summary.subtitleCount).toBe(2);
        expect(compileDirectorPlan(project(), source, repeated, settings({ subtitles: false }), duplicateSpeech).summary.subtitleCount).toBe(0);
    });
});

describe("music and resource limits", () => {
    test("repeats/trims only selected trusted music to final assembly duration with low gain and gentle fades", () => {
        const music = video({ id: "selected-music", kind: "audio", nodeId: "asset:music", trackId: "audio-1", sourceStartMs: 2000, durationMs: 3000, sourceDurationMs: 9000, directMedia: { id: "music", kind: "audio", title: "Score", storageKey: "score.wav" } });
        const source = project([video(), music]);
        const result = compileDirectorPlan(project(), source, plan([{ clipId: "real-clip-a", sourceStartMs: 10000, durationMs: 7500, purpose: "Scene" }]), settings({ protectDialogue: false, musicClipId: music.id }), {});
        const audio = result.timeline.clips.filter(clip => clip.kind === "audio");
        expect(audio.map(clip => [clip.startMs, clip.durationMs, clip.sourceStartMs])).toEqual([[0, 3000, 2000], [3000, 3000, 2000], [6000, 1500, 2000]]);
        for (const clip of audio) {
            expect(clip.volume).toBe(0.12);
            expect(clip.sourceDurationMs).toBe(9000);
            expect(clip.nodeId).toBe(music.nodeId);
            expect(clip.directMedia).toEqual(music.directMedia);
            expect(clip.fadeInMs).toBeGreaterThan(0);
            expect(clip.fadeOutMs).toBeGreaterThan(0);
            expect(clip.fadeInMs! + clip.fadeOutMs!).toBeLessThanOrEqual(clip.durationMs);
        }
        expect(result.timeline.tracks.find(track => track.id === "audio-1")).toMatchObject({ visible: true, muted: false });
        expect(result.timeline.durationMs).toBe(7500);
    });

    test("rejects unsafe settings and overflowing assembly/music batches", () => {
        const source = project([video(), video({ id: "tiny-music", kind: "audio", durationMs: 1, sourceStartMs: 0 })]);
        for (const patch of [{ targetDurationMs: NaN }, { targetDurationMs: -1 }, { pace: "warp" }, { protectDialogue: "yes" }]) {
            expect(() => compileDirectorPlan(project(), source, plan(), settings(patch as Partial<DirectorSettings>), {})).toThrow();
        }
        expect(() => compileDirectorPlan(project(), source, plan([{ clipId: "real-clip-a", sourceStartMs: 10000, durationMs: 10000, purpose: "Scene" }]), settings({ protectDialogue: false, musicClipId: "tiny-music" }), {})).toThrow(/limit|上限/i);
        const huge = project([video({ sourceStartMs: 0, durationMs: Number.MAX_SAFE_INTEGER, sourceDurationMs: Number.MAX_SAFE_INTEGER })]);
        expect(() => compileDirectorPlan(project(), huge, plan([
            { clipId: "real-clip-a", sourceStartMs: 0, durationMs: Number.MAX_SAFE_INTEGER, purpose: "Overflow" },
            { clipId: "real-clip-a", sourceStartMs: 0, durationMs: 1, purpose: "Overflow" },
        ]), settings({ protectDialogue: false }), {})).toThrow();
    });

    test("rejects excessive generated captions as a whole and retains precise safe integer timing", () => {
        const source = project([video()]);
        const entries = Array.from({ length: 4100 }, (_, index) => ({ startMs: 10000 + index, endMs: 10001 + index, text: `Word ${index}` }));
        expect(() => compileDirectorPlan(project(), source, plan([{ clipId: "real-clip-a", sourceStartMs: 10000, durationMs: 10000, purpose: "All captions" }]), settings({ protectDialogue: false }), { "real-clip-a": entries })).toThrow(/limit|上限/i);
        const largeStart = Number.MAX_SAFE_INTEGER - 1000;
        const largeSource = project([video({ sourceStartMs: largeStart, durationMs: 1000, sourceDurationMs: Number.MAX_SAFE_INTEGER })]);
        const result = compileDirectorPlan(project(), largeSource, plan([
            { clipId: "real-clip-a", sourceStartMs: largeStart, durationMs: 2, purpose: "First" },
            { clipId: "real-clip-a", sourceStartMs: largeStart, durationMs: 1000, purpose: "Second" },
        ]), settings({ protectDialogue: false }), {});
        expect(result.summary.durationMs).toBe(1002);
        expect(result.timeline.durationMs).toBe(1002);
    });
});

describe("director prompt", () => {
    test("describes professional evidence-based assembly and only safe original source references", () => {
        const source = project([video({ title: "Confrontation https://private.invalid?token=hidden-secret" }), video({ id: "still", kind: "image", title: "Evidence" })]);
        const before = structuredClone(source);
        const prompt = buildDirectorSystemPrompt(source, settings({ style: "drama", pace: "tight", targetDurationMs: 15000 }));
        for (const field of ["sequence", "clipId", "sourceStartMs", "durationMs", "purpose", "real-clip-a", "still", "10000", "20000", "120", "15000", "drama", "tight"]) expect(prompt).toContain(field);
        for (const forbidden of ["https://", "hidden-secret", "token=secret", "private/original.mp4", "assetId", "commands"]) expect(prompt).not.toContain(forbidden);
        for (const concept of [/钩子|hook/i, /因果|causal/i, /视线|eyeline/i, /反应|reaction/i, /完整.*句|sentence/i, /采样|sample/i, /转写|transcri/i, /转场|transition/i]) expect(prompt).toMatch(concept);
        expect(prompt).toContain("剧情叙事");
        expect(buildDirectorSystemPrompt(source, settings({ style: "auto" }))).toContain("auto");
        expect(source).toEqual(before);
    });

    test("montage style gives music/visual assembly instructions without inventing beat detection", () => {
        const prompt = buildDirectorSystemPrompt(project([video()]), settings({ style: "montage", protectDialogue: false }));
        expect(prompt).toContain("style=montage");
        expect(prompt).toContain("音乐蒙太奇");
        expect(prompt).toContain("主题、动作、构图和情绪递进");
        expect(prompt).toContain("不得声称卡点或检测到鼓点");
    });
});
