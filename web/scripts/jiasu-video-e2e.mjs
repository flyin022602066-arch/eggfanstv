import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/jiasu-video-ui");
const outputDir = join(rootDir, "output/playwright/jiasu-video");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/jiasu-video.html") } } });
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        const target = pathname === "/" ? "test/fixtures/jiasu-video.html" : pathname.replace(/^\/+/, "");
        response.setHeader("Content-Type", target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".js") ? "application/javascript" : target.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch { response.statusCode = 404; response.end("not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
const errors = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== baseURL) return route.abort();
        if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: {}, msg: "ok" }) });
        return route.continue();
    });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.jiasuHarness));
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    const durationInput = page.getByRole("spinbutton", { name: "视频时长（秒）", exact: true });
    assert.equal(await durationInput.getAttribute("max"), "30");
    await durationInput.fill("30");
    await durationInput.press("Tab");
    await page.waitForFunction(() => window.jiasuHarness.request().videoSeconds === "30");
    await page.getByRole("button", { name: "保持原图", exact: true }).click();
    await page.waitForFunction(() => window.jiasuHarness.node().metadata.jiasuFaceMode === "off" && window.jiasuHarness.config().videoJiasuFaceMode === "off");
    assert.equal((await page.evaluate(() => window.jiasuHarness.request())).videoJiasuFaceMode, "off");
    assert.equal(await page.getByRole("switch", { name: "过人脸", exact: true }).count(), 0);
    await page.reload();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await page.getByRole("button", { name: "保持原图", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await durationInput.inputValue(), "30");
    assert.equal((await page.evaluate(() => window.jiasuHarness.request())).videoSeconds, "30");
    await page.screenshot({ path: join(outputDir, "dola-dark.png") });
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    await page.getByRole("button", { name: "轻度处理", exact: true }).click();
    await page.waitForFunction(() => window.jiasuHarness.node().metadata.jiasuFaceMode === "light");
    await page.screenshot({ path: join(outputDir, "dola-light.png") });
    await page.getByRole("button", { name: "J3 模型", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await durationInput.getAttribute("max"), "30");
    assert.equal(await durationInput.getAttribute("min"), "4");
    await page.getByRole("button", { name: "1080P", exact: true }).click();
    await page.waitForFunction(() => window.jiasuHarness.request().model === "sd-2.5-J3-doubao" && /^1080p?$/i.test(window.jiasuHarness.request().vquality));
    assert.equal((await page.evaluate(() => window.jiasuHarness.request())).videoSeconds, "30");
    await page.screenshot({ path: join(outputDir, "j3-1080p.png") });
    await page.getByRole("button", { name: "H3 模型", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    const h3Request = await page.evaluate(() => window.jiasuHarness.request());
    assert.equal(h3Request.model, "minimax-h3");
    assert.equal(h3Request.videoSeconds, "15");
    assert.equal(await page.getByRole("button", { name: "2K", exact: true }).count(), 1);
    await page.screenshot({ path: join(outputDir, "h3-light.png") });
    await page.getByRole("button", { name: "SD2 渠道", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await page.getByRole("button", { name: "保持原图", exact: true }).count(), 0);
    assert.equal(Object.hasOwn(await page.evaluate(() => window.jiasuHarness.request()), "videoJiasuFaceMode"), false);
    assert.equal(await page.getByRole("switch", { name: "过人脸", exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    console.log("PASS: Jiasu node options persist after reload; J3 30 seconds and 1080p; light/dark UI; H3 fixed output; SD2 controls and parameters isolated; no remote generation.");
} catch (error) {
    console.error(JSON.stringify({ browserErrors: errors, snapshot: await page?.locator("body").ariaSnapshot() }));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
