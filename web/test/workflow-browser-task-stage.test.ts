import { expect, test } from "bun:test";
import { workflowBrowserTaskStage } from "../src/lib/workflow-shot-task";

test("browser task stages distinguish local preparation, uncertainty, generation and delivery", () => {
    for (const [stage, label] of [
        ["浏览器正在准备画布和参考图，尚未提交生成", "准备中"],
        ["等待豆包浏览器环境，保留两个空闲环境", "准备中"],
        ["正在准备豆包浏览器独立环境并提交生成", "准备中"],
        ["提交状态待确认，保留原环境自动核对", "待确认"],
        ["浏览器查询暂时中断，正在核对原任务", "待确认"],
        ["上游正在生成视频，自动查询原任务", "生成中"],
        ["上游已成功，正在下载原视频", "取回中"],
        ["已提交，正在查询上游状态", "查询中"],
        ["已保留浏览器回执，正在核对实际提交进度", "查询中"],
        ["正在连接上游", "核对进度"],
        ["浏览器原任务查询失败，稍后重查", "查询异常"],
    ]) expect(workflowBrowserTaskStage({ status: "running", model: "doubao-browser::seedance_v2.0", stage })).toBe(label);
});

test("browser progress never changes other providers or terminal task labels", () => {
    expect(workflowBrowserTaskStage({ status: "running", model: "nono::video", stage: "正在准备" })).toBeUndefined();
    expect(workflowBrowserTaskStage({ status: "failed", model: "doubao-browser::seedance_v2.0", stage: "正在准备" })).toBeUndefined();
    expect(workflowBrowserTaskStage({ status: "queued", model: "doubao-browser::seedance_v2.0" })).toBe("待提交");
});
