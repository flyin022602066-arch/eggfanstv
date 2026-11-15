import { expect, test } from "bun:test";
import { createChapterBatch, runChapterBatch, mergeChapterBatchAssets, chapterBatchRange } from "../src/lib/chapter-batch";
import type { CharacterBreakdown } from "../src/lib/canvas/canvas-character-reference";

const empty = () => ({ characters: [], scenes: [], props: [] });
const asset = (name: string) => ({ name, description: name, prompt: name });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test("range follows episode order and rejects invalid bounds", () => {
    const units = [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }, { id: "c", title: "第三集" }];
    expect(chapterBatchRange(units, 2, 3).map((unit) => unit.id)).toEqual(["b", "c"]);
    for (const [start, end] of [[0, 2], [3, 2], [1, 4], [1.5, 2]]) expect(() => chapterBatchRange(units, start!, end!)).toThrow();
});

test("assets are sequential; reviewed assets commit before next extraction; storyboard overlaps next assets", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "linked");
    const events: string[] = [], storyboard = deferred(), second = deferred();
    const running = runChapterBatch(state, {
        save: async () => {}, shouldStop: () => false,
        extract: async (row) => { events.push(`extract:${row.id}`); if (row.id === "b") second.resolve(); return { ...empty(), props: [asset(row.id)] }; },
        review: async (row, first) => { events.push(`review:${row.id}`); expect(first.props[0]?.name).toBe(row.id); return { ...empty(), props: [asset(`${row.id}-补充`)] }; },
        confirm: async (row, assets) => { events.push(`confirm:${row.id}`); expect(assets.props).toHaveLength(2); },
        storyboard: async (row) => { events.push(`storyboard:${row.id}`); if (row.id === "a") await storyboard.promise; },
    });
    await second.promise;
    expect(events.indexOf("confirm:a")).toBeLessThan(events.indexOf("extract:b"));
    expect(events).toContain("storyboard:a");
    expect(state.rows[0]!.storyboard).toBe("running");
    storyboard.resolve(); await running;
    expect(state.status).toBe("completed");
    expect(state.rows.every((row) => row.assets === "completed" && row.storyboard === "completed")).toBe(true);
    expect(events.filter((event) => event.startsWith("review:"))).toHaveLength(2);
});

test("asset failure blocks later episodes but preserves completed work and resumes without extraction", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "assets");
    let extracts = 0, reviews = 0, fail = true;
    const adapter = { save: async () => {}, shouldStop: () => false, extract: async () => { extracts++; return { ...empty(), props: [asset("钥匙")] }; }, review: async () => { reviews++; if (fail) throw new Error("复核网络断开"); return empty(); }, confirm: async () => {}, storyboard: async () => {} };
    await runChapterBatch(state, adapter);
    expect(state.status).toBe("paused"); expect(extracts).toBe(1); expect(state.rows[1]!.assets).toBe("pending");
    fail = false; await runChapterBatch(state, adapter);
    expect(extracts).toBe(2); expect(reviews).toBe(3); expect(state.status).toBe("completed");
});

test("stop finishes the submitted step but does not launch review, storyboard, or next episode", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "linked");
    let stop = false; const events: string[] = [];
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => stop, extract: async () => { stop = true; return { ...empty(), props: [asset("钥匙")] }; }, review: async () => { events.push("review"); return empty(); }, confirm: async () => { events.push("confirm"); }, storyboard: async () => { events.push("storyboard"); } });
    expect(state.status).toBe("paused"); expect(events).toEqual([]); expect(state.rows[0]!.extracted?.props).toHaveLength(1);
});

test("storyboard-only mode never extracts; one storyboard failure does not erase other episodes", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "storyboards");
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async () => { throw new Error("must not extract"); }, review: async () => { throw new Error("must not review"); }, confirm: async () => { throw new Error("must not confirm"); }, storyboard: async (row) => { if (row.id === "a") throw new Error("写入冲突"); } });
    expect(state.status).toBe("paused"); expect(state.rows[0]!.storyboardError).toBe("写入冲突"); expect(state.rows[1]!.storyboard).toBe("completed");
});

