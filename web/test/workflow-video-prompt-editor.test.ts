import { expect, test } from "bun:test";

import { resolveWorkflowVideoSubmissionPrompt } from "../src/pages/projects/detail/workflow-video-prompt";

test("视频提交使用用户编辑后的最终提示词", () => {
    expect(resolveWorkflowVideoSubmissionPrompt("自动整理内容", "用户改写内容")).toBe("用户改写内容");
    expect(resolveWorkflowVideoSubmissionPrompt("自动整理内容", "")).toBe("");
    expect(resolveWorkflowVideoSubmissionPrompt("自动整理内容")).toBe("自动整理内容");
});
