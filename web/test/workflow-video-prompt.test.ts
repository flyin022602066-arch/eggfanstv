import { expect, test } from "bun:test";
import { buildWorkflowVideoPrompt, prepareWorkflowVideoPrompt } from "@/pages/projects/detail/workflow-video-prompt";
import type { ShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

const context: ShotAssetReferenceContext = {
    mentionReferences: [{ id: "scene", nodeId: "", assetId: "scene", kind: "image", label: "雨夜", title: "雨夜", active: true }],
    referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [],
    assetReferences: [{ assetId: "scene", title: "雨夜", category: "environment", imageIndex: 1 }],
};

test("keeps timeline and dialogue once while exposing the complete prompt breakdown", () => {
    const action = "0–15秒：抬头；15–30秒：回望。";
    const dialogue = "林默：我们回家。";
    const values = { videoPrompt: `${action}\n${dialogue}\n@[asset:scene]`, action, dialogue, continuityNotes: "左手持剑。", negativePrompt: "不要新增人物。" };
    const result = buildWorkflowVideoPrompt(values, context, "jiasu-video");
    expect(result.prompt.match(/0–15秒/g)).toHaveLength(1);
    expect(result.prompt.match(/我们回家/g)).toHaveLength(1);
    expect(result.prompt).toContain("左手持剑。");
    expect(result.prompt).toContain("不要新增人物。");
    expect(result.prompt).toContain("@图片1");
    expect(result.prompt).not.toContain("@[asset:");
    expect(result.sections.reduce((total, section) => total + section.chars, 0)).toBe(Array.from(result.prompt).length);
});

test("matches dialogue by speaker across shot directions, angle brackets and quote styles", () => {
    const dialogue = "李常：三哥息怒。不是让，是请他来领。\n张飞：俺不服！\n李常：你先听我说完。";
    const script = "镜头1：固定机位。声音：<李常>：“三哥息怒。不是让，是请他来领。”\n镜头2：横摇。声音：<张飞>怒吼：\"俺不服！\"<李常>（低声）：‘你先听我说完。’";
    const result = buildWorkflowVideoPrompt({ videoPrompt: script, dialogue }, context);
    for (const line of ["三哥息怒", "俺不服", "你先听我说完"]) expect(result.prompt.split(line)).toHaveLength(2);
    expect(result.prompt).not.toContain("【镜头台词】");
    expect(result.prompt).toContain(script);
});

test("retains missing dialogue, its speaker and an intentional repeated utterance", () => {
    const script = "镜头1：声音：林默：“别走。”";
    const dialogue = "林默：别走。\n林默：别走。\n守卫：别走。\n旁白：城门关闭了。";
    const result = buildWorkflowVideoPrompt({ videoPrompt: script, dialogue }, context);
    expect(result.prompt.match(/别走。/gu)).toHaveLength(3);
    expect(result.prompt).toContain("守卫：别走。");
    expect(result.prompt).toContain("旁白：城门关闭了。");
    expect(result.prompt).toContain(script);
});

test("preserves the missing end of a partially scripted speech without rewriting it", () => {
    const dialogue = "林默：你先听我说完。我并没有忘记我们的约定。";
    const result = buildWorkflowVideoPrompt({ videoPrompt: "林默：“你先听我说完。”", dialogue }, context);
    expect(result.prompt).toContain(dialogue);
});

test("does not mistake a longer character name for the current speaker", () => {
    const result = buildWorkflowVideoPrompt({ videoPrompt: "小林默：“我们走。”", dialogue: "林默：我们走。" }, context);
    expect(result.prompt).toContain("林默：我们走。");
    expect(result.prompt.match(/我们走。/gu)).toHaveLength(2);
});

test("keeps the asset and voice appendix below 600 characters when dialogue already exists in the shots", () => {
    const references: ShotAssetReferenceContext = {
        ...context,
        mentionReferences: [context.mentionReferences[0]!, ...["李常", "刘备", "张飞", "关羽"].map((title) => ({ id: title, assetId: title, nodeId: "", kind: "character" as const, label: title, title, active: true }))],
        assetReferences: [context.assetReferences[0]!, ...["李常", "刘备", "张飞", "关羽"].map((title, index) => ({ assetId: title, title, category: "character", imageIndex: index + 2, voiceDescription: "普通话；青年男性；沉稳清晰，与角色声音保持一致。" }))],
    };
    const line = "先将俘虏安顿好，再请刺史来主持后续事宜。".repeat(8);
    const script = `镜头1：声音：<李常>：“${line}”\n镜头2：声音：<刘备>：“好，就依四弟之计。”`;
    const result = buildWorkflowVideoPrompt({ videoPrompt: script, dialogue: `李常：${line}\n刘备：好，就依四弟之计。` }, references, "jiasu-video");
    expect(result.prompt.split(line)).toHaveLength(2);
    expect(result.sections.find((section) => section.label === "资产与声音")!.chars).toBeLessThanOrEqual(600);
    for (const asset of references.assetReferences) {
        expect(result.prompt).toContain(`${asset.title}：`);
        expect(result.prompt).toContain(`@图片${asset.imageIndex}`);
    }
    expect(result.prompt).toContain("沉稳清晰");
    expect(result.sections.reduce((total, section) => total + section.chars, 0)).toBe(result.chars);
});

test("preserves a 15000 character script without truncation", () => {
    const empty = { ...context, mentionReferences: [], assetReferences: [] };
    const prompt = "文".repeat(14999) + "😀";
    const result = buildWorkflowVideoPrompt({ videoPrompt: prompt }, empty);
    expect(result.prompt).toBe(prompt);
    expect(result.chars).toBe(15000);
});

test("a detailed director script remains complete beside the separate compact asset and voice appendix", () => {
    const script = `${storyboardSequencePrompt}\n${"环境：檐下雨水顺着石阶汇入庭院；守卫递信时观察来人的目光，手指保持按住封口。".repeat(25)}`;
    const result = buildWorkflowVideoPrompt({ videoPrompt: script }, context, "jiasu-video");
    const main = result.sections.find((section) => section.label === "镜头与表演")!;
    const appendix = result.sections.find((section) => section.label === "资产与声音")!;
    expect(main.chars).toBeGreaterThan(1000);
    expect(appendix.chars).toBeGreaterThan(0);
    expect(appendix.chars).toBeLessThanOrEqual(600);
    expect(result.prompt.startsWith(script)).toBe(true);
    expect(result.prompt).toContain("@图片1");
});

test("uses the same prepared prompt for preview and generation with skill provenance", async () => {
    const prepare = async (input: { prompt: string; purpose?: string }) => {
        expect(input.purpose).toBe("video");
        return { prompt: `表演规则\n\n${input.prompt}`, metadata: { skillIds: ["director"] } };
    };
    const prepared = await prepareWorkflowVideoPrompt({ values: { videoPrompt: "30秒连续表演。" }, context, skills: [], selectedSkillIds: [], interfaceType: "jiasu-video" }, { prepare });
    expect(prepared.prompt).toContain("表演规则");
    expect(prepared.metadata.skillIds).toEqual(["director"]);
    expect(prepared.chars).toBe(Array.from(prepared.prompt).length);
    expect(prepared.sections.reduce((total, section) => total + section.chars, 0)).toBe(prepared.chars);
});

test("numbered shot sequence is not duplicated by the supporting action field", () => {
    const sequence = storyboardSequencePrompt.split("\n\n").filter((section) => section.startsWith("镜头")).join("\n\n");
    const values = { videoPrompt: storyboardSequencePrompt, action: `叙事意图：传递密信中的警告。\n镜头序列：${sequence}\n声音：窗外雨声延续。`, continuityNotes: "信封未拆，留在桌中央。" };
    const result = buildWorkflowVideoPrompt(values, context, "jiasu-video");
    for (let shot = 1; shot <= 6; shot++) expect(result.prompt.split(`镜头${shot}：`)).toHaveLength(2);
    expect(result.prompt).toContain("传递密信中的警告");
    expect(result.prompt).toContain("窗外雨声延续");
    expect(result.prompt).toContain("信封未拆");
    expect(result.prompt).toContain("@图片1");
    expect(result.prompt).not.toMatch(/\d\s*[–-]\s*\d\s*(?:s|秒)/u);
});

test("uses the main shot sequence when the supporting field paraphrases the same shots", () => {
    const videoPrompt = "整体设定：雨夜。\n镜头1：固定机位。起幅：林默在门口。→ 落幅：林默回头。声音：林默：“等一下。”\n结尾约束：服装一致。";
    const action = "叙事意图：发现门外来人。\n镜头序列：镜头1：缓慢推镜。起幅：林默站在门边。→ 落幅：他转头。声音：林默低声道：“等一下。”\n声音：雨声不停。";
    const result = buildWorkflowVideoPrompt({ videoPrompt, action, dialogue: "林默：等一下。" }, context);
    expect(result.prompt.match(/镜头1：/gu)).toHaveLength(1);
    expect(result.prompt.match(/等一下。/gu)).toHaveLength(1);
    expect(result.prompt).toContain(videoPrompt);
    expect(result.prompt).toContain("发现门外来人");
    expect(result.prompt).toContain("雨声不停");
});

test("keeps the supporting shot sequence when the main prompt does not contain one", () => {
    const action = "镜头序列：镜头1：林默回头说：“等一下。”";
    const result = buildWorkflowVideoPrompt({ videoPrompt: "雨夜，林默发现来人。", action, dialogue: "林默：等一下。" }, context);
    expect(result.prompt).toContain(action);
    expect(result.prompt.match(/等一下。/gu)).toHaveLength(1);
});
