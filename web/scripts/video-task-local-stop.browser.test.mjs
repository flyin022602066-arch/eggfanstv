import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

let browser;
let server;
let serverUrl;
let bundleDirectory;

before(async () => {
    bundleDirectory = mkdtempSync(join(tmpdir(), "eggfans-stop-fixture-"));
    const bundle = join(bundleDirectory, "fixture.js");
    const fixture = fileURLToPath(new URL("../test/fixtures/video-task-local-stop-harness.tsx", import.meta.url));
    execFileSync(process.env.BUN_PATH || "bun", ["build", fixture, "--target=browser", "--outfile", bundle, "--define", "import.meta.env={}", "--define", 'process.env.NODE_ENV="production"'], { cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true });
    const script = readFileSync(bundle);
    server = createServer((request, response) => {
        const javascript = request.url === "/harness.js";
        response.writeHead(200, { "Content-Type": javascript ? "text/javascript" : "text/html" });
        response.end(javascript ? script : '<div id="root"></div><script type="module" src="/harness.js"></script>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}/`;
    const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
});

after(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
});

test("local stop is collapsed, confirms the exact video, and releases regeneration without provider calls", async () => {
    const page = await browser.newPage();
    const requests = [];
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        requests.push(request.method() + " " + new URL(request.url()).pathname);
        if (!request.url().endsWith("/tasks/local-video/stop-local")) return route.abort();
        return route.fulfill({ json: { code: 0, data: { id: "local-video", type: "canvas_video", status: "cancelled", stage: "本地已停止", providerRequestId: "upstream-video", progress: 30, updatedAt: "2026-10-26T00:00:02Z" } } });
    });
    await page.goto(serverUrl);
    await page.getByText("高级任务操作", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "仅本地停止此视频", exact: true }).isVisible(), false);
    await page.getByText("高级任务操作", { exact: true }).click();
    await page.getByRole("button", { name: "仅本地停止此视频", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.match(await page.getByRole("dialog").innerText(), /upstream-video/);
    assert.deepEqual(requests, []);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(requests, []);
    await page.getByRole("button", { name: "仅本地停止此视频", exact: true }).click();
    await page.getByRole("button", { name: "确认本地停止", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#receipt").textContent).status === "cancelled");
    assert.deepEqual(requests, ["POST /api/tasks/local-video/stop-local"]);
    assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).isEnabled(), true);
    assert.equal(await page.locator("html").getAttribute("data-cancelled"), "true");
    assert.equal(await page.locator("html").getAttribute("data-updated"), "true");
    await page.close();
});

test("failed local stop preserves the active task and makes the action retryable", async () => {
    const page = await browser.newPage();
    await page.route("**/api/**", (route) => route.fulfill({ status: 409, json: { code: 409, msg: "任务状态已变化" } }));
    await page.goto(serverUrl);
    await page.getByText("高级任务操作", { exact: true }).click();
    await page.getByRole("button", { name: "仅本地停止此视频", exact: true }).click();
    await page.getByRole("button", { name: "确认本地停止", exact: true }).click();
    await page.getByText("任务状态已变化", { exact: true }).waitFor();
    assert.equal(JSON.parse(await page.locator("#receipt").innerText()).status, "running");
    assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "确认本地停止", exact: true }).isEnabled(), true);
    await page.close();
});

test("images and completed videos do not expose local-stop controls", async () => {
    for (const query of ["?type=canvas_image", "?status=succeeded", "?status=failed", "?status=cancelled"]) {
        const page = await browser.newPage();
        await page.goto(serverUrl + query);
        await page.locator("#receipt").waitFor();
        assert.equal(await page.getByText("高级任务操作", { exact: true }).count(), 0);
        await page.close();
    }
});
