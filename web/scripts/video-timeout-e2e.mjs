import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/video-timeout-ui");
const outputDir = join(rootDir, "output/playwright/video-timeout");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/video-timeout.html") } } });
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        const target = pathname === "/" ? "test/fixtures/video-timeout.html" : pathname.replace(/^\/+/, "");
        response.setHeader("Content-Type", target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".js") ? "application/javascript" : target.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch { response.statusCode = 404; response.end("not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
let failed = false;
let disconnected = false;
let progress = 50;
let queries = 0;
let writes = 0;
let submissions = 0;
const errors = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(25_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== baseURL) return route.abort();
        if (url.pathname.startsWith("/api/")) {
            if (request.method() !== "GET") writes += 1;
            let data = {};
            if (url.pathname === "/api/tasks" && request.method() === "POST") {
                submissions += 1;
                assert.equal(request.postDataJSON().type, "canvas_video");
                data = { id: "timeout-fixture", type: "canvas_video", status: "running", progress, stage: "上游生成中", prompt: "离线测试", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            } else if (url.pathname.endsWith("/tasks/timeout-fixture")) {
                queries += 1;
                if (disconnected) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, msg: "离线测试：状态查询暂不可用" }) });
                data = { id: "timeout-fixture", type: "canvas_video", status: failed ? "failed" : "running", progress, stage: failed ? "任务失败" : "上游生成中", prompt: "离线测试", attempts: 1, error: failed ? "离线测试：上游确认失败" : undefined, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
            }
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data, msg: "ok" }) });
        }
        return route.continue();
    });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.timeoutHarness));
    const card = page.getByTestId("video-card");
    await page.evaluate(() => window.timeoutHarness.restoreLegacy());
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.status === "loading" && !window.timeoutHarness.node().metadata.errorDetails);
    assert.equal(await card.getByText("上游生成中", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "生成中", exact: true }).isDisabled(), true);
    assert.equal(writes, 0);
    failed = true;
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskStatus === "failed");
    failed = false;
    await page.reload();
    await page.waitForFunction(() => Boolean(window.timeoutHarness));
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskId === "timeout-fixture");
    assert.equal(submissions, 1);
    disconnected = true;
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskSyncIssue === "sync");
    assert.equal(await card.getByText("任务状态同步中断，正在重新同步", { exact: true }).count(), 1);
    assert.equal(await card.getByText("尚未确认任务失败，请勿重复提交", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "生成中", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.timeoutHarness.node().metadata.errorDetails), undefined);
    await page.screenshot({ path: join(outputDir, "sync-interrupted.png") });
    disconnected = false;
    progress = 72;
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskProgress === 72 && !window.timeoutHarness.node().metadata.taskSyncIssue);
    assert.equal(await card.getByText("上游生成中", { exact: true }).count(), 1);
    assert.equal(submissions, 1);
    failed = true;
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskStatus === "failed");
    assert.equal(await page.getByRole("button", { name: "生成", exact: true }).isEnabled(), true);
    assert.equal(await page.locator("button .animate-spin").count(), 0);
    assert.equal(await card.getByText("上游生成中", { exact: true }).count(), 0);
    failed = false;
    await page.reload();
    await page.waitForFunction(() => Boolean(window.timeoutHarness));
    const startedAt = Date.now();
    await page.clock.setSystemTime(startedAt);
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByRole("button", { name: "生成中", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "生成中", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.timeoutHarness.timeoutMs), 3_600_000);
    await page.clock.setSystemTime(startedAt + 32 * 60 * 1000);
    await page.waitForTimeout(2200);
    assert.equal(await page.evaluate(() => window.timeoutHarness.waitState()), "waiting");
    await page.clock.setSystemTime(startedAt + 59 * 60 * 1000);
    await page.waitForTimeout(2200);
    assert.equal(await page.evaluate(() => window.timeoutHarness.waitState()), "waiting");
    await page.clock.setSystemTime(startedAt + 60 * 60 * 1000 + 1);
    await page.waitForFunction(() => window.timeoutHarness.waitState() === "settled");
    assert.equal(await page.evaluate(() => window.timeoutHarness.node().metadata.status), "loading");
    assert.equal(await page.evaluate(() => window.timeoutHarness.node().metadata.errorDetails), undefined);
    assert.equal(await page.getByRole("button", { name: "生成中", exact: true }).isDisabled(), true);
    failed = true;
    await page.waitForFunction(() => window.timeoutHarness.node().metadata.taskStatus === "failed");
    assert.equal(await page.getByRole("button", { name: "生成", exact: true }).isEnabled(), true);
    assert.equal(await page.locator("button .animate-spin").count(), 0);
    assert.equal(submissions, 2);
    assert.equal(writes, submissions);
    assert.ok(queries >= 3);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(outputDir, "button-recovered.png") });
    console.log("PASS: actual canvas executor/card/button correct a stale error, show sync interruption without false failure, resume progress, wait 60 minutes, and stop the spinner on confirmed failure; exactly two mocked submissions with no duplicate submissions or remote requests.");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: true, submissions, queries, writes, remoteRequests: 0, errors }, null, 2)));
} catch (error) {
    console.error(JSON.stringify({ errors, snapshot: await page?.locator("body").ariaSnapshot() }));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
