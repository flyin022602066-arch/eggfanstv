import { expect, test } from "bun:test";
import { explainGenerationError } from "../src/lib/generation-error";
import { canvasTaskFailureMetadata } from "../src/pages/canvas/canvas-generation-failure";
import type { GenerationTask } from "../src/services/api/task-center";

test("unsubmitted connection errors retain phase and actionable instructions", () => {
    const message = "视频接口连接超时（TLS 握手），请求尚未发送。请检查渠道地址、网络或代理后重试。";
    const failure = explainGenerationError(message);
    expect(failure.message).toBe(message);
    expect(failure.category).toBe("network");
    expect(failure.uncertain).toBe(false);
});

test("unacknowledged submissions retain uncertainty without claiming generation", () => {
    const message = "视频提交未确认（等待响应超时），尚未取得上游任务 ID。请先核对渠道后台记录，再决定是否重新提交。";
    const failure = explainGenerationError(message);
    expect(failure.message).toBe(message);
    expect(failure.category).toBe("submission_uncertain");
    expect(failure.uncertain).toBe(true);
    expect(failure.blockAutomaticRetry).toBe(true);
});

test("canvas failed task retains the connection phase alongside its error code", () => {
    const message = "视频接口连接失败（TCP 连接），请求尚未发送。请检查渠道地址、网络或代理后重试。";
    const task = { id: "task-video-connection", status: "failed", errorCode: "network", error: message } as GenerationTask;
    const metadata = canvasTaskFailureMetadata(task);
    expect(metadata.errorDetails).toBe(message);
    expect(metadata.generationErrorCode).toBe("network");
});

test("structured submission uncertainty retains its specific waiting phase", () => {
    const message = "视频提交未确认（等待响应超时），尚未取得上游任务 ID。请先核对渠道后台记录，再决定是否重新提交。";
    const failure = explainGenerationError({ code: "submission_uncertain", message });
    expect(failure.message).toBe(message);
    expect(failure.uncertain).toBe(true);
});

test("transport wording cannot override an authoritative authentication error", () => {
    const message = "视频接口连接失败（TCP 连接），请求尚未发送。请检查渠道地址、网络或代理后重试。";
    expect(explainGenerationError({ code: "invalid_api_key", message }).category).toBe("auth");
});
