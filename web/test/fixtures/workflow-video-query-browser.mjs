import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("queryCase", "true");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage();
    const errors = [], queries = [], unexpectedWrites = [];
    let recovered = false;
    let disconnectAfterRecovery = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin) return route.abort();
        if (request.method() !== "GET") {
            if (request.method() === "POST" && /^\/api\/tasks\/shot-[abc]-latest\/query-provider$/.test(target.pathname)) {
                queries.push(target.pathname);
                if (target.pathname.includes("shot-a-")) return route.fulfill({ status: 400, json: { code: 400, msg: "本地未记录上游任务 ID，历史提交记录中也没有可恢复的回执；无法查询原任务，不会重新提交生成。" } });
                const failed = target.pathname.includes("shot-c-");
                if (!failed) await new Promise((resolve) => setTimeout(resolve, 4500));
                if (!failed) recovered = true;
                if (!failed && disconnectAfterRecovery) return route.fulfill({ status: 503, json: { code: 503, msg: "查询响应中断，请刷新原任务状态" } });
                return route.fulfill({ json: { code: 0, data: { recovered: !failed, providerStatus: failed ? "failed" : "succeeded", task: { id: failed ? "shot-c-latest" : "shot-b-latest", status: failed ? "failed" : "succeeded", error: failed ? "上游审核未通过" : "" } }, msg: "" } });
            }
            unexpectedWrites.push(request.method() + " " + target.pathname);
            return route.abort();
        }
        if (target.pathname.endsWith("/workspace")) return route.fulfill({ json: { code: 0, data: {
            tasks: ["a", "b", "c"].map((shot) => ({ id: `shot-${shot}-latest`, projectId: "preview-project", type: "canvas_video", status: recovered && shot === "b" ? "succeeded" : "failed", prompt: "", attempts: 1, providerRequestId: shot === "a" ? "" : `api-shot-${shot}-latest`, error: recovered && shot === "b" ? "" : "提交结果未确认", createdAt: "2026-11-01T01:00:00Z", updatedAt: "2026-11-01T01:00:00Z", clientContext: { shotId: `shot-${shot}`, artifactType: "video" } })),
            shotArtifacts: recovered ? [{ id: "recovered-artifact", projectId: "preview-project", unitId: "preview-chapter", shotId: "shot-b", taskId: "shot-b-latest", type: "video", resourceId: "recovered-video", version: 1, status: "ready", selected: true, metadataJson: "{}", createdAt: "2026-11-01T01:00:00Z", updatedAt: "2026-11-01T01:00:00Z" }] : [],
        }, msg: "" } });
        if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], tasks: [], total: 0 }, msg: "" } });
        return route.continue();
    });
    await page.goto(url.toString());
    const panel = page.locator(".workflow-preview-panel");
    const query = panel.getByRole("button", { name: "重新查询", exact: true });
    await query.waitFor();
    await panel.getByText("shot-a-latest", { exact: true }).waitFor();
    await query.click();
    await panel.getByText("本地未记录上游任务 ID，历史提交记录中也没有可恢复的回执；无法查询原任务，不会重新提交生成。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "shot-b", exact: true }).click();
    await panel.getByText("api-shot-b-latest", { exact: true }).waitFor();
    assert.ok(!(await panel.innerText()).includes("历史提交记录中也没有可恢复的回执"), "query errors must not leak to another shot");
    await query.click();
    await page.getByText("已取回视频并保存到原镜头", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "下载视频", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector(".workflow-preview-actions button:last-child")?.disabled);
    assert.equal(await query.count(), 0, "recovered task must no longer display failed-task recovery");
    await page.getByRole("button", { name: "shot-c", exact: true }).click();
    await query.click();
    await page.getByText("上游审核未通过", { exact: true }).waitFor();
    assert.equal(await page.getByText("上游仍在生成，已恢复原任务自动查询", { exact: true }).count(), 0, "confirmed upstream failure must not claim pending generation");
    assert.deepEqual(queries, ["/api/tasks/shot-a-latest/query-provider", "/api/tasks/shot-b-latest/query-provider", "/api/tasks/shot-c-latest/query-provider"]);
    disconnectAfterRecovery = true;
    recovered = false;
    await page.reload();
    await page.getByRole("button", { name: "shot-b", exact: true }).click();
    await query.click();
    await page.getByText("查询响应中断，请刷新原任务状态", { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".workflow-preview-actions button:last-child")?.disabled, null, { timeout: 5000 });
    assert.equal(await query.count(), 0, "completed backend recovery must reconcile even when its HTTP response fails");
    assert.equal(queries.at(-1), "/api/tasks/shot-b-latest/query-provider");
    assert.deepEqual(unexpectedWrites, [], "manual query must never create or retry generation");
    assert.deepEqual(errors, []);
    console.log("PASS failed video query: original task only, slow recovery, refreshed video, upstream failure and disconnected response reconciliation");
} finally {
    await browser.close();
}
