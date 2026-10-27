import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webDir, "../output/playwright/nano-banana");
mkdirSync(output, { recursive: true });
const server = await createServer({ configFile: false, appType: "custom", root: webDir, plugins: [react()], resolve: { alias: { "@": resolve(webDir, "src") } }, define: { __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "true" }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
server.middlewares.use("/nano-test", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(await server.transformIndexHtml("/nano-test", '<!doctype html><html><body><div id="root"></div><script type="module">import "/src/styles/globals.css";import "/test/fixtures/nano-banana-harness.tsx";</script></body></html>'));
});
let browser;
const errors = [];
try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === origin && !new URL(route.request().url()).pathname.startsWith("/api/") ? route.continue() : route.abort());
    await page.goto(origin + "/nano-test");
    await page.getByRole("button", { name: /高级设置/ }).click();
    await page.getByRole("button", { name: "4K", exact: true }).click();
    await page.getByRole("button", { name: "1:8", exact: true }).click();
    await page.getByRole("button", { name: "深入", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "深入", exact: true }).getAttribute("aria-pressed"), "true");
    for (const ratio of ["1:4", "4:1", "8:1", "4:5", "5:4"]) assert.equal(await page.getByRole("button", { name: ratio, exact: true }).count(), 1);
    const request = await page.evaluate(() => window.nanoBananaHarness.request());
    assert.equal(request.imageThinkingLevel, "high");
    assert.equal(request.size, "1:8");
    assert.equal(request.quality, "4k");
    await page.screenshot({ path: resolve(output, "image-node-options.png"), fullPage: true });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.getByRole("button", { name: /高级设置/ }).click();
    await page.screenshot({ path: resolve(output, "image-node-options-light.png"), fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: /高级设置/ }).click();
    assert.equal(await page.getByRole("button", { name: "深入", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "1:8", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "4K", exact: true }).getAttribute("aria-pressed"), "true");
    const result = await page.evaluate(() => window.nanoBananaHarness.result());
    assert.equal(result.imageThinkingLevel, "high");
    await page.getByRole("button", { name: "模型默认", exact: true }).click();
    assert.equal((await page.evaluate(() => window.nanoBananaHarness.request())).imageThinkingLevel, undefined);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, settingsEditable: true, reloadedNodeSettingsPreserved: true, outputSettingsPreserved: true, externalRequestsAllowed: false }));
} finally {
    await browser?.close();
    await server.close();
}
