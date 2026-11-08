import { expect, spyOn, test } from "bun:test";

import { storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import type { Skill } from "../src/services/api/skills";
import * as taskApi from "../src/services/api/task-center";
import { createSkillRuntime, skillRuntime } from "../src/services/skill-runtime";
import { useConfigStore } from "../src/stores/use-config-store";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";

const root = new URL("../../backend/internal/skills/seed/storyboard-30s/", import.meta.url);
const catalog: Array<{ id: string; name: string; description: string; file: string }> = await Bun.file(new URL("catalog.json", root)).json();
const contract = (await Bun.file(new URL("contract.md", root)).text()).trim();
const entries = await Promise.all(catalog.map(async (item) => ({
    skill: { skillId: item.id, skillName: item.name, description: item.description, isAdded: true, status: 1, versionId: `${item.id}-v1`, version: "1" } as Skill,
    content: `# ${item.name}\n\n${contract}\n\n${(await Bun.file(new URL(item.file, root)).text()).trim()}`,
})));
const files = new Map(entries.map((entry) => [entry.skill.skillId, {
    file: { path: "SKILL.md", kind: "markdown" as const, mimeType: "text/markdown", size: new TextEncoder().encode(entry.content).length, sha256: new Bun.CryptoHasher("sha256").update(entry.content).digest("hex") },
    content: entry.content,
    binary: false,
}]));

function offlineRuntime() {
    return createSkillRuntime({
        listFiles: async (id) => ({ files: [files.get(id)!.file] }),
        getFile: async (id, path) => {
            expect(path).toBe("SKILL.md");
            return { file: files.get(id)! };
        },
    });
}

test("all five real 30-second skills load fully within the four-skill context budget", async () => {
    const runtime = offlineRuntime();
    for (let offset = 0; offset < entries.length; offset += 1) {
        const selected = [...entries.slice(offset), ...entries.slice(0, offset)].slice(0, 4);
        const result = await runtime.prepare({ profile: "shortDrama", prompt: "拆解完整章节", skills: entries.map((entry) => entry.skill), selectedSkillIds: selected.map((entry) => entry.skill.skillId) });
        expect(result.selectedSkills).toHaveLength(4);
        for (const entry of selected) expect(result.prompt).toContain(entry.content);
        expect(result.prompt).not.toContain("文件内容超过本轮技能上下文预算");
        expect(result.metadata.skillVersions).toHaveLength(4);
        expect(result.metadata.skillFiles).toEqual(selected.map((entry) => ({ skillId: entry.skill.skillId, path: "SKILL.md", sha256: files.get(entry.skill.skillId)!.file.sha256 })));
    }
});

for (const dialogueConstraintMode of ["paced", "unrestricted"] as const) {
    test(`30-second skills preserve the ${dialogueConstraintMode} mode and the actual storyboard request contract`, async () => {
        const dialogue = "主角：“我把东西留在这里，你一定要亲手交给他。”";
        const row = { shotNumber: 1, durationSeconds: 30, plotDescription: "主角交代道具的去向。", dialogue, videoMotionPrompt: storyboardSequencePrompt, characters: [], assetBindings: [] };
        const completed: taskApi.GenerationTask = {
            id: "offline-30s-skills", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "",
            resultJson: JSON.stringify({ rows: [row] }),
        };
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
        const runtime = offlineRuntime();
        const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => runtime.prepare(input));
        const selected = entries.slice(0, 4).map((entry) => entry.skill);
        try {
            const result = await generateChapterStoryboard({
                projectId: "offline-project", chapterId: "offline-chapter", chapterTitle: "交接", sourceText: dialogue,
                projectStyle: { presetId: "historical", title: "历史写实", prompt: "历史写实" }, characters: [], assets: [],
                config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
                skills: selected, selectedSkillIds: selected.map((skill) => skill.skillId), storyboardMode: "continuous_30s",
                dialogueConstraintMode, approvedRevision: 1, approvedShotIds: [],
            });
            expect(create).toHaveBeenCalledTimes(1);
            const submitted = create.mock.calls[0]![0];
            expect(submitted.input?.shotDurationSeconds).toBe(30);
            expect(submitted.input?.shotCount).toBe(0);
            expect(submitted.input?.requirements).toContain("【本次运镜技能执行要点】");
            expect(submitted.input?.requirements).toContain("不得整章机械套用固定机位");
            expect(submitted.prompt.lastIndexOf("【本次运镜技能执行要点】")).toBeGreaterThan(submitted.prompt.indexOf("【本章角色定义】"));
            expect(submitted.input?.metadata).toMatchObject({ dialogueConstraintMode, skillIds: selected.map((skill) => skill.skillId) });
            for (const entry of entries.slice(0, 4)) expect(submitted.prompt).toContain(entry.content);
            expect(submitted.prompt).toContain(dialogue);
            expect(submitted.prompt.endsWith(storyboardRowsOutputContract("每个生成单元必须能独立用于生成首帧图片和镜头视频。", "continuous_30s"))).toBe(true);
            if (dialogueConstraintMode === "unrestricted") {
                expect(submitted.prompt).toContain("对白字数限制：关闭");
                expect(submitted.prompt).not.toMatch(/25[～–-]45\s*字|40[～–-]60\s*字|150[～–-]170\s*字/u);
            } else {
                expect(submitted.prompt).toContain("当前对白节奏限制：启用");
            }
            expect(result.rows[0]!.dialogue).toBe(dialogue);
            expect(result.rows[0]!.durationSeconds).toBe(30);
        } finally {
            prepare.mockRestore();
            wait.mockRestore();
            create.mockRestore();
        }
    });
}
