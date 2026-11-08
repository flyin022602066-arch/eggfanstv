import { expect, spyOn, test } from "bun:test";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import type { Skill, SkillPackageFileContent } from "../src/services/api/skills";
import * as taskApi from "../src/services/api/task-center";
import { createSkillRuntime, SKILL_RUNTIME_PROFILES, skillRuntime } from "../src/services/skill-runtime";
import { useConfigStore } from "../src/stores/use-config-store";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

for (const [edition, displayName, version] of [
    ["chixie-rusong-v1", "持械入宋第一版", "1.1.0"],
    ["chixie-rusong-plus-v2", "持械入宋plus第二版", "2.3.0"],
]) {
const packages = [
    [`short-drama-editing/${edition}`, displayName, "references/director-optics-dialogue.md"],
    ["novel-adaptation/advanced-novel-screenplay", "高级小说拆解与短剧编剧", "references/novel-screenplay-spec.md"],
    ["cinematography/master-camera-blocking", "大师级摄影机位与镜头设计", "references/blocking-review.md"],
    ["cinematography/cinematic-lighting", "电影光影设计与精细布光", "references/lighting-review.md"],
    ["cinematography/cinematography-continuity", "摄影色彩与画面连续性质检", "references/continuity-review.md"],
];
const skills: Skill[] = [];
const files = new Map<string, Map<string, SkillPackageFileContent>>();
for (const [directory, display, reference] of packages) {
    const id = directory.split("/").at(-1)!;
    const skill = { skillId: id, skillName: display, isAdded: true, status: 1, versionId: `${id}-offline-v1`, version: id === edition ? version : "1.0.0" } as Skill;
    skills.push(skill);
    const contents = new Map<string, SkillPackageFileContent>();
    for (const path of ["SKILL.md", reference, ...(id === edition ? ["references/video-generation.md"] : [])]) {
        const content = await Bun.file(new URL(`../../skill-packages/${directory}/${path}`, import.meta.url)).text();
        contents.set(path, { file: { path, kind: "markdown", mimeType: "text/markdown", size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") }, content, binary: false });
    }
    files.set(id, contents);
    skill.description = contents.get("SKILL.md")!.content.match(/^description: (.+)$/m)![1];
}
const runtime = () => createSkillRuntime({ listFiles: async (id) => ({ files: [...files.get(id)!.values()].map((item) => item.file) }), getFile: async (id, path) => ({ file: files.get(id)!.get(path)! }) });
const prompt = "根据小说设计同场景多机位分镜，检查光影与连续性，保持原文对白。";

test(`${edition}: package version and complete selected context fit the per skill budget`, () => {
    const contents = [...files.get(edition)!.values()];
    expect(contents.find((item) => item.file.path === "SKILL.md")!.content).toContain(`version: ${version}`);
    expect(contents.reduce((total, item) => total + item.content.length, 0)).toBeLessThan(8_000);
});

test(`${edition}: five real short drama skills retain the four skill per package allowance and all required text`, async () => {
    const previous = await runtime().prepare({ profile: "canvas", prompt, skills, selectedSkillIds: skills.slice(0, 4).map((item) => item.skillId) });
    const expanded = await runtime().prepare({ profile: "shortDrama", prompt, skills, selectedSkillIds: skills.map((item) => item.skillId) });
    expect(expanded.selectedSkills).toHaveLength(5);
    expect(SKILL_RUNTIME_PROFILES.shortDrama.maxContextChars / 5).toBe(SKILL_RUNTIME_PROFILES.canvas.maxContextChars / 4);
    for (const skill of skills) {
        const report = expanded.metadata.skillLoadReport!.find((item) => item.skillId === skill.skillId)!;
        expect(report).toMatchObject({ status: "loaded", truncated: false });
        expect(report.files).toContain(packages.find(([directory]) => directory.endsWith(skill.skillId))![2]);
        for (const path of report.files) {
            const file = files.get(skill.skillId)!.get(path)!;
            expect(expanded.prompt).toContain(file.content);
            expect(expanded.metadata.skillFiles).toContainEqual({ skillId: skill.skillId, path, sha256: file.file.sha256 });
        }
        if (previous.selectedSkills.includes(skill)) expect(report.files).toEqual(previous.metadata.skillLoadReport!.find((item) => item.skillId === skill.skillId)!.files);
    }
    expect(expanded.prompt).not.toContain("文件内容超过本轮技能上下文预算");
});

test(`${edition}: video rules reach the prompt without changing the confirmed script`, async () => {
    const confirmed = "镜头1：甲说：‘我把东西留在这里，你一定要亲手交给他。’镜头2：同场景乙反应，甲同句声音连续。";
    const result = await runtime().prepare({ profile: "shortDrama", purpose: "video", prompt: confirmed, skills, selectedSkillIds: [skills[0]!.skillId] });
    expect(result.prompt).toContain(confirmed);
    expect(result.prompt).toContain(files.get(skills[0]!.skillId)!.get("references/video-generation.md")!.content.trim());
    expect(result.metadata.skillLoadReport).toMatchObject([{ status: "loaded", files: ["references/video-generation.md"], truncated: false }]);
});

for (const renamedOnly of [false, true]) {
test(`${edition}: ${renamedOnly ? "renamed camera skill alone" : "five selected skills"} reaches the real chapter request with exact dialogue and one thirty second row`, async () => {
    const selectedSkills = renamedOnly ? [{ ...skills[0]!, skillName: "持械入宋-plus-v2" }] : skills;
    const selectedSkillIds = selectedSkills.map((item) => item.skillId);
    const dialogue = "主角：“我把东西留在这里，你一定要亲手交给他。”";
    const row = { shotNumber: 1, durationSeconds: 30, plotDescription: "主角交代道具去向。", dialogue, videoMotionPrompt: storyboardSequencePrompt, characters: [], assetBindings: [] };
    const completed: taskApi.GenerationTask = { id: "offline-chixie", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [row] }) };
    const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
    const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
    const offline = runtime();
    const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => offline.prepare(input));
    try {
        const unrelated = "旧章整段场景与绘图指令，不属于本章剧情。".repeat(1000);
        const assets = [{ id: "prop", title: "交接物件", type: "image" as const, category: "prop", tags: [], aliases: ["东西"], prompt: JSON.stringify({ description: "已确认的物件外形", prompt: "制图参数和其他章节情节" }) }, { id: "old-scene", title: "旧章场景", type: "image" as const, category: "environment", tags: [], prompt: unrelated }];
        const result = await generateChapterStoryboard({ projectId: "offline-project", chapterId: "offline-chapter", chapterTitle: "交接", sourceText: dialogue, projectStyle: { presetId: "historical", title: "历史写实", prompt: "历史写实" }, characters: [], assets, config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" }, skills: selectedSkills, selectedSkillIds, storyboardMode: "continuous_30s", dialogueConstraintMode: "unrestricted", approvedRevision: 1, approvedShotIds: [] });
        expect(create).toHaveBeenCalledTimes(1);
        const submitted = create.mock.calls[0]![0];
        expect(submitted.input?.shotDurationSeconds).toBe(30);
        expect(submitted.input?.shotCount).toBe(0);
        expect(submitted.prompt).toContain(dialogue);
        expect(submitted.prompt).toContain(files.get(skills[0]!.skillId)!.get("references/director-optics-dialogue.md")!.content);
        expect(submitted.prompt).toContain("【本次运镜技能执行要点】");
        expect(submitted.prompt).toContain("所选技能明确的段内镜长与切换频率仍须执行");
        expect(submitted.prompt).not.toContain("本模式的格式、脚本密度与总时长规则优先于技能");
        expect(submitted.input?.metadata).toMatchObject({ skillIds: selectedSkillIds, dialogueConstraintMode: "unrestricted" });
        const report = (submitted.input?.metadata as { skillLoadReport: Array<{ status: string; truncated: boolean }> }).skillLoadReport;
        expect(report).toHaveLength(selectedSkills.length);
        expect(report.every((item) => item.status === "loaded" && !item.truncated)).toBe(true);
        expect(submitted.prompt).not.toContain(unrelated);
        expect(submitted.prompt).toContain("old-scene");
        expect(submitted.prompt).toContain("已确认的物件外形");
        expect(submitted.prompt).not.toContain("制图参数和其他章节情节");
        expect(submitted.input?.canvasAssets).toEqual(assets);
        const contract = submitted.prompt.slice(submitted.prompt.lastIndexOf("【受保护输出契约】"));
        expect(contract).toContain("1–3秒");
        expect(contract).toContain("最长4秒");
        expect(contract).toContain("1000–2000");
        expect(result.promptReview.join("；")).toContain("内部镜头");
        expect(result.rows[0]!.dialogue).toBe(dialogue);
        expect(result.rows[0]!.durationSeconds).toBe(30);
    } finally {
        prepare.mockRestore();
        wait.mockRestore();
        create.mockRestore();
    }
});
}
}
