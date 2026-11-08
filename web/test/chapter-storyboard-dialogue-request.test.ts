import { expect, spyOn, test } from "bun:test";
import { generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import * as taskApi from "../src/services/api/task-center";
import { useConfigStore } from "../src/stores/use-config-store";
import { storyboardSequencePrompt } from "./fixtures/storyboard-sequence";
import { storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { createSkillRuntime, skillRuntime } from "../src/services/skill-runtime";
import type { Skill } from "../src/services/api/skills";

test("scene whitelist keeps semantic locations whose catalog titles are not literal source substrings", async () => {
    const create = spyOn(taskApi, "createGenerationTask").mockRejectedValue(new Error("captured request"));
    try {
        await expect(generateChapterStoryboard({
            projectId: "offline-project", chapterId: "chapter", chapterTitle: "本章", sourceText: "窗玻璃已经结霜。纪昼摘下手套，将指尖按在冰冷的玻璃上。",
            projectStyle: { presetId: "", title: "", prompt: "" }, characters: [],
            assets: [
                { id: "window", title: "结霜窗前室内", type: "image", category: "environment", tags: [], prompt: "完整的窗边外观参考" },
                { id: "other", title: "室内训练区", type: "image", category: "environment", tags: [], prompt: "不相关的整段制图提示词" },
            ],
            config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
            skills: [], selectedSkillIds: [], approvedRevision: 1, approvedShotIds: [],
        })).rejects.toThrow("captured request");
        const request = create.mock.calls[0]![0];
        expect(request.input?.metadata?.storyboardAssets).toContainEqual({ id: "window", title: "结霜窗前室内", type: "image", category: "environment" });
        expect(request.prompt).toContain('["window","结霜窗前室内","environment",[]]');
        expect(request.prompt).not.toContain("不相关的整段制图提示词");
    } finally { create.mockRestore(); }
});

test("chapter storyboard scopes character definitions and returned cast to source appearances", async () => {
    const completed: taskApi.GenerationTask = {
        id: "offline-visibility", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "",
        resultJson: JSON.stringify({ rows: [{ durationSeconds: 5, plotDescription: "林夏独坐。", dialogue: "林夏：陈默明天才回来。", characters: ["林夏", "陈默", "潇潇"], assetBindings: [{ nodeId: "phantom", role: "character" }], videoMotionPrompt: "林夏抬头。" }] }),
    };
    const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
    const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
    try {
        const result = await generateChapterStoryboard({
            projectId: "offline-project", chapterId: "chapter", chapterTitle: "本章", sourceText: "林夏独坐，说道：‘陈默明天才回来。’",
            projectStyle: { presetId: "historical", title: "历史写实", prompt: "历史写实" },
            characters: ["林夏", "陈默", "潇潇"].map((name, index) => ({ assetId: ["present", "mentioned", "phantom"][index], name, definition: {} })),
            assets: ["林夏", "陈默", "潇潇"].map((title, index) => ({ id: ["present", "mentioned", "phantom"][index]!, title, type: "character" as const, tags: [], prompt: title })),
            config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
            skills: [], selectedSkillIds: [], approvedRevision: 1, approvedShotIds: [],
        });
        const submitted = create.mock.calls[0]![0];
        expect((submitted.input?.characters as Array<{ name: string }>).map((character) => character.name)).toEqual(["林夏"]);
        expect((submitted.input?.canvasAssets as Array<{ id: string }>).map((asset) => asset.id)).toEqual(["present"]);
        expect(submitted.input?.metadata?.chapterSourceText).toBe("林夏独坐，说道：‘陈默明天才回来。’");
        expect(JSON.stringify(result.rows[0]!.characters)).not.toContain("潇潇");
        expect(JSON.stringify(result.rows[0]!.characters)).not.toContain("陈默");
        expect(result.rows[0]!.assetBindings).toEqual([]);
        expect(result.rows[0]!.dialogue).toBe("林夏：陈默明天才回来。");
    } finally {
        wait.mockRestore();
        create.mockRestore();
    }
});

test("a failed selected skill stops storyboard submission and preserves named preparation outcomes", async () => {
    const create = spyOn(taskApi, "createGenerationTask").mockImplementation(async () => { throw new Error("unexpected model submission"); });
    const runtime = createSkillRuntime({
        listFiles: async () => ({ files: [] }),
        getFile: async () => { throw new Error("offline file read failure"); },
    });
    const prepare = spyOn(skillRuntime, "prepare").mockImplementation((input) => runtime.prepare(input));
    let failure: unknown;
    try {
        await generateChapterStoryboard({
            projectId: "offline-project", chapterId: "chapter", chapterTitle: "初遇", sourceText: "林默走进房间。",
            projectStyle: { presetId: "fantasy", title: "奇幻", prompt: "奇幻动画" }, characters: [], assets: [],
            config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
            skills: [{ skillId: "camera", skillName: "摄影机位", isAdded: true, version: "1", versionId: "v1" } as Skill],
            selectedSkillIds: ["camera"], approvedRevision: 1, approvedShotIds: [],
        });
    } catch (error) { failure = error; }
    finally { prepare.mockRestore(); }
    try {
        expect(failure).toMatchObject({ name: "SkillRuntimePreparationError", report: [{ skillId: "camera", skillName: "摄影机位", status: "failed", reason: "file_read_failed" }] });
        expect(create).not.toHaveBeenCalled();
    } finally { create.mockRestore(); }
});

test("拟人化系统设定与原文一并提交，结果冻结形象并承接系统台词", async () => {
    const settings = { mode: "character" as const, characterName: "小白", characterAppearance: "白狐狸精灵，蓝色翅膀", characterVoice: "清亮活泼的少女音" };
    const sourceText = "【叮！宿主获得十点灵气。】";
    const completed = {
        id: "offline-system-character", type: "canvas_text", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "",
        resultJson: JSON.stringify({ rows: [{ durationSeconds: 30, characters: [], videoMotionPrompt: "主角抬起头。" }] }),
    };
    const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued", resultJson: undefined });
    const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
    try {
        const result = await generateChapterStoryboard({
            projectId: "offline-project", chapterId: "chapter", chapterTitle: "初遇", sourceText,
            projectStyle: { presetId: "fantasy", title: "奇幻", prompt: "奇幻动画" }, characters: [], assets: [],
            config: { ...useConfigStore.getInitialState().config, model: "offline-text", textModel: "offline-text" },
            skills: [], selectedSkillIds: [], storyboardMode: "continuous_30s", systemPresentation: settings, approvedRevision: 1, approvedShotIds: [],
        });
        const submitted = create.mock.calls[0]![0];
        expect(submitted.input?.metadata).toMatchObject({ systemPresentation: settings });
        for (const value of [settings.characterName, settings.characterAppearance, settings.characterVoice, sourceText]) expect(submitted.prompt).toContain(value);
        expect(submitted.input?.requirements).not.toContain("系统信息不是角色资产");
        expect(result.rows[0]!.characters).toContainEqual({ characterName: "小白" });
        expect(result.rows[0]!.videoMotionPrompt).toContain(sourceText);
        expect(result.rows[0]!.videoMotionPrompt).toContain("小白");
    } finally {
        wait.mockRestore();
        create.mockRestore();
    }
});

for (const mode of ["standard", "continuous_30s"] as const) {
  for (const dialogueConstraintMode of ["paced", "unrestricted"] as const) {
    test(`${mode}/${dialogueConstraintMode} submits the selected dialogue rules and preserves returned dialogue`, async () => {
        const dialogue = `林默：“${"我留下来不是为了争输赢，而是想让你平安回家。".repeat(5)}”`;
        const systemPanel = "【宿主：苏夜】\n【进化点：0】";
        const sourceText = mode === "standard"
            ? `林默收起旧信，抬头说：${dialogue}守卫回答：“我明白了。”\n${systemPanel}`
            : `林默收起旧信，抬头说：${dialogue}守卫回答：“我明白了。”`;
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
                dialogueConstraintMode,
                approvedRevision: 1,
                approvedShotIds: [],
            });
            expect(create).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(1);
            expect(prepare).toHaveBeenCalledTimes(1);
            const submitted = create.mock.calls[0]![0];
            const requirements = String(submitted.input?.requirements);
            expect(submitted).toMatchObject({ operation: "storyboard", model: "offline-text", input: { mode: "text", shotDurationSeconds: mode === "continuous_30s" ? 30 : 0 } });
            expect(submitted.prompt).toContain(sourceText);
            if (mode === "standard") {
                expect(submitted.prompt).toContain("【系统/界面事实保护清单】");
                expect(result.rows[0]!.systemElements).toEqual([systemPanel]);
                expect(result.rows[0]!.imageGenerationPrompt).toContain(systemPanel);
                expect(result.rows[0]!.videoMotionPrompt).toContain(systemPanel);
            }
            for (const skill of skills) expect(submitted.prompt).toContain(`skill-id="${skill.skillId}"`);
            expect(submitted.input?.metadata).toMatchObject({
                skillIds: skills.map((skill) => skill.skillId),
                skillFiles: skills.map((skill) => ({ skillId: skill.skillId, path: "SKILL.md", sha256: "offline-hash" })),
                skillLoadReport: skills.map((skill) => ({ skillId: skill.skillId, skillName: skill.skillName, version: skill.version, status: "loaded", files: ["SKILL.md"], truncated: false })),
                dialogueConstraintMode,
            });
            expect(result.skillLoadReport).toEqual(submitted.input?.metadata?.skillLoadReport);
            expect(submitted.prompt).toContain(String(submitted.input?.requirements));
            if (mode === "continuous_30s") {
                expect(requirements).toContain("90～180 秒");
                expect(requirements).toContain("3～6 个 30 秒生成单元");
                expect(requirements).toContain("不是把每句叙述都转成旁白逐字朗读");
                expect(requirements).toContain("快切、反打和反应镜头在段内执行");
                expect(requirements).toContain("600 字符目标只约束资产与声音附录");
            }
            if (dialogueConstraintMode === "paced") {
                expect(requirements).toMatch(/每分钟\s*150[～–-]170\s*字/u);
                expect(requirements).toContain("整集");
                expect(requirements).toMatch(/完整对白[^\n]*顺延[^\n]*下一/u);
                expect(submitted.prompt).toContain("400 字对白");
            } else {
                expect(requirements).toContain("对白字数限制：关闭");
                expect(requirements).not.toMatch(/25[～–-]45 字|40[～–-]60 字|60[～–-]70 字|80 字阈值|150[～–-]170 字|固定停顿秒数/u);
                expect(requirements).not.toContain("对白耗时优先于原文容量");
                expect(requirements).toContain("需要跨单元承接时只在完整句末或完整话轮边界拆分");
            }
            expect(requirements).toMatch(/(?:禁止|不得)[^\n]*句中截断/u);
            expect(submitted.prompt).toContain("正反打");
            expect(submitted.prompt).toContain("人物微表情");
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
                for (const requirement of ["1000—2000 字", "动作发起与受力", "对手如何接招", "过程：", "不触发自动重写"]) expect(requirements).toContain(requirement);
                expect(contract).toMatch(/1000[—–]2000 字/u);
                expect(contract).toContain("对手反应");
                expect(result.rows[0]!.videoMotionPrompt).toBe(sourceRow.videoMotionPrompt);
            }
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]!.dialogue).toBe(dialogue);
            expect(result.rows[0]!.videoMotionPrompt).toContain(sourceRow.videoMotionPrompt);
            expect(result.taskId).toBe("offline-storyboard");
        } finally {
            prepare.mockRestore();
            wait.mockRestore();
            create.mockRestore();
        }
    });
  }
}
