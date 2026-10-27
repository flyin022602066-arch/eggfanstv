import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webDir, "../output/playwright/mints-seedance");
mkdirSync(output, { recursive: true });
const server = await createServer({ configFile: false, appType: "custom", root: webDir, plugins: [react()], resolve: { alias: { "@": resolve(webDir, "src") } }, define: { __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "true" }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
server.middlewares.use("/mints-test", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(await server.transformIndexHtml("/mints-test", '<!doctype html><html><body><div id="root"></div><script type="module">import "/src/styles/globals.css";import "/test/fixtures/mints-seedance-harness.tsx";</script></body></html>'));
});
let browser;
const errors = [];
try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        assert.equal(url.pathname, "/api/plugins/catalog");
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: { providers: [{ id: "mints-seedance-video", name: "Mints Seedance", vendor: "Eggfans TV", version: "1.0.0", enabled: true, categories: ["video"], scopes: ["user.custom-channel"], create: "POST /api/v3/contents/generations/tasks", poll: "GET /api/v3/contents/generations/tasks/{task_id}", contentType: "application/json" }] } }) });
    });
    await page.goto(origin + "/mints-test");
    await page.getByText("自动资产绑定", { exact: true }).waitFor();
    await page.getByRole("button", { name: "配置使用" }).click();
    await page.getByRole("tab", { name: "能力与参数" }).click();
    await page.getByLabel("Mints 资产组 ID").fill("verified-group");
    await page.getByLabel("Mints 随机种子").fill("0");
    await page.getByRole("switch", { name: "Mints 固定镜头" }).click();
    await page.getByRole("switch", { name: "Mints 草稿模式" }).click();
    await page.screenshot({ path: resolve(output, "model-options.png"), fullPage: true });
    await page.getByRole("button", { name: /完\s*成/ }).click();
    const input = (await page.evaluate(() => window.mintsHarness.request())).input;
    assert.deepEqual(input.metadata.providerOptions["mints-seedance-video"], { asset_group_id: "verified-group", seed: 0, camera_fixed: true, draft: true });
    assert.equal(input.referenceImages[0].storageKey, "resource:original");
    assert.equal(input.referenceImages[0].url, undefined);
    await page.reload();
    await page.getByRole("button", { name: "配置使用" }).click();
    await page.getByRole("tab", { name: "能力与参数" }).click();
    assert.equal(await page.getByLabel("Mints 资产组 ID").inputValue(), "verified-group");
    assert.equal(await page.getByLabel("Mints 随机种子").inputValue(), "0");
    assert.equal(await page.getByRole("switch", { name: "Mints 固定镜头" }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: /完\s*成/ }).click();
    await page.getByRole("button", { name: "切换主题" }).click();
    await page.screenshot({ path: resolve(output, "video-settings-dark.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, optionsEditable: true, reloadedOptionsPreserved: true, ownedReferencePreserved: true, externalRequestsAllowed: false }));
} finally {
    await browser?.close();
    await server.close();
}
