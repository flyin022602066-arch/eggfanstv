import { expect, test } from "bun:test";
import { createChapterBatch, resumeChapterBatch, runChapterBatch, mergeChapterBatchAssets, chapterBatchRange } from "../src/lib/chapter-batch";
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

test("resuming a linked batch as assets only never queries or generates its unfinished storyboards", async () => {
    const previous = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "linked");
    previous.rows[0]!.assets = "completed"; previous.rows[0]!.storyboard = "failed"; previous.rows[0]!.taskIds.storyboard = "paid-task";
    const state = resumeChapterBatch(previous, "assets"), calls: string[] = [];
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async (row) => { calls.push(row.id); return empty(); }, review: async () => empty(), confirm: async () => {}, storyboard: async () => { throw new Error("must not resume storyboard"); } });
    expect(state.status).toBe("completed"); expect(state.mode).toBe("assets"); expect(calls).toEqual(["b"]);
    expect(state.rows[0]!.storyboard).toBe("failed"); expect(state.rows[0]!.taskIds.storyboard).toBe("paid-task");
    expect(previous.mode).toBe("linked"); expect(previous.rows[1]!.assets).toBe("pending");
});

test("resuming as storyboards only preserves unfinished extraction without executing it", async () => {
    const previous = createChapterBatch("p", [{ id: "a", title: "第一集" }], "linked");
    previous.rows[0]!.assets = "failed"; previous.rows[0]!.assetError = "复核中断";
    const state = resumeChapterBatch(previous, "storyboards");
    let submitted = 0;
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async () => { throw new Error("must not extract"); }, review: async () => { throw new Error("must not review"); }, confirm: async () => { throw new Error("must not confirm"); }, storyboard: async () => { submitted++; } });
    expect(state.status).toBe("completed"); expect(submitted).toBe(1); expect(state.rows[0]!.assets).toBe("failed");
    expect(state.rows[0]!.assetError).toBe("复核中断");
});

test("switching back to linked resumes omitted work and retains completed phases and task IDs", () => {
    const previous = createChapterBatch("p", [{ id: "a", title: "第一集" }], "assets");
    previous.rows[0]!.assets = "completed"; previous.rows[0]!.taskIds.extract = "saved-extraction"; previous.status = "completed";
    const next = resumeChapterBatch(previous, "linked");
    expect(next.id).toBe(previous.id); expect(next.rows[0]!.assets).toBe("completed"); expect(next.rows[0]!.storyboard).toBe("pending");
    expect(next.rows[0]!.taskIds.extract).toBe("saved-extraction"); expect(next.status).toBe("paused");
    const storyboards = createChapterBatch("p", [{ id: "a", title: "第一集" }], "storyboards");
    expect(resumeChapterBatch(storyboards, "linked").rows[0]!.assets).toBe("pending");
});

test("asset failures retry immediately and preserve completed phases before the next episode", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "assets");
    let extracts = 0, reviews = 0, confirms = 0; const delays: number[] = [];
    const adapter = { save: async () => {}, shouldStop: () => false, waitForRetry: async (milliseconds: number) => { delays.push(milliseconds); }, extract: async () => { if (++extracts < 4) throw new Error("content_filter: empty result"); return { ...empty(), props: [asset("钥匙")] }; }, review: async () => { if (++reviews === 1) throw new Error("复核网络断开"); return empty(); }, confirm: async () => { if (++confirms === 1) throw new Error("入库断开"); }, storyboard: async () => {} };
    await runChapterBatch(state, adapter);
    expect(extracts).toBe(5); expect(reviews).toBe(3); expect(confirms).toBe(3); expect(state.status).toBe("completed");
    expect(delays).toEqual([0, 0, 0, 0, 0]); expect(state.rows[0]!.assetRetries).toBe(5); expect(state.rows[0]!.assetError).toBeUndefined();
});

test("asset retry yields to the stop action without submitting another request", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }], "assets");
    let stop = false, submitted = 0;
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => stop, extract: async () => { submitted++; setTimeout(() => { stop = true; }, 0); throw new Error("request failed"); }, review: async () => empty(), confirm: async () => {}, storyboard: async () => {} });
    expect(submitted).toBe(1); expect(state.status).toBe("paused"); expect(state.rows[0]!.assetError).toContain("request failed");
});

test("asset identity conflicts preserve paid results instead of retrying generation", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }], "assets");
    let extracts = 0;
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async () => { extracts++; return { ...empty(), props: [asset("旧信"), asset("新信")] }; }, review: async () => ({ ...empty(), props: [{ ...asset("信"), aliases: ["旧信", "新信"] }] }), confirm: async () => { throw new Error("must not confirm ambiguous assets"); }, storyboard: async () => {} });
    expect(extracts).toBe(1); expect(state.status).toBe("paused"); expect(state.rows[0]!.assetError).toContain("手动核对");
});

