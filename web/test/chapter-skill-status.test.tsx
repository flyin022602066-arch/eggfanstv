import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChapterSkillStatusReport, chapterSkillReportFromTask, latestChapterStoryboardTask } from "../src/pages/projects/detail/chapter-skill-status";
import type { GenerationTask } from "../src/services/api/task-center";

const task = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
    id: "task-1", projectId: "project-1", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1,
    createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z",
    clientContext: { chapterId: "chapter-1", chapterOperation: "storyboard" }, ...overrides,
});
const report = [
    { skillId: "camera", skillName: "摄影机位", version: "1.2", status: "loaded" as const, files: ["SKILL.md"], truncated: true },
    { skillId: "lighting", skillName: "电影光影", version: "2.0", status: "failed" as const, files: [], reason: "file_read_failed" as const },
];

test("saved task metadata restores named skill outcomes without using current selections", () => {
    expect(chapterSkillReportFromTask(task({ inputJson: JSON.stringify({ metadata: { skillLoadReport: report } }) }))).toEqual(report);
    expect(chapterSkillReportFromTask(task())).toBeNull();
    expect(chapterSkillReportFromTask(task({ inputJson: JSON.stringify({ metadata: { skillIds: ["camera"] } }) }))).toBeNull();
    expect(chapterSkillReportFromTask(task({ inputJson: JSON.stringify({ metadata: { skillLoadReport: [] } }) }))).toEqual([]);
    expect(chapterSkillReportFromTask(task({ inputJson: JSON.stringify({ metadata: { skillLoadReport: [{ skillId: "camera", status: "loaded" }] } }) }))).toBeNull();
});

test("an older task updated later cannot replace the newest chapter attempt", () => {
    const latest = task({ id: "latest", status: "failed" });
    const older = task({ id: "old", createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" });
    const other = task({ id: "other", clientContext: { chapterId: "chapter-2", chapterOperation: "storyboard" } });
    expect(latestChapterStoryboardTask([other, older, latest], "chapter-1")?.id).toBe("latest");
});

test("result report lists each failure and distinguishes loading from submission", () => {
    const html = renderToStaticMarkup(<ChapterSkillStatusReport report={report} blocked />);
    for (const label of ["摄影机位", "电影光影", "加载成功", "加载失败", "文件读取失败", "上下文已截断", "未提交模型"]) expect(html).toContain(label);
    expect(html).not.toContain("应用成功");
    expect(html).toContain("1.2");
    expect(html).toContain("SKILL.md");
    expect(html).toContain("<summary");
    expect(html).toContain("已加载 1 项 · 失败 1 项 · 上下文有截断");
    expect(html).not.toContain(" open=");
});

test("failed generation does not rewrite successful skill loading as failed", () => {
    const html = renderToStaticMarkup(<ChapterSkillStatusReport report={[report[0]!]} task={task({ status: "failed", error: "模型任务失败" })} />);
    expect(html).toContain("已加入拆解请求");
    expect(html).toContain("拆解失败");
    expect(html).toContain("模型任务失败");
    expect(html).toContain("不代表模型已逐条执行");
});

test("a successfully loaded skill cannot hide an incomplete microshot result", () => {
    const completed = task({ inputJson: JSON.stringify({ metadata: { storyboardMode: "continuous_30s", storyboardPromptReview: { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000 }, skillLoadReport: [report[0]] } }), resultJson: JSON.stringify({ text: JSON.stringify({ rows: [{ durationSeconds: 30, videoMotionPrompt: "整体设定：教室。镜头1：中景。起幅：两人对谈。→ 落幅：她收回手。镜头2：近景。起幅：对手注视她。→ 落幅：他低头。结尾约束：光线一致。" }] }) }) });
    const html = renderToStaticMarkup(<ChapterSkillStatusReport report={[report[0]!]} task={completed} />);
    expect(html).toContain("脚本待修订");
    expect(html).toContain("只有 2 个内部镜头");
    expect(html).toContain("镜头与表演正文");
    expect(html).toContain("已加入拆解请求");
});

test("legacy records remain unknown while an empty report explicitly means no skills", () => {
    expect(renderToStaticMarkup(<ChapterSkillStatusReport report={null} task={task()} />)).toContain("未记录技能调用明细");
    expect(renderToStaticMarkup(<ChapterSkillStatusReport report={[]} task={task()} />)).toContain("本次未选择技能");
});

test("a new attempt does not show an older skill report while it prepares or fails before skill loading", () => {
    const preparing = renderToStaticMarkup(<ChapterSkillStatusReport report={null} preparing />);
    expect(preparing).toContain("本次拆解准备中");
    expect(preparing).toContain("正在准备本次章节与技能上下文");
    expect(preparing).not.toContain("本次未选择技能");
    const failed = renderToStaticMarkup(<ChapterSkillStatusReport report={null} submissionFailed />);
    expect(failed).toContain("任务准备失败 · 技能未读取");
    expect(failed).toContain("在读取技能之前失败");
});
