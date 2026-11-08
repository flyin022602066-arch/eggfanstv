import { expect, test } from "bun:test";
import { chapterStoryboardCinematographyRequirements, chapterStoryboardRequirements, chapterStoryboardSourcePrompt, extractSystemElementBlocks, normalizeChapterDialogueConstraintModes, normalizeChapterStoryboardModes, normalizeChapterStoryboardSkills, reviewChapterStoryboardPrompt } from "../src/lib/chapter-storyboard-mode";

test("renamed imported cinematography skills retain camera execution requirements through their description", () => {
    const skill = { skillId: "imported-private-package", skillName: "持械入宋-plus-v2", description: "在30秒内设计同场景多机位分镜，安排切后微推进、焦点景深及光影。", isAdded: true, status: 1 };
    const actual = chapterStoryboardCinematographyRequirements([skill], [skill.skillId]);
    expect(actual).toContain("持械入宋-plus-v2");
    expect(actual).toContain("人物动作不是运镜");
    expect(actual).toContain("摄影机起点");
    expect(chapterStoryboardCinematographyRequirements([skill], [])).toBe("");
    expect(chapterStoryboardCinematographyRequirements([{ ...skill, isAdded: false }], [skill.skillId])).toBe("");
});

test("generic thirty second contract preserves the selected skill internal shot length", () => {
    const contract = chapterStoryboardRequirements("continuous_30s");
    expect(contract).toContain("所选技能明确的段内镜长与切换频率仍须执行");
    expect(contract).not.toContain("优先于技能中的默认时长与镜头数量建议");
    expect(contract).toContain("不设固定数量不表示可以合并掉节奏专项技能要求的内部切角");
});

test("selected camera skills require executable camera motion rather than a static-camera default", () => {
    const skills = [{ skillId: "camera", skillName: "30秒大师运镜设计", isAdded: true, status: 1 }];
    const requirements = chapterStoryboardCinematographyRequirements(skills, ["camera"]);
    for (const rule of ["30秒大师运镜设计", "不得整章机械套用固定机位", "摄影机起点", "运动方向", "停止落点", "触发动作", "videoMotionPrompt", "motion", "人物动作不是运镜", "不强制运动比例"]) expect(requirements).toContain(rule);
    expect(chapterStoryboardCinematographyRequirements(skills, [])).toBe("");
    expect(chapterStoryboardCinematographyRequirements([{ ...skills[0]!, status: 0 }], ["camera"])).toBe("");
    expect(chapterStoryboardCinematographyRequirements([{ ...skills[0]!, skillName: "人物表演", skillId: "acting" }], ["acting"])).toBe("");
});

test("temporary ordinary objects stay in visual description instead of requesting standalone assets", () => {
    for (const mode of ["standard", "continuous_30s"] as const) {
        const requirements = chapterStoryboardRequirements(mode);
        expect(requirements).toContain("临时普通物品");
        expect(requirements).toContain("无需独立参考图");
        expect(requirements).toContain("propNames");
    }
});

test("storyboard skills keep independent project defaults including an explicit empty selection", () => {
    const saved = { first: [" script ", "camera", "script", null, "", "acting", "lighting", "extra"], second: [], invalid: "script", "": ["script"] };
    const expected = { first: ["script", "camera", "acting", "lighting"], second: [] };
    expect(normalizeChapterStoryboardSkills(saved)).toEqual(expected);
    expect(normalizeChapterStoryboardSkills(JSON.parse(JSON.stringify(expected)))).toEqual(expected);
    expect(normalizeChapterStoryboardSkills(null)).toEqual({});
});

test("dialogue constraint modes persist valid project selections and discard invalid values", () => {
    expect(normalizeChapterDialogueConstraintModes({ one: "paced", two: "unrestricted", invalid: "off", "": "paced" })).toEqual({ one: "paced", two: "unrestricted" });
    expect(normalizeChapterDialogueConstraintModes(null)).toEqual({});
});

test("unrestricted dialogue mode removes word-count and speech-rate budgets but retains dialogue fidelity", () => {
    const limited = chapterStoryboardRequirements("continuous_30s", "paced");
    const unrestricted = chapterStoryboardRequirements("continuous_30s", "unrestricted");
    for (const rule of ["25～45 字", "40～60 字", "60～70 字", "80 字", "150～170 字", "0.5～1.5 秒"]) expect(limited).toContain(rule);
    for (const rule of ["25～45 字", "40～60 字", "60～70 字", "80 字阈值", "每分钟语速换算", "固定停顿秒数", "对白耗时优先于原文容量"]) expect(unrestricted).not.toContain(rule);
    expect(unrestricted).toContain("对白字数限制：关闭");
    expect(unrestricted).toContain("保留原文措辞、说话人和顺序");
    expect(unrestricted).toContain("不得在句中截断表演者对白");
});
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

