import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { GenerationFailureNotice } from "../src/components/generation/generation-failure-notice";
import { explainGenerationError, type GenerationFailureContext } from "../src/lib/generation-error";

const upstreamContext: GenerationFailureContext = {
    taskId: "failed-video-task",
    model: "sd-2.5-j2-V2",
    stage: "submission_unknown",
    failureDiagnostics: {
        source: "upstream_http",
        summary: "无可用渠道，请联系站长",
        httpStatus: 503,
        providerCode: "model_not_found",
        requestId: "provider-request-123",
        requests: [{ operation: "submit", method: "POST", dispatched: true, outcome: "http_error", httpStatus: 503, providerCode: "model_not_found", summary: "无可用渠道，请联系站长", startedAt: "2026-10-25T19:55:16+08:00", durationMs: 69 }],
    },
};

test("failure notice displays upstream response and request evidence without copying", () => {
    const explanation = explainGenerationError("提交结果尚未确认", upstreamContext);
    const html = renderToStaticMarkup(<GenerationFailureNotice explanation={explanation} context={upstreamContext} />);
    expect(html).toContain("失败日志");
    expect(html).toContain("无可用渠道，请联系站长");
    expect(html).toContain("上游 HTTP 响应");
    expect(html).toContain("HTTP 状态：503");
    expect(html).toContain("model_not_found");
    expect(html).toContain("已发起=是");
    expect(html).toContain("provider-request-123");
    expect(html).not.toMatch(/<details[^>]*open=/);
});

test("local validation reason is visible and is not attributed to the provider", () => {
    const context: GenerationFailureContext = { failureDiagnostics: { source: "local_validation", summary: "请先绑定当前镜头的场景图片", stage: "生成提交前" } };
    const html = renderToStaticMarkup(<GenerationFailureNotice explanation={explainGenerationError("参数校验失败")} context={context} />);
    expect(html).toContain("本地参数校验");
    expect(html).toContain("请先绑定当前镜头的场景图片");
    expect(html).toContain("生成提交前");
    expect(html).not.toContain("上游 HTTP 响应");
});

test("compact canvas failures provide a collapsed scrollable log without exposing secrets", () => {
    const context: GenerationFailureContext = { failureDiagnostics: { source: "upstream_response", summary: "bad reference https://example.test/private.png?token=private-token Authorization: Bearer PRIVATE_CREDENTIAL" } };
    const html = renderToStaticMarkup(<GenerationFailureNotice compact explanation={explainGenerationError("生成失败")} context={context} />);
    expect(html).toContain("失败日志");
    expect(html).toContain("data-canvas-wheel-scroll");
    expect(html).not.toMatch(/<details[^>]*open=/);
    expect(html).not.toContain("private-token");
    expect(html).not.toContain("PRIVATE_CREDENTIAL");
});

test("storyboard displays failed task diagnostics and pre-submit local errors", () => {
    const source = readFileSync(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("failureDiagnostics: shotTask.failureDiagnostics");
    expect(source.includes("\"local_validation\"")).toBe(true);
    expect(source).toContain("<GenerationFailureNotice");
    const previewStart = source.indexOf('<aside className="workflow-preview-panel"');
    const editor = source.slice(0, previewStart);
    const preview = source.slice(previewStart, source.indexOf('</aside>', previewStart));
    expect(editor).not.toContain("<GenerationFailureNotice");
    expect(preview).toContain("<GenerationFailureNotice");
    expect(preview.indexOf("<GenerationFailureNotice")).toBeGreaterThan(preview.indexOf("<LatestPreview"));
});