test("stop finishes the submitted step but does not launch review, storyboard, or next episode", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "linked");
    let stop = false; const events: string[] = [];
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => stop, extract: async () => { stop = true; return { ...empty(), props: [asset("钥匙")] }; }, review: async () => { events.push("review"); return empty(); }, confirm: async () => { events.push("confirm"); }, storyboard: async () => { events.push("storyboard"); } });
    expect(state.status).toBe("paused"); expect(events).toEqual([]); expect(state.rows[0]!.extracted?.props).toHaveLength(1);
});

test("storyboard failures automatically retry without a fixed attempt limit before processing the next episode", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "storyboards");
    const calls: string[] = [], delays: number[] = [];
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async () => { throw new Error("must not extract"); }, review: async () => { throw new Error("must not review"); }, confirm: async () => { throw new Error("must not confirm"); }, waitForRetry: async (milliseconds: number) => { delays.push(milliseconds); }, storyboard: async (row) => { calls.push(row.id); if (calls.length < 7) throw new Error("上游暂时失败"); } });
    expect(state.status).toBe("completed"); expect(state.rows[0]!.storyboardError).toBeUndefined(); expect(state.rows[1]!.storyboard).toBe("completed");
    expect(calls).toEqual(["a", "a", "a", "a", "a", "a", "a", "b"]); expect(delays).toEqual([0, 0, 0, 0, 0, 0]);
});

test("storyboard retry clears the previous error before saving and starting the next attempt", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第10集" }], "storyboards");
    const runningErrors: Array<string | undefined> = [];
    let attempts = 0, retryError: string | undefined, activeError: string | undefined;
    await runChapterBatch(state, {
        save: async () => { if (state.rows[0]!.storyboard === "running") runningErrors.push(state.rows[0]!.storyboardError); },
        shouldStop: () => false, extract: async () => empty(), review: async () => empty(), confirm: async () => {},
        waitForRetry: async () => { retryError = state.rows[0]!.storyboardError; },
        storyboard: async (row) => {
            if (++attempts === 1) throw new Error("模型服务暂时不可用");
            activeError = row.storyboardError;
        },
    });
    expect(attempts).toBe(2); expect(retryError).toBe("模型服务暂时不可用"); expect(activeError).toBeUndefined();
    expect(runningErrors).toEqual([undefined, undefined]); expect(state.status).toBe("completed");
});

test("asset retry clears the previous error before saving and starting the next attempt", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第10集" }], "assets");
    const runningErrors: Array<string | undefined> = [];
    let attempts = 0, activeError: string | undefined;
    await runChapterBatch(state, {
        save: async () => { if (state.rows[0]!.assets === "running") runningErrors.push(state.rows[0]!.assetError); },
        shouldStop: () => false, review: async () => empty(), confirm: async () => {}, storyboard: async () => {},
        extract: async (row) => {
            if (++attempts === 1) throw new Error("资产请求暂时失败");
            activeError = row.assetError;
            return empty();
        },
    });
    expect(attempts).toBe(2); expect(activeError).toBeUndefined(); expect(runningErrors.every((error) => error === undefined)).toBe(true);
    expect(state.status).toBe("completed");
});

test("pausing during storyboard retry wait prevents another paid submission and preserves progress", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }], "storyboards");
    let stop = false, submitted = 0;
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => stop, extract: async () => empty(), review: async () => empty(), confirm: async () => {}, waitForRetry: async () => { expect(state.rows[0]!.storyboard).toBe("retrying"); stop = true; }, storyboard: async () => { submitted++; throw new Error("生成失败"); } });
    expect(submitted).toBe(1); expect(state.status).toBe("paused"); expect(stop).toBe(true); expect(state.rows[0]!.storyboardError).toContain("生成失败");
});

test("manual review errors do not loop or prevent a later episode from completing", async () => {
    const state = createChapterBatch("p", [{ id: "a", title: "第一集" }, { id: "b", title: "第二集" }], "storyboards");
    const calls: string[] = [];
    await runChapterBatch(state, { save: async () => {}, shouldStop: () => false, extract: async () => empty(), review: async () => empty(), confirm: async () => {}, shouldRetryStoryboard: () => false, storyboard: async (row) => { calls.push(row.id); if (row.id === "a") throw new Error("请核对人工修改"); } });
    expect(calls).toEqual(["a", "b"]); expect(state.status).toBe("paused"); expect(state.rows[0]!.storyboard).toBe("failed"); expect(state.rows[1]!.storyboard).toBe("completed");
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
