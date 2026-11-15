import { expect, spyOn, test } from "bun:test";
import { chapterDirectorScriptOutputContract, compileChapterDirectorScript } from "../src/lib/chapter-director-script";
import { chapterStoryboardDurationPolicy, chapterStoryboardReviewPolicy, reviewChapterStoryboardPrompt } from "../src/lib/chapter-storyboard-mode";
import { chapterStoryboardFromGenerationTask, generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import type { Skill, SkillPackageFileContent } from "../src/services/api/skills";
import * as taskApi from "../src/services/api/task-center";
import { createSkillRuntime, skillRuntime } from "../src/services/skill-runtime";
import { defaultConfig } from "../src/stores/use-config-store";

const identity = "short-drama-editing/chixie-rusong-plus-v2-15s";
const files = new Map<string, SkillPackageFileContent>();
for (const path of ["SKILL.md", "references/director-optics-dialogue.md", "references/video-generation.md"]) {
    const content = await Bun.file(new URL(`../../skill-packages/${identity}/${path}`, import.meta.url)).text();
    files.set(path, { file: { path, kind: "markdown", mimeType: "text/markdown", size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") }, content, binary: false });
}
const skill = { skillId: "fifteen-independent", skillName: "持械入宋plus第二版·15秒起落2.3", description: files.get("SKILL.md")!.content.match(/^description: (.+)$/m)![1], isAdded: true, status: 1, version: "2.3.0", versionId: "fifteen-v1" } as Skill;
const runtime = () => createSkillRuntime({ listFiles: async () => ({ files: [...files.values()].map((item) => item.file) }), getFile: async (_id, path) => ({ file: files.get(path)! }) });
const directorScript = {
    setting: "旧屋内，门在右侧，桌在左侧；摄影机位于交谈轴线同侧，左前方柔光形成面部层次。",
    shots: Array.from({ length: 6 }, (_, index) => ({ durationSeconds: 2.5, camera: index % 2 ? "同侧过肩反打中近景，固定构图保留门框。" : "同侧中近景，随目光轻微前移后稳住。", start: "甲右手持信，乙看向甲的眼睛，承接前镜当前动作。", performance: "甲沿既有方向递信，乙抬左手承接，视线随信转移。", focusAndLight: "近侧眼睛清楚，背景保留门框坐标，颧骨亮面过渡到有肤质的暗侧。", end: "乙接稳信，沿甲收手动作切入下一角度。", sound: index === 0 ? "甲低声说：“拿好。”后续切角原声连续。" : "沿用同一声场，衣料声随手部动作，无新增台词。" })),
    ending: "身份、手别、轴线与主光连续，不新增角色或道具。",
};

test("15s package is independently bundled and its complete rules fit the minimum per-skill budget", async () => {
    const registry = await Bun.file(new URL("../../scripts/bundled-skill-packages.json", import.meta.url)).json();
    expect(registry[identity]).toBe("references/director-optics-dialogue.md");
    expect([...files.values()].reduce((size, item) => size + item.content.length, 0)).toBeLessThan(8_000);
    expect(files.get("SKILL.md")!.content).toContain("version: 2.3.0");
    const loaded = await runtime().prepare({ profile: "shortDrama", prompt: "完整拆解本章镜头与表演", skills: [skill], selectedSkillIds: [skill.skillId] });
    expect(loaded.metadata.skillLoadReport).toMatchObject([{ status: "loaded", truncated: false }]);
    for (const path of ["SKILL.md", "references/director-optics-dialogue.md"]) expect(loaded.prompt).toContain(files.get(path)!.content.trim());
    expect(chapterStoryboardDurationPolicy(loaded.prompt)).toEqual({ minDurationSeconds: 15, maxDurationSeconds: 15 });
    expect(chapterStoryboardReviewPolicy(loaded.prompt)).toEqual({ maxInternalShotSeconds: 4 });
    const original = await Bun.file(new URL("../../skill-packages/short-drama-editing/chixie-rusong-plus-v2/SKILL.md", import.meta.url)).text();
    expect(original).toContain("version: 2.3.2");
    expect(original).toContain("durationSeconds=30");
});

test("15s video stage loads its own reference and preserves the confirmed script", async () => {
    const prompt = "镜头1：起幅：甲持信。过程：甲递信。→ 落幅：乙接稳。声音：甲说‘拿好。’";
    const loaded = await runtime().prepare({ profile: "shortDrama", purpose: "video", prompt, skills: [skill], selectedSkillIds: [skill.skillId] });
    expect(loaded.prompt).toContain(prompt);
    expect(loaded.prompt).toContain(files.get("references/video-generation.md")!.content.trim());
    expect(loaded.metadata.skillLoadReport).toMatchObject([{ status: "loaded", files: ["references/video-generation.md"], truncated: false }]);
});

test("15s structured contract uses start-to-end shots while the original 30s contract stays unchanged", () => {
    const contract = chapterDirectorScriptOutputContract("complete", 15);
    expect(contract).toContain("durationSeconds=15");
    expect(contract).toContain("起幅、过程、→落幅");
    expect(contract).toContain("不写固定时间轴");
    expect(contract).not.toContain("30秒");
    expect(contract).not.toContain("1000–2000");
    const original = chapterDirectorScriptOutputContract("complete");
    expect(original).toContain("durationSeconds=30");
    expect(original).toContain("通常10–15镜");
    expect(original).toContain("约1000–2000字");
});

for (const storyboardMode of ["standard", "continuous_30s"] as const) {
    test(`${storyboardMode}: one selected 15s skill reaches the actual task and survives restore without 30s backend planning`, async () => {
        const completed: taskApi.GenerationTask = { id: "offline-fifteen", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [{ shotNumber: 1, durationSeconds: 15, directorScript, characters: [], dialogue: "甲：“拿好。”" }] }) };
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued" });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
        const local = runtime();
        const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => local.prepare(input));
        try {
            const result = await generateChapterStoryboard({ projectId: "offline", chapterId: "chapter", chapterTitle: "交接", sourceText: "甲递信给乙。甲：“拿好。”", projectStyle: { presetId: "", title: "", prompt: "" }, characters: [], assets: [], config: { ...defaultConfig, model: "offline", textModel: "offline" }, skills: [skill], selectedSkillIds: [skill.skillId], approvedRevision: 1, approvedShotIds: [], storyboardMode });
            expect(create).toHaveBeenCalledTimes(1);
            const request = create.mock.calls[0]![0];
            expect(request.input?.shotDurationSeconds).toBe(15);
            expect(request.input?.metadata).toMatchObject({ storyboardMode: "standard", skillIds: [skill.skillId], storyboardPromptReview: { minDurationSeconds: 15, maxDurationSeconds: 15, maxInternalShotSeconds: 4, directorFormat: "shots-v1" } });
            expect(request.input?.metadata?.storyboardExecution).toBeUndefined();
            expect(request.input?.metadata?.storyboardPromptReview).not.toHaveProperty("minDirectorScriptChars");
            expect(request.input?.requirements).toContain("起幅→过程→落幅");
            expect(request.input?.requirements).not.toContain("3–6个30秒");
            const contract = request.prompt.slice(request.prompt.lastIndexOf("【受保护输出契约】"));
            expect(contract).toContain("durationSeconds=15");
            expect(contract).not.toContain("30秒");
            expect(result.rows[0]!.durationSeconds).toBe(15);
            expect(result.rows[0]!.videoMotionPrompt).toContain("→ 落幅：");
            expect(result.rows[0]!.videoMotionPrompt).not.toMatch(/\d+(?:秒|s\b)|\d{1,2}:\d{2}/u);
            expect(result.promptReview).toEqual([]);
            const restored = chapterStoryboardFromGenerationTask({ ...completed, prompt: request.prompt, inputJson: JSON.stringify(request.input) });
            expect(restored.rows[0]!.videoMotionPrompt).toBe(result.rows[0]!.videoMotionPrompt);
            expect(restored.promptReview).toEqual([]);
        } finally { prepare.mockRestore(); wait.mockRestore(); create.mockRestore(); }
    });
}

test("15s review detects time tracks, overlong shots and totals without rewriting returned content", () => {
    const policy = { minDurationSeconds: 15, maxDurationSeconds: 15, maxInternalShotSeconds: 4, directorFormat: "shots-v1" as const };
    const authored = compileChapterDirectorScript({ ...directorScript, shots: directorScript.shots.map((shot, index) => index ? shot : { ...shot, durationSeconds: 5, camera: "0–5秒：中景推近" }) }, 1);
    const row = { durationSeconds: 15, ...authored };
    const before = JSON.stringify(row);
    const issues = reviewChapterStoryboardPrompt([row], policy).join("；");
    expect(issues).toContain("镜头1 时长 5 秒");
    expect(issues).toContain("合计 17.5 秒");
    expect(issues).toContain("包含秒数或时间码");
    expect(JSON.stringify(row)).toBe(before);
    const countdown = compileChapterDirectorScript({ ...directorScript, shots: directorScript.shots.map((shot, index) => index ? shot : { ...shot, sound: "甲说：“还有15秒。”" }) }, 1);
    expect(reviewChapterStoryboardPrompt([{ durationSeconds: 15, ...countdown }], policy)).toEqual([]);
});
