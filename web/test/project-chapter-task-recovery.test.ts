import { describe, expect, test } from "bun:test";

import { chapterAssetsFromGenerationTask, chapterStoryboardFromGenerationTask, chapterStoryboardApprovalSnapshot, chapterStoryboardRecoveryDecision, chapterTaskIdentity } from "@/pages/projects/detail/project-chapter-ai";
import type { GenerationTask } from "@/services/api/task-center";

describe("章节生成任务刷新恢复", () => {
    test("已生成只反映已写入镜头，保存失败仍提供现有结果的写入入口", async () => {
        const source = await Bun.file(new URL("../src/pages/projects/detail/chapters.tsx", import.meta.url)).text();
        const savedState = source.slice(source.indexOf("const storyboardGenerated"), source.indexOf("const visibleUnits"));
        expect(savedState).toContain("storyboardImpact.shotCount > 0");
        expect(savedState).not.toContain("serverCompletedOperations");
        expect(savedState).not.toContain("completedChapterOperations");
        const saveFailure = source.slice(source.indexOf("if (generated && isStoryboardReplacementConflict"), source.indexOf("const confirmStoryboardReplacement"));
        expect(saveFailure).toContain("if (generated) queuePendingStoryboardRecovery");
    });

    test("取回拟人化系统资产沿用提交时的形象，不补成面板道具", () => {
        const result = chapterAssetsFromGenerationTask(task({
            status: "succeeded",
            resultJson: JSON.stringify({ mode: "text", text: '{"characters":[],"scenes":[],"props":[]}' }),
            inputJson: JSON.stringify({ metadata: { promptTemplateOperation: "chapter_assets_extract", promptTemplateVariables: { 章节正文: "【叮！任务完成，奖励已发放。】", 系统表现模式: "character", 系统角色名称: "小白", 系统角色形象: "有蓝色翅膀的白狐狸", 系统角色声音: "清亮活泼的少女音" } } }),
        }));
        expect(result.props).toEqual([]);
        expect(result.characters).toHaveLength(1);
        expect(result.characters[0]).toMatchObject({ name: "小白", appearance: "有蓝色翅膀的白狐狸", voiceTimbre: "清亮活泼的少女音" });
    });

    test("拟人化分镜恢复仍承接原文和角色身份，不追加面板表现规则", () => {
        const settings = { mode: "character", characterName: "小白", characterAppearance: "有蓝色翅膀的白狐狸", characterVoice: "清亮活泼的少女音" };
        const text = "【宿主：苏夜】\n【灵气：80】";
        const result = chapterStoryboardFromGenerationTask(task({
            status: "succeeded",
            resultJson: JSON.stringify({ rows: [{ shotNumber: 1, durationSeconds: 30, videoMotionPrompt: "苏夜抬头。", imageGenerationPrompt: "苏夜看向前方。", characters: [] }] }),
            inputJson: JSON.stringify({ metadata: { systemPresentation: settings, protectedSystemElements: [{ text, positionRatio: 0 }] } }),
        }));
        expect(result.rows[0]!.systemPresentation).toEqual(settings);
        expect(result.rows[0]!.characters).toContainEqual({ characterName: "小白" });
        expect(result.rows[0]!.videoMotionPrompt).toContain("小白");
        expect(result.rows[0]!.videoMotionPrompt).toContain(text);
        expect(result.rows[0]!.videoMotionPrompt).not.toContain("作为画面内系统界面");
    });

    test("刷新取回的无括号状态字段也补回系统道具", () => {
        const result = chapterAssetsFromGenerationTask(task({
            status: "succeeded",
            resultJson: JSON.stringify({ mode: "text", text: '{"characters":[],"scenes":[],"props":[]}' }),
            inputJson: JSON.stringify({ metadata: { promptTemplateOperation: "chapter_assets_extract", promptTemplateVariables: { 章节正文: "进化系统启动中\n宿主：苏夜\n等级：D级" } } }),
        }));
        expect(result.props.map((asset) => asset.name)).toEqual(["进化系统面板"]);
    });

    test("刷新取回时也按任务冻结原文补回模型漏提的系统道具", () => {
        const result = chapterAssetsFromGenerationTask(task({
            status: "succeeded",
            resultJson: JSON.stringify({ mode: "text", text: '{"characters":[],"scenes":[],"props":[]}' }),
            inputJson: JSON.stringify({ metadata: { promptTemplateOperation: "chapter_assets_extract", promptTemplateVariables: { 章节正文: "【进化系统启动中】\n【宿主：苏夜】\n【等级：D级】" } } }),
        }));
        expect(result.props).toHaveLength(1);
        expect(result.props[0]!.name).toBe("进化系统面板");
        expect(result.characters).toEqual([]);
    });

    test("优先从任务列表的安全客户端上下文识别章节与操作", () => {
        expect(chapterTaskIdentity(task({
            clientContext: {
                domainProjectId: "project-1",
                chapterId: "chapter-1",
                chapterOperation: "characters",
            },
        }))).toEqual({ chapterId: "chapter-1", kind: "characters" });
    });

    test("任务详情可从脱敏输入 metadata 恢复分镜操作", () => {
        expect(chapterTaskIdentity(task({
            inputJson: JSON.stringify({
                metadata: {
                    domainProjectId: "project-1",
                    chapterId: "chapter-2",
                    source: "short-drama-chapter-storyboard",
                },
            }),
        }))).toEqual({ chapterId: "chapter-2", kind: "storyboard" });
    });

    test("无关、缺少章节或损坏的任务输入不会关联章节按钮", () => {
        expect(chapterTaskIdentity(task({ inputJson: "{" }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { operation: "chapter_character_breakdown" } }) }))).toBeNull();
        expect(chapterTaskIdentity(task({ inputJson: JSON.stringify({ metadata: { chapterId: "chapter-1", operation: "other" } }) }))).toBeNull();
    });

    test("从任务输入读取原批准快照，拒绝用当前页面版本顶上", () => {
        const current = { revision: 9, shotIds: ["shot-a"] };
        const snapshot = chapterStoryboardApprovalSnapshot(JSON.stringify({
            metadata: {
                domainProjectId: "project-1",
                chapterId: "chapter-1",
                source: "short-drama-chapter-storyboard",
                approvedRevision: 4,
                approvedShotIds: ["shot-a"],
            },
        }));
        expect(snapshot).toEqual({ revision: 4, shotIds: ["shot-a"] });
        expect(snapshot).not.toEqual(current);
    });

    test("刷新后按真实回执分类：已写入跳过，未写入进入核对", () => {
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: true })).toEqual({ action: "skip" });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false })).toEqual({ action: "review" });
    });

    test("未写入结果即使仍有原批准快照也不会自动写入", () => {
        const snapshot = chapterStoryboardApprovalSnapshot(JSON.stringify({
            metadata: {
                source: "short-drama-chapter-storyboard",
                approvedRevision: 5,
                approvedShotIds: ["shot-a"],
            },
        }));
        expect(snapshot).toEqual({ revision: 5, shotIds: ["shot-a"] });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false })).toEqual({ action: "review" });
    });

    test("原批准快照与当前章节完全一致时自动回填，变化后保留结果待核对", () => {
        const approved = { revision: 5, shotIds: ["shot-a", "shot-b"] };
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false, approved, current: { ...approved, shotIds: [...approved.shotIds] } })).toEqual({ action: "apply" });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false, approved, current: { revision: 6, shotIds: approved.shotIds } })).toEqual({ action: "review" });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false, approved, current: { revision: 5, shotIds: ["shot-a", "shot-c"] } })).toEqual({ action: "review" });
        expect(chapterStoryboardRecoveryDecision({ alreadyApplied: false, approved: null, current: approved })).toEqual({ action: "review" });
    });

    test("恢复路径使用任务身份与冻结快照，不靠时间戳猜测", async () => {
        const source = await Bun.file(new URL("../src/pages/projects/detail/chapters.tsx", import.meta.url)).text();
        const helper = await Bun.file(new URL("../src/pages/projects/detail/project-chapter-ai.ts", import.meta.url)).text();
        const createStoryboard = source.slice(source.indexOf("const createStoryboard"));
        const applyRecovery = source.slice(source.indexOf("const applyPendingStoryboardRecovery"));
        expect(helper).toContain("approvedRevision: input.approvedRevision");
        expect(helper).toContain("approvedShotIds: input.approvedShotIds.slice()");
        expect(helper).toContain("taskId: completed.id");
        expect(helper).toContain("expectedScope: options?.expectedScope");
        expect(source).toContain("listChapterApplyReceipts");
        expect(source).toContain("sourceTaskId");
        expect(source).toContain("captureUserScope");
        expect(source).toContain("queryGenerationTask(task.id, { expectedScope })");
        expect(source).toContain("核对后写入");
        expect(createStoryboard.indexOf("const approvedRevision")).toBeLessThan(createStoryboard.indexOf("confirmStoryboardReplacement"));
        expect(applyRecovery).toContain("readCurrentStoryboardApproval");
        expect(applyRecovery).toContain("readCurrentApproval: () => readCurrentStoryboardApproval");
        expect(source).toContain("const readCurrentStoryboardApproval = async");
        expect(source).toContain("staleTime: 0");
        expect(applyRecovery).toContain("formatStoryboardRecoveryError(error)");
        expect(applyRecovery).toContain("applyingStoryboardRecoveryChapterId");
        expect(source).not.toContain("chapterTaskResultAlreadyApplied");
        expect(source).not.toContain("shot.updatedAt");
        expect(source).not.toMatch(/storeGeneratedStoryboard\([^;]*detail\.project\.revision/);
        expect(source).toContain("error.reason === \"project_unit_shots_changed\"");
        expect(source).toContain("error.reason === \"project_revision_conflict\"");
        expect(source).not.toContain('error.reason === "conflict"');
        expect(source).not.toContain("本章分镜已发生变化，请刷新后重新确认");
        expect(source).not.toContain("项目已被其他操作更新，请重新加载后再保存");
        expect(source).not.toContain("刷新前生成的分镜还在");
    });
});

function task(overrides: Partial<GenerationTask>): GenerationTask {
    return {
        id: "task-1",
        type: "text",
        status: "running",
        prompt: "",
        attempts: 1,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        ...overrides,
    };
}
