import { expect, spyOn, test } from "bun:test";
import { chapterStoryboardDurationPolicy, chapterStoryboardDurationRequirements, reviewChapterStoryboardPrompt } from "../src/lib/chapter-storyboard-mode";
import { storyboardRowsOutputContract } from "../src/lib/canvas/canvas-project-domain";
import { chapterStoryboardFromGenerationTask, generateChapterStoryboard } from "../src/pages/projects/detail/project-chapter-ai";
import * as taskApi from "../src/services/api/task-center";
import { skillRuntime } from "../src/services/skill-runtime";
import { defaultConfig } from "../src/stores/use-config-store";

const skillContext = '<skill-context skill-id="fifteen">\n> **时长硬约束**：最终交付每个 Clip 必须 **4\\~15 秒**。\n严格控制总时长为15秒，保持单镜头叙事。\n</skill-context>';

test("duration policy uses explicit output constraints, never incidental seconds or internal cuts", () => {
    expect(chapterStoryboardDurationPolicy(skillContext)).toEqual({ minDurationSeconds: 15, maxDurationSeconds: 15 });
    expect(chapterStoryboardDurationPolicy("最终交付每个 Clip 必须 4\\~15 秒")).toEqual({ minDurationSeconds: 4, maxDurationSeconds: 15 });
    expect(chapterStoryboardDurationPolicy("默认参数：时长15秒。前30秒剧本最多150字。内部镜头最长4秒。")).toEqual({});
    expect(chapterStoryboardDurationPolicy("顶层固定30秒生成单元（durationSeconds=30）")).toEqual({ minDurationSeconds: 30, maxDurationSeconds: 30 });
});

test("output contract and review share the selected clip duration without truncating the script", () => {
    const policy = chapterStoryboardDurationPolicy(skillContext);
    const contract = storyboardRowsOutputContract("complete", "standard", policy);
    expect(contract).toContain("durationSeconds（整数，固定15）");
    expect(contract).not.toContain("整数，1-60");
    const rows = [{ durationSeconds: 18, videoMotionPrompt: "完整对白和连续动作" }, { durationSeconds: 15, videoMotionPrompt: "另一个镜头" }];
    expect(reviewChapterStoryboardPrompt(rows, policy)).toEqual([expect.stringContaining("第 1 段：时长18秒不符合所选技能的15秒")]);
    expect(rows[0]).toEqual({ durationSeconds: 18, videoMotionPrompt: "完整对白和连续动作" });
});

test("conflicting durations stop a new request while old generated content remains recoverable", () => {
    const prompt = `${skillContext}\n<skill-context>顶层固定30秒生成单元</skill-context>\n【用户任务】\n完整章节`;
    const policy = chapterStoryboardDurationPolicy(prompt.split("【用户任务】")[0]!);
    expect(() => chapterStoryboardDurationRequirements(policy)).toThrow("时长规则冲突");
    const completed: taskApi.GenerationTask = { id: "offline-conflict", type: "canvas_text", status: "succeeded", prompt, attempts: 1, createdAt: "", updatedAt: "", inputJson: JSON.stringify({ metadata: { storyboardMode: "standard" } }), resultJson: JSON.stringify({ rows: [{ durationSeconds: 18, videoMotionPrompt: "完整动作与对白", characters: [] }] }) };
    const recovered = chapterStoryboardFromGenerationTask(completed);
    expect(recovered.rows[0]!.videoMotionPrompt).toBe("完整动作与对白");
    expect(recovered.promptReview).toContainEqual(expect.stringContaining("时长规则冲突"));
});

for (const storyboardMode of ["standard", "continuous_30s"] as const) {
    test(`${storyboardMode} requests the selected 15s skill and reviews restored results`, async () => {
        const completed: taskApi.GenerationTask = { id: "offline-duration", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ rows: [{ durationSeconds: 18, videoMotionPrompt: "完整动作", characters: [] }] }) };
        const create = spyOn(taskApi, "createGenerationTask").mockResolvedValue({ ...completed, status: "queued" });
        const wait = spyOn(taskApi, "waitForGenerationTask").mockResolvedValue(completed);
        const prepare = spyOn(skillRuntime, "prepare").mockResolvedValue({ prompt: `${skillContext}\n【用户任务】\n章节原文中有60秒的倒计时。`, selectedSkills: [], metadata: {} } as Awaited<ReturnType<typeof skillRuntime.prepare>>);
        try {
            const generated = await generateChapterStoryboard({ projectId: "offline", chapterId: "chapter", chapterTitle: "test", sourceText: "人物走出门。", projectStyle: { presetId: "", title: "", prompt: "" }, characters: [], assets: [], config: { ...defaultConfig, model: "offline", textModel: "offline" }, skills: [], selectedSkillIds: [], approvedRevision: 1, approvedShotIds: [], storyboardMode });
            const request = create.mock.calls[0]![0];
            expect(request.input?.shotDurationSeconds).toBe(15);
            expect(request.input?.metadata?.storyboardMode).toBe("standard");
            expect(request.prompt).not.toContain("整数，1-60");
            expect(request.input?.requirements).not.toContain("3～6 个 30 秒");
            expect(request.input?.requirements).toContain("重新分配完整话轮与动作");
            expect(generated.rows[0]!.durationSeconds).toBe(18);
            expect(generated.promptReview).toContainEqual(expect.stringContaining("时长18秒"));
            const restored = chapterStoryboardFromGenerationTask({ ...completed, prompt: request.prompt, inputJson: JSON.stringify(request.input) });
            expect(restored.promptReview).toEqual(generated.promptReview);
            const legacy = chapterStoryboardFromGenerationTask({ ...completed, prompt: request.prompt, inputJson: JSON.stringify({ metadata: { storyboardMode: "standard", storyboardPromptReview: {} } }) });
            expect(legacy.promptReview).toContainEqual(expect.stringContaining("时长18秒"));
            expect(create).toHaveBeenCalledTimes(1);
        } finally { prepare.mockRestore(); wait.mockRestore(); create.mockRestore(); }
    });
}
