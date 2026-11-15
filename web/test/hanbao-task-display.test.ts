import { expect, test } from "bun:test";
import { generationTaskShowsProgress, generationTaskStageLabel } from "../src/lib/generation-task-display";

test("Hanbao shows actual stages without inventing an upstream percentage", () => {
    for (const stage of ["上游排队中（查询于 21:30:00）", "上游生成中（查询于 21:30:00）", "已提交，正在查询上游状态（发起于 21:30:00）", "查询暂不可用，稍后继续查询原任务", "正在取回生成结果"]) {
        const task = { status: "running" as const, stage, model: "hanbao::seedance_v2.0" };
        expect(generationTaskStageLabel(task)).toBe(stage);
        expect(generationTaskShowsProgress(task)).toBe(false);
        expect(generationTaskShowsProgress({ ...task, model: "remote::seedance_v2.0" })).toBe(true);
    }
});
