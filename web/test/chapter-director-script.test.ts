import { expect, test } from "bun:test";
import { storyboardRowsFromTask } from "../src/lib/canvas/canvas-project-domain";
import { reviewChapterStoryboardPrompt } from "../src/lib/chapter-storyboard-mode";
import { chapterStoryboardFromGenerationTask } from "../src/pages/projects/detail/project-chapter-ai";
import { storyboardRowsToProjectShots } from "../src/pages/projects/detail/chapter-storyboard-production";
import { buildWorkflowVideoPrompt } from "../src/pages/projects/detail/workflow-video-prompt";
import type { GenerationTask } from "../src/services/api/task-center";
import { reviewChapterDirectorTiming } from "../src/lib/chapter-director-script";

const directorScript = {
    setting: "旧屋内，林默在左，守卫在右，门在守卫身后；主光来自世界左前方。",
    shots: [
        { durationSeconds: 2, camera: "同侧双人中景，标准视角；随递信轻微前移，停在双手之间。", start: "林默右手持信，守卫看向他的脸。", performance: "林默递出旧信，手臂伸向守卫；守卫垂眼看信，抬起左手承接。", focusAndLight: "保持双手与嘴部可读，颧骨亮面转入有肤质的暗侧。", end: "信停在两人之间，沿接触动作切近。", sound: "林默压低声音、收住句尾说：“拿好。”衣料声随抬手响起。" },
        { durationSeconds: 3, camera: "同侧手部近景，固定机位保留双方袖口。", start: "守卫左手已到信下方。", performance: "守卫夹稳纸边，林默感觉承重转移后才松开右手，交接不重演。", focusAndLight: "焦点跟到接触的指尖，纸上高光受控，接触阴影连续。", end: "旧信由守卫左手拿稳，林默右手收回。", sound: "上一句尾气自然结束，纸张摩擦声与动作同步，无新增对白。" },
    ],
    ending: "旧信归守卫，双方仍在原位；眼线、主光与手别连续。",
};

function taskFor(row: object, policy?: object): GenerationTask {
    return {
        id: "offline-director", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "",
        resultJson: JSON.stringify({ mode: "text", text: JSON.stringify({ rows: [{ durationSeconds: 30, characters: [], assetBindings: [], ...row }] }) }),
        inputJson: JSON.stringify({ metadata: { storyboardMode: "continuous_30s", storyboardPromptReview: policy } }),
    };
}

test("structured first-response shots reach the saved revision and final video prompt without losing any authored detail", () => {
    const task = taskFor({ directorScript, dialogue: "林默：“拿好。”" });
    const row = storyboardRowsFromTask(task).rows[0]!;
    expect(row.videoMotionPrompt).toStartWith("整体设定：旧屋内");
    expect(row.videoMotionPrompt).toContain("镜头1：同侧双人中景");
    expect(row.videoMotionPrompt).toContain("镜头2：同侧手部近景");
    expect(row.videoMotionPrompt).not.toMatch(/durationSeconds|[23]秒/u);
    const shot = storyboardRowsToProjectShots([row])[0]!;
    const final = buildWorkflowVideoPrompt(shot.revision, { assetReferences: [], mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [] }).prompt;
    for (const authored of [directorScript.setting, directorScript.ending, ...directorScript.shots.flatMap(({ durationSeconds: _, ...fields }) => Object.values(fields))]) {
        expect(final).toContain(authored);
        expect(final.split(authored)).toHaveLength(2);
    }
    expect(row.timeBeats).toBe("镜头1：信停在两人之间，沿接触动作切近。\n镜头2：旧信由守卫左手拿稳，林默右手收回。");
    expect(shot.revision.videoPrompt).toContain(row.videoMotionPrompt);
});

test("review reads actual per-shot durations and reports overlong shots and incorrect totals even with enough shot labels", () => {
    const shots = Array.from({ length: 10 }, (_, index) => ({ ...directorScript.shots[index % 2]!, durationSeconds: index === 0 ? 5 : 3 }));
    const row = storyboardRowsFromTask(taskFor({ directorScript: { ...directorScript, shots } })).rows[0]!;
    const issues = reviewChapterStoryboardPrompt([row], { maxInternalShotSeconds: 4 });
    expect(issues.join("\n")).toContain("镜头1 时长 5 秒");
    expect(issues.join("\n")).toContain("合计 32 秒");
    expect(row.videoMotionPrompt.match(/镜头\d+：/gu)).toHaveLength(10);
});

test("recovery reports a model that ignored the requested structured format and keeps its original short draft", () => {
    const task = taskFor({ videoMotionPrompt: "整体设定：旧屋。\n镜头1：起幅：持信。→ 落幅：接信。\n结尾约束：同光。" }, { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000, directorFormat: "shots-v1" });
    const result = chapterStoryboardFromGenerationTask(task);
    expect(result.promptReview.join("\n")).toContain("未返回本次要求的逐镜结构");
    expect(result.rows[0]!.videoMotionPrompt).toContain("起幅：持信。→ 落幅：接信。");
    expect(result.rows[0]!.videoMotionPrompt.match(/镜头\d+：/gu)).toHaveLength(1);
});

test("malformed structured fields fail with a precise location instead of overwriting authored text with an empty script", () => {
    const malformed = { ...directorScript, shots: [{ ...directorScript.shots[0], performance: { text: "不能吞掉" } }] };
    expect(() => storyboardRowsFromTask(taskFor({ directorScript: malformed }))).toThrow("第 1 段镜头1的 performance 必须是文本");
});

test("valid fractional quick cuts total thirty seconds while eight long holds still fail the usual one-to-three-second rhythm", () => {
    const schedule = (durations: number[]) => ({ ...directorScript, shots: durations.map((durationSeconds) => ({ ...directorScript.shots[0]!, durationSeconds })) });
    expect(reviewChapterDirectorTiming(schedule([2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3]), 30, 4)).toEqual([]);
    expect(reviewChapterDirectorTiming(schedule([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]), 30, 4)).toEqual([]);
    const slow = reviewChapterDirectorTiming(schedule([3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75]), 30, 4);
    expect(slow).toEqual(["内部镜头未以 1–3 秒为主，需核对快切节奏"]);
});

test("generated section labels do not count as authored detail toward the director-script length", () => {
    const minimal = { setting: "屋内", shots: [{ durationSeconds: 30, camera: "中景", start: "持信", performance: "递信", focusAndLight: "侧光", end: "接信", sound: "纸声" }], ending: "接戏" };
    const row = storyboardRowsFromTask(taskFor({ directorScript: minimal })).rows[0]!;
    expect(row.videoMotionPrompt.length).toBeGreaterThan(50);
    expect(reviewChapterStoryboardPrompt([row], { minDirectorScriptChars: 50 }).join("\n")).toContain("正文仅 16 字符");
});
