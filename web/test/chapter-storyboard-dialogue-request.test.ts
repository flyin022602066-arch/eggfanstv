import { expect, spyOn, test } from "bun:test";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import * as taskApi from "../src/services/api/task-center";
import { useConfigStore } from "../src/stores/use-config-store";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";
import { storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { createSkillRuntime, skillRuntime } from "../src/services/skill-runtime";
import type { Skill } from "../src/services/api/skills";

for (const mode of ["standard", "continuous_30s"] as const) {
    test(`${mode} submits dialogue planning rules on the first request and preserves returned dialogue`, async () => {
        const dialogue = `林默：“${"我留下来不是为了争输赢，而是想让你平安回家。".repeat(5)}”`;
        const sourceText = `林默收起旧信，抬头说：${dialogue}守卫回答：“我明白了。”`;
        const sourceRow = {
            shotNumber: 1,
            durationSeconds: mode === "continuous_30s" ? 30 : 15,
            plotDescription: "林默收起旧信，与守卫交谈。",
            dialogue,
            videoMotionPrompt: `${storyboardSequencePrompt}\n林默完整台词：${dialogue}`,
            imageGenerationPrompt: "林默站在旧屋内，右手拿着旧信。",
            characters: [],
            assetBindings: [],
        };
        const completed: taskApi.GenerationTask = {
            id: "offline-storyboard",
            projectId: "offline-project",
            type: "canvas_text",
            status: "succeeded",
            prompt: "",
            attempts: 1,
            createdAt: "2026-10-24T00:00:00Z",
            updatedAt: "2026-10-24T00:00:00Z",
            resultJson: JSON.stringify({ mode: "text", text: JSON.stringify({ title: "重逢", rows: [sourceRow] }) }),
        };
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
        const skills = ["screenplay", "camera", "acting", "art"].map((skillId) => ({ skillId, skillName: skillId, isAdded: true, versionId: `${skillId}-v1`, version: "1" }) as Skill);
        const file = { path: "SKILL.md", kind: "markdown", mimeType: "text/markdown", size: 100, sha256: "offline-hash" };
        const offlineRuntime = createSkillRuntime({
            getFile: async (skillId) => ({ file: { file, content: `# ${skillId}\n默认先分析、不输出完整分镜；遵循摄影、人物表演和连续性。`, binary: false } }),
            listFiles: async () => ({ files: [file] }),
        });
        const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => offlineRuntime.prepare(input));
        try {
            const result = await generateChapterStoryboard({
                projectId: "offline-project",
                chapterId: "offline-chapter",
                chapterTitle: "重逢",
                sourceText,
                projectStyle: { presetId: "historical", title: "历史写实", prompt: "历史写实，保持服装一致。" },
                characters: [{ assetId: "character", name: "林默", definition: { multiViewPrompt: "角色设定资料。".repeat(1000) } }],
                assets: [{ id: "scene", title: "旧屋", type: "image", category: "environment", tags: [], prompt: "旧屋资产设定资料。".repeat(2000) }],
                config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
                skills,
                selectedSkillIds: skills.map((skill) => skill.skillId),
                storyboardMode: mode,
                approvedRevision: 1,
                approvedShotIds: [],
            });
            expect(create).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(1);
            expect(prepare).toHaveBeenCalledTimes(1);
            const submitted = create.mock.calls[0]![0];
            expect(submitted).toMatchObject({ operation: "storyboard", model: "offline-text", input: { mode: "text", shotDurationSeconds: mode === "continuous_30s" ? 30 : 0 } });
            expect(submitted.prompt).toContain(sourceText);
            for (const skill of skills) expect(submitted.prompt).toContain(`skill-id="${skill.skillId}"`);
            expect(submitted.input?.metadata).toMatchObject({ skillIds: skills.map((skill) => skill.skillId), skillFiles: skills.map((skill) => ({ skillId: skill.skillId, path: "SKILL.md", sha256: "offline-hash" })) });
            expect(submitted.prompt).toContain(String(submitted.input?.requirements));
            expect(submitted.prompt).toMatch(/每分钟\s*150[～–-]170\s*字/u);
            expect(submitted.prompt).toMatch(/不是[^\n]*硬性字数上限/u);
            expect(submitted.prompt).toMatch(/禁止[^\n]*句中截断/u);
            expect(submitted.prompt).toMatch(/完整对白[^\n]*顺延[^\n]*下一/u);
            expect(submitted.prompt).toContain("正反打");
            expect(submitted.prompt).toContain("人物微表情");
            expect(submitted.prompt).toContain("对白耗时优先于原文容量");
            expect(submitted.prompt).toContain("资产与声音");
            expect(submitted.prompt).toContain("600 字符以内");
            expect(submitted.prompt).toContain("不是可念出 600 字台词");
            const contract = storyboardRowsOutputContract("每个生成单元必须能独立用于生成首帧图片和镜头视频。", mode);
            expect(submitted.prompt.endsWith(contract)).toBe(true);
            expect(submitted.prompt.indexOf("【本章角色定义】")).toBeLessThan(submitted.prompt.indexOf(String(submitted.input?.requirements)));
            expect(submitted.prompt).toContain("本次交付阶段已经确定为完整分镜制作");
            expect(submitted.prompt).toContain("镜头与表演");
            expect(submitted.prompt).toContain("600 字符目标只约束资产与声音附录");
            expect(submitted.prompt).not.toContain("videoMotionPrompt（运镜与结尾状态）");
            if (mode === "continuous_30s") {
                expect(submitted.prompt).toContain("禁止用阶段一、阶段二");
                expect(submitted.prompt).toContain("每个 rows 项内部的镜头编号都从镜头1重新开始");
                expect(submitted.prompt).not.toContain("rows 每项对应一个镜头");
                expect(submitted.prompt).toContain("可以超过 1000 字");
            }
            expect(submitted.prompt).toContain("400 字对白");
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]!.dialogue).toBe(dialogue);
            expect(result.rows[0]!.videoMotionPrompt).toBe(sourceRow.videoMotionPrompt);
            expect(result.taskId).toBe("offline-storyboard");
        } finally {
            prepare.mockRestore();
            wait.mockRestore();
            create.mockRestore();
        }
    });
}
