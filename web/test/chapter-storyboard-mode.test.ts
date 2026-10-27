import { expect, test } from "bun:test";
import { chapterStoryboardRequirements, chapterStoryboardSourcePrompt, normalizeChapterStoryboardModes, normalizeChapterStoryboardSkills, reviewChapterStoryboardPrompt } from "../src/lib/chapter-storyboard-mode";

test("storyboard skills keep independent project defaults including an explicit empty selection", () => {
    const saved = { first: [" script ", "camera", "script", null, "", "acting", "lighting", "extra"], second: [], invalid: "script", "": ["script"] };
    const expected = { first: ["script", "camera", "acting", "lighting"], second: [] };
    expect(normalizeChapterStoryboardSkills(saved)).toEqual(expected);
    expect(normalizeChapterStoryboardSkills(JSON.parse(JSON.stringify(expected)))).toEqual(expected);
    expect(normalizeChapterStoryboardSkills(null)).toEqual({});
});
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

test("30 second mode preserves total duration and independent asset bindings", () => {
    const requirements = chapterStoryboardRequirements("continuous_30s");
    for (const text of ["durationSeconds 固定为 30", "镜头1 / 镜头2 / 镜头3", "sceneAssetId", "assetBindings", "propNames", "对白", "连续", "首帧"]) expect(requirements).toContain(text);
    expect(requirements).toContain("不要把整章压缩成一个");
    expect(chapterStoryboardRequirements("standard")).not.toContain("durationSeconds 固定为 30");
});

test("30 second video prompt uses the requested opening and closing shot structure without timestamps", () => {
    const requirements = chapterStoryboardRequirements("continuous_30s");
    for (const text of ["原剧本剧情", "800–1000 字", "不设 800–1000 字提示词目标", "模型实际 API 上限", "禁止写绝对秒数", "videoMotionPrompt", "整体设定", "起幅", "落幅", "→", "单镜头只保留一种运镜", "音频台词", "原文剧情节点", "不得用停顿", "结尾约束", "面部稳定", "无水印", "防重复人物"]) expect(requirements).toContain(text);
    for (const text of ["0–3s", "0–30", "时间轴", "8–12", "1–4 秒", "0.5–2 秒"]) expect(requirements).not.toContain(text);
    expect(requirements).toContain("不得为凑剧情容量或提示词长度");
    expect(requirements).toContain("@[asset:");
    expect(chapterStoryboardRequirements("standard")).not.toContain("800–1000");
});

test("the full chapter including its ending remains the adaptation source", () => {
    const source = "守卫推门递来密信。\n\n‘不要拆开！’来人喊道。\n最后，信封露出一角暗红色印章。";
    const prompt = chapterStoryboardSourcePrompt("第一章", source);
    expect(prompt).toContain(source);
    expect(prompt).toContain("完整章节原文开始");
    expect(prompt).toContain("完整章节原文结束");
    expect(prompt).toContain("保持剧情因果");
    expect(prompt.split(source)).toHaveLength(2);
});

for (const mode of ["standard", "continuous_30s"] as const) {
    test(`${mode} planning contract budgets natural dialogue without cutting a performance`, () => {
        const requirements = chapterStoryboardRequirements(mode);
        for (const instruction of [
            /单人情绪独白[^\n]*25[～–-]45\s*字/u,
            /两人对话总量[^\n]*40[～–-]60\s*字/u,
            /争吵或快速问答[^\n]*60[～–-]70\s*字/u,
            /超过\s*80\s*字[^\n]*(?:赶台词|语速过快)/u,
            /每分钟\s*150[～–-]170\s*字/u,
            /0\.5[～–-]1\.5\s*秒/u,
            /不是[^\n]*硬性字数上限/u,
            /禁止[^\n]*句中截断/u,
            /完整对白[^\n]*顺延[^\n]*下一/u,
            /反应镜头/u,
            /正反打/u,
            /环境[^\n]*微表情/u,
        ]) expect(requirements).toMatch(instruction);
        expect(requirements).toContain("原文措辞、说话人和顺序");
        expect(requirements).toContain("不遗漏、不重复");
        expect(requirements).toContain("镜头切换不等于截断对白");
        expect(requirements).toContain("不靠新增台词或剧情凑时长");
        expect(requirements).toContain("不是提示词字数限制");
    });
}