test("both storyboard modes distinguish visible cast from people mentioned in dialogue", () => {
    for (const mode of ["standard", "continuous_30s"] as const) {
        const requirements = chapterStoryboardRequirements(mode);
        for (const rule of ["说话人不等于对白中被提及的人", "characters", "assetBindings", "画外音", "回忆画面"]) expect(requirements).toContain(rule);
    }
});

test("30-second scripts request detailed acting and camera progression before generation", () => {
    const requirements = chapterStoryboardRequirements("continuous_30s");
    for (const rule of ["1000—2000 字", "只针对“镜头与表演”主脚本", "动作发起与受力", "对手如何接招", "摄影机从哪里开始", "光向、人物左右", "过程：", "落幅", "切点", "不复制整篇主脚本", "不编造冲突", "不触发自动重写"]) expect(requirements).toContain(rule);
    expect(chapterStoryboardRequirements("standard")).not.toContain("1000—2000 字");
});

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

test("system status panels are extracted verbatim and protected in the storyboard prompt", () => {
    const systemBlock = [
        "【叮——进化系统启动中……】",
        "【宿主：苏夜】",
        "【状态：蛋（进度：0%）】",
        "【形态：幼年】",
        "【等级：D级觉醒】",
        "【血脉进化模板：无】",
        "【进化点：0】",
        "【灵气：0】",
    ].join("\n");
    const source = `苏夜感到眼前一亮。\n${systemBlock}\n苏夜愣在原地。`;
    expect(extractSystemElementBlocks(source)).toEqual([systemBlock]);
    const prompt = chapterStoryboardSourcePrompt("第一章", source);
    expect(prompt).toContain("系统片段1");
    expect(prompt).toContain(systemBlock);
    expect(chapterStoryboardRequirements("standard")).toContain("systemElements");
});

test("system message extraction does not absorb neighboring prose", () => {
    const source = "苏夜听见一阵提示音。\n系统提示：进化点已到账。\n他惊讶地抬头。";
    expect(extractSystemElementBlocks(source)).toEqual(["系统提示：进化点已到账。"]);
});

test("fullwidth panel brackets retain later-chapter state verbatim", () => {
    const block = "［宿主：苏夜］\n［形态：青鳞鹰］\n［等级：王级］\n［灵气：80］";
    expect(extractSystemElementBlocks(`他睁开眼。\n${block}\n他收起面板。`)).toEqual([block]);
});

test("unbracketed panel fields remain one block instead of separate voice messages", () => {
    const block = "宿主：苏夜\n形态：青鳞鹰\n等级：王级\n灵气：80";
    expect(extractSystemElementBlocks(`他睁开眼。\n${block}\n他收起面板。`)).toEqual([block]);
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
            /(?:禁止|不得)[^\n]*句中截断/u,
            /完整对白[^\n]*顺延[^\n]*下一/u,
            /反应镜头/u,
            /正反打/u,
            /环境[^\n]*微表情/u,
        ]) expect(requirements).toMatch(instruction);
        expect(requirements).toContain("任何模式都不得通过改写、概括、删掉台词或改成旁白压缩对白");
        expect(requirements).toContain("不得在句中截断表演者对白");
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

test("selected microshot review detects a short summary while preserving the original result", () => {
    const rows = [{ durationSeconds: 30, videoMotionPrompt: "整体设定：训练区。\n镜头1：中景。起幅：她在横杆上。→ 落幅：她落到垫子。\n镜头2：近景。起幅：他停表。→ 落幅：他看向她。\n结尾约束：服装一致。" }];
    const before = structuredClone(rows);
    const issues = reviewChapterStoryboardPrompt(rows, { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000 });
    expect(issues.join("；")).toContain("只有 2 个内部镜头");
    expect(issues.join("；")).toContain("至少需要 8 个");
    expect(issues.join("；")).toContain("镜头与表演正文");
    expect(issues.join("；")).toContain("1000–2000");
    expect(rows).toEqual(before);
    expect(reviewChapterStoryboardPrompt(rows)).toEqual([]);
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

test("spoken durations remain original dialogue instead of becoming timeline warnings", () => {
    for (const audio of ["声音：韩策说“比昨天快十秒。”", "声音：韩策：“等我5秒。”", "旁白：‘三秒后，他终于回过神。’", '声音：韩策说"比昨天快10秒。"']) {
        const rows = [{ durationSeconds: 30, videoMotionPrompt: `${storyboardSequencePrompt}\n${audio}`, timeBeats: "" }];
        const before = structuredClone(rows);
        expect(reviewChapterStoryboardPrompt(rows)).toEqual([]);
        expect(rows).toEqual(before);
    }
    for (const timestamp of ['镜头时间“0–3s”', '起幅：“第3秒”转身。', '声音：韩策说“比昨天快十秒。”过程：第3秒转身。', '声音：韩策说“比昨天快十秒。”过程：“第3秒”转身。']) {
        expect(reviewChapterStoryboardPrompt([{ durationSeconds: 30, videoMotionPrompt: `${storyboardSequencePrompt}\n${timestamp}` }]).join("；")).toContain("秒数或时间码");
    }
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
