import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/native-face-ui");
const outputDir = join(rootDir, "output/playwright/native-face");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/eggfans-native-face.html") } } });
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (pathname === "/") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(await readFile(join(fixtureDir, "test/fixtures/eggfans-native-face.html")));
            return;
        }
        const filePath = join(fixtureDir, pathname.replace(/^\/+/, ""));
        response.setHeader("Content-Type", pathname.endsWith(".js") ? "application/javascript" : pathname.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(filePath));
    } catch {
        response.statusCode = 404;
        response.end("not found");
    }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
const errors = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== baseURL) return route.abort();
        if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: {}, msg: "ok" }) });
        return route.continue();
    });
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.nativeFaceHarness));
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    const toggle = page.getByRole("switch", { name: "过人脸", exact: true });
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await toggle.click();
    await page.waitForFunction(() => window.nativeFaceHarness.node().metadata.nativeFace === "true" && window.nativeFaceHarness.config().videoNativeFace === "true");
    assert.equal((await page.evaluate(() => window.nativeFaceHarness.request())).face, true);
    await page.reload();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await page.screenshot({ path: join(outputDir, "enabled-dark.png") });
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await page.screenshot({ path: join(outputDir, "enabled-light.png") });
    await page.getByRole("button", { name: "D 模型", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.isDisabled(), false);
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    assert.equal((await page.evaluate(() => window.nativeFaceHarness.request())).face, true);
    assert.equal(await page.evaluate(() => window.nativeFaceHarness.config().videoNativeFace), "true");
    assert.equal(await page.evaluate(() => window.nativeFaceHarness.node().metadata.nativeFace), "true");
    await toggle.click();
    await page.waitForFunction(() => window.nativeFaceHarness.node().metadata.nativeFace === "false" && window.nativeFaceHarness.config().videoNativeFace === "false");
    await page.reload();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.isDisabled(), false);
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    assert.equal((await page.evaluate(() => window.nativeFaceHarness.request())).face, false);
    await toggle.click();
    await page.waitForFunction(() => window.nativeFaceHarness.node().metadata.nativeFace === "true" && window.nativeFaceHarness.config().videoNativeFace === "true");
    await page.screenshot({ path: join(outputDir, "enabled-D-light.png") });
    await page.getByRole("button", { name: "C 模型", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.isDisabled(), false);
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await toggle.click();
    await page.waitForFunction(() => window.nativeFaceHarness.node().metadata.nativeFace === "false" && window.nativeFaceHarness.config().videoNativeFace === "false");
    await page.reload();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await page.getByRole("button", { name: "其他渠道", exact: true }).click();
    await page.getByRole("button", { name: /^高级设置：/ }).click();
    assert.equal(await toggle.count(), 0);
    assert.equal(Object.hasOwn(await page.evaluate(() => window.nativeFaceHarness.request()), "videoNativeFace"), false);
    assert.equal(Object.hasOwn(await page.evaluate(() => window.nativeFaceHarness.request()), "face"), false);
    assert.deepEqual(errors, []);
    console.log("PASS: SD2 D toggle is enabled, switches both ways and persists after reload; C preserves preference; light/dark; other channels isolated; no remote generation.");
} catch (error) {
    console.error(JSON.stringify({ browserErrors: errors, snapshot: await page?.locator("body").ariaSnapshot() }));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