test("long original dialogue survives source assembly and nonblocking storyboard review unchanged", () => {
    const dialogue = "你先听我把事情说完，" + "我留下来不是为了争输赢，而是想让你平安回家。".repeat(5);
    const source = `她收起桌上的旧信，抬头说：“${dialogue}”他点头回答：“我明白了。”随后两人走向门口。`;
    expect(chapterStoryboardSourcePrompt("重逢", source)).toContain(source);
    const rows = [{ durationSeconds: 30, dialogue, videoMotionPrompt: `整体设定：旧屋内故人重逢。\n镜头1：固定机位。起幅：她收起旧信。→ 落幅：他点头看向门口。声音：她：“${dialogue}”他：“我明白了。”\n结尾约束：服装一致，无水印。` }];
    const before = structuredClone(rows);
    expect(Array.from(dialogue).length).toBeGreaterThan(80);
    expect(reviewChapterStoryboardPrompt(rows)).toEqual([]);
    expect(rows).toEqual(before);
});

test("30-second prompt review has no 800-1000 character gate", () => {
    const concisePrompt = "整体设定：雨夜旧屋。\n镜头1：固定机位。起幅：守卫站在门口。→ 落幅：守卫停在桌前。动作：递出密信。声音：雨声。\n结尾约束：面部稳定，无水印。";
    const longPrompt = concisePrompt.replace("动作：递出密信。", `动作：递出密信并观察来人。${"雨声连续，守卫保持原有站位，密信仍在右手中。".repeat(50)}`);
    expect(Array.from(concisePrompt.replace(/\s/gu, "")).length).toBeLessThan(800);
    expect(Array.from(longPrompt.replace(/\s/gu, "")).length).toBeGreaterThan(1000);
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: concisePrompt, timeBeats: "" }])).toEqual([]);
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: longPrompt, timeBeats: "" }])).toEqual([]);
});

test("review checks structure rather than supporting description length", () => {
    const concisePrompt = "整体设定：雨夜旧屋。\n镜头1：固定机位。起幅：守卫站在门口。→ 落幅：守卫停在桌前。动作：递出密信。声音：雨声。\n结尾约束：面部稳定，无水印。";
    const review = reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: concisePrompt, timeBeats: storyboardSequencePrompt }]);
    expect(review).toEqual([]);
});

test("review recognizes inline numbered shots and treats each 30-second row as an independent unit", () => {
    const inline = "整体设定：旧屋。镜头01：固定机位。起幅：门外来人。→ 落幅：守卫接信。声音：雨声。结尾约束：服装一致。";
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: inline }])).toEqual([]);
    const secondUnit = inline.replace("镜头01：", "镜头1：");
    expect(reviewChapterStoryboardPrompt([
        { durationSeconds: 30, videoMotionPrompt: inline },
        { durationSeconds: 30, videoMotionPrompt: secondUnit },
    ])).toEqual([]);
    const missingLanding = inline.replace("落幅：", "结束：");
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: missingLanding }]).join("；")).toContain("每镜需包含起幅");
});

test("absolute seconds are flagged without changing model output or requiring a timeline", () => {
    for (const timestamp of ["0–3s", "0-3秒", "第3秒", "第３秒", "00:03", "2.5s", "5秒", "三秒", "第十五秒"]) {
        const rows = [{ durationSeconds: 30, videoMotionPrompt: `${storyboardSequencePrompt}\n${timestamp}：转身。`, timeBeats: "" }];
        const before = structuredClone(rows);
        expect(reviewChapterStoryboardPrompt(rows).join("；")).toContain("秒数或时间码");
        expect(rows).toEqual(before);
    }
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 5, videoMotionPrompt: "0–5s：抬头", timeBeats: "" }])).toEqual([]);
});

test("review identifies missing or disordered shots and missing opening/closing frames", () => {
    for (const value of [storyboardSequencePrompt.replace("镜头2：", "镜头3："), storyboardSequencePrompt.replace("镜头1：", "镜头0：")]) {
        expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: value }]).join("；")).toContain("镜头1、镜头2");
    }
    for (const value of [storyboardSequencePrompt.replace("起幅：", "开场："), storyboardSequencePrompt.replace("落幅：", "结束："), storyboardSequencePrompt.replace("→", "随后")]) {
        expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: value }]).join("；")).toContain("起幅、→ 和落幅");
    }
});
