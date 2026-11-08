import { expect, spyOn, test } from "bun:test";
import { storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import type { Skill, SkillPackageFileContent } from "../src/services/api/skills";
import * as taskApi from "../src/services/api/task-center";
import { createSkillRuntime, skillRuntime } from "../src/services/skill-runtime";
import { useConfigStore } from "../src/stores/use-config-store";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

const root = new URL("../../skill-packages/short-drama-editing/short-drama-multicam-microshots/", import.meta.url);
const paths = ["SKILL.md", "references/microshot-direction.md", "references/video-generation.md"];
const contents = new Map<string, SkillPackageFileContent>();
for (const path of paths) {
    const content = await Bun.file(new URL(path, root)).text();
    contents.set(path, { file: { path, kind: "markdown", mimeType: "text/markdown", size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") }, content, binary: false });
}
const skill = { skillId: "short-drama-multicam-microshots", skillName: "高级短剧分镜·30秒段内多机位快切", isAdded: true, status: 1, versionId: "offline-v1", version: "1.0.0" } as Skill;
const others = ["adaptation", "lighting", "continuity"].map((id) => ({ ...skill, skillId: id, skillName: id }));
function offlineRuntime() {
    return createSkillRuntime({
        listFiles: async (id) => ({ files: id === skill.skillId ? [...contents.values()].map((item) => item.file) : [] }),
        getFile: async (id, path) => ({ file: id === skill.skillId ? contents.get(path)! : { file: { path, kind: "markdown", mimeType: "text/markdown", size: 8 }, content: "# Rules", binary: false } }),
    });
}

test("microshot directing reference loads fully beside three other selected skills", async () => {
    for (const profile of ["canvas", "shortDrama"] as const) {
        const result = await offlineRuntime().prepare({ profile, prompt: "根据小说设计同场景多机位分镜", skills: [skill, ...others], selectedSkillIds: [skill, ...others].map((item) => item.skillId) });
        expect(result.selectedSkills).toHaveLength(4);
        expect(result.prompt).toContain(contents.get("SKILL.md")!.content);
        expect(result.prompt).toContain(contents.get("references/microshot-direction.md")!.content);
        const report = result.metadata.skillLoadReport!.find((item) => item.skillId === skill.skillId)!;
        expect(report).toMatchObject({ status: "loaded", truncated: false, version: "1.0.0" });
        expect(report.files).toContain("references/microshot-direction.md");
        for (const path of report.files) expect(result.metadata.skillFiles).toContainEqual({ skillId: skill.skillId, path, sha256: contents.get(path)!.file.sha256 });
    }
});

test("video phase receives numeric pacing targets and the unchanged confirmed script", async () => {
    const prompt = "镜头1：甲说：‘我把东西留在这里，你一定要亲手交给他。’镜头2：同场景乙反应，甲同句声音连续。";
    const result = await offlineRuntime().prepare({ profile: "shortDrama", purpose: "video", prompt, skills: [skill], selectedSkillIds: [skill.skillId] });
    expect(result.prompt).toContain(prompt);
    expect(result.prompt).toContain(contents.get("references/video-generation.md")!.content.trim());
    expect(result.prompt).toContain("1–3秒");
    expect(result.prompt).toContain("最多4秒");
    expect(result.prompt).not.toContain(contents.get("SKILL.md")!.content);
    expect(result.metadata.skillLoadReport).toEqual([{ skillId: skill.skillId, skillName: skill.skillName, version: "1.0.0", status: "loaded", files: ["references/video-generation.md"], truncated: false }]);
});

test("chapter request keeps outer duration, exact dialogue and the established output contract", async () => {
    const dialogue = "主角：“我把东西留在这里，你一定要亲手交给他。”";
    const row = { shotNumber: 1, durationSeconds: 30, plotDescription: "主角交代道具去向。", dialogue, videoMotionPrompt: storyboardSequencePrompt, characters: [], assetBindings: [] };
    const completed: taskApi.GenerationTask = { id: "offline-microshots", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [row] }) };
    const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
    const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
    const runtime = offlineRuntime();
    const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => runtime.prepare(input));
    try {
        const result = await generateChapterStoryboard({ projectId: "offline-project", chapterId: "offline-chapter", chapterTitle: "交接", sourceText: dialogue, projectStyle: { presetId: "historical", title: "历史写实", prompt: "历史写实" }, characters: [], assets: [], config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" }, skills: [skill], selectedSkillIds: [skill.skillId], storyboardMode: "continuous_30s", dialogueConstraintMode: "unrestricted", approvedRevision: 1, approvedShotIds: [] });
        expect(create).toHaveBeenCalledTimes(1);
        const submitted = create.mock.calls[0]![0];
        expect(submitted.input?.shotDurationSeconds).toBe(30);
        expect(submitted.input?.shotCount).toBe(0);
        expect(submitted.prompt).toContain(dialogue);
        expect(submitted.prompt).toContain(contents.get("references/microshot-direction.md")!.content);
        const expectedPolicy = { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000 };
        expect(submitted.prompt.endsWith(storyboardRowsOutputContract("每个生成单元必须能独立用于生成首帧图片和镜头视频。", "continuous_30s", expectedPolicy))).toBe(true);
        expect(submitted.input?.metadata).toMatchObject({ skillIds: [skill.skillId], dialogueConstraintMode: "unrestricted", storyboardPromptReview: expectedPolicy });
        expect(result.rows[0]!.dialogue).toBe(dialogue);
        expect(result.rows[0]!.durationSeconds).toBe(30);
    } finally {
        prepare.mockRestore();
        wait.mockRestore();
        create.mockRestore();
    }
});