test("review merges aliases and additional looks without replacing the base identity", () => {
    const character = { name: "林夏", aliases: ["小夏"], role: "主角", appearance: "短发", clothing: "白衣", physique: "清瘦", personality: "果断", props: "", consistencyPrompt: "短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮", looks: [{ name: "便装", clothing: "白衣" }] };
    const result = mergeChapterBatchAssets({ ...empty(), characters: [character], props: [asset("旧信")] }, { ...empty(), characters: [{ ...character, name: "小夏", aliases: ["林夏"], clothing: "铠甲", looks: [{ name: "便装", clothing: "白衣" }, { name: "战斗", clothing: "铠甲" }] }], props: [{ ...asset("信件"), aliases: ["旧信"] }] });
    expect(result.characters).toHaveLength(1); expect(result.characters[0]!.clothing).toBe("白衣"); expect(result.characters[0]!.looks).toHaveLength(2); expect(result.props).toHaveLength(1);
});

test("shared generic scene aliases must not collapse distinct locations during review", () => {
    const result = mergeChapterBatchAssets({ ...empty(), scenes: [{ ...asset("射击训练区"), aliases: ["训练区"] }] }, { ...empty(), scenes: [{ ...asset("室内攀爬训练区"), aliases: ["训练区"] }] });
    expect(result.scenes.map((item) => item.name)).toEqual(["射击训练区", "室内攀爬训练区"]);
});

test("reviewed extra looks preserve a first-pass base outfit without a looks array", () => {
    const character = { name: "林夏", aliases: [], clothing: "白衣", appearance: "短发", physique: "清瘦", props: "旧信" } as CharacterBreakdown;
    const result = mergeChapterBatchAssets({ ...empty(), characters: [character] }, { ...empty(), characters: [{ ...character, looks: [{ name: "战斗", clothing: "铠甲", sourceEvidence: "她换上铠甲" }] }] });
    expect(result.characters[0]!.looks?.map((look) => look.clothing)).toEqual(["白衣", "铠甲"]);
    expect(result.characters[0]!.looks?.[0]?.props).toBe("旧信");
});

test("reviewed look deduplication uses all visual differences and keeps valid unique names", () => {
    const character = { name: "林夏", aliases: [], clothing: "白衣", appearance: "短发", physique: "清瘦", props: "", looks: [{ name: "便装", clothing: "白衣", state: "整洁" }] } as CharacterBreakdown;
    const result = mergeChapterBatchAssets({ ...empty(), characters: [character] }, { ...empty(), characters: [{ ...character, looks: [{ name: "出发", clothing: "白衣", appearance: "短发", state: "整洁" }, { name: "便装", clothing: "白衣", state: "受伤", sourceEvidence: "她受了伤" }] }] });
    const looks = result.characters[0]!.looks!;
    expect(looks).toHaveLength(2);
    expect(looks.map((look) => look.state)).toEqual(["整洁", "受伤"]);
    expect(new Set(looks.map((look) => look.name)).size).toBe(2);
});

test("a storyboard checkpoint failure pauses the asset lane without orphaned worker rejections", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "linked");
    const second = deferred(), releaseSecond = deferred(), releaseStoryboard = deferred();
    const reviews: string[] = []; let storageFailed = false;
    const running = runChapterBatch(state, {
        save: async () => { if (!storageFailed && state.rows[0]?.storyboard === "completed") { storageFailed = true; throw new Error("checkpoint storage failed"); } },
        shouldStop: () => false,
        extract: async (row) => { if (row.id === "b") { second.resolve(); await releaseSecond.promise; } return { ...empty(), props: [asset(row.id)] }; },
        review: async (row) => { reviews.push(row.id); return empty(); },
        confirm: async () => {},
        storyboard: async () => { await releaseStoryboard.promise; },
    }).then(() => null, (error: unknown) => error);
    await second.promise; releaseStoryboard.resolve(); await Bun.sleep(0); releaseSecond.resolve();
    expect(await running).toEqual(new Error("checkpoint storage failed"));
    expect(reviews).toEqual(["a"]);
    expect(state.status).toBe("paused");
});
