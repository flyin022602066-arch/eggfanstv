import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webDir, "../.local/cache/volc-asset-library-e2e");
mkdirSync(output, { recursive: true });
const server = await createServer({ configFile: false, appType: "custom", root: webDir, plugins: [react()], resolve: { alias: { "@": resolve(webDir, "src") } }, define: { __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "true" }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
server.middlewares.use("/volc-test", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(await server.transformIndexHtml("/volc-test", '<!doctype html><html><body><div id="root"></div><script type="module">import "/src/styles/globals.css";import {mountVolcLibraryHarness} from "/test/fixtures/volc-asset-library-harness.tsx";mountVolcLibraryHarness(document.getElementById("root"));</script></body></html>'));
});
let browser;
let savedLibrary = { enabled: true, baseUrl: "https://20nbifxd.magine.work/v1", apiKey: "", groupName: "角色组", projectName: "default" };
const record = { id: "binding", resourceId: "mock-resource", name: "已归档角色", uri: "asset://remote-image", assetId: "remote-image", groupId: "group", baseUrl: savedLibrary.baseUrl, imageFile: "binding.png", publicUrl: "https://h.uguu.se/expired.png", mimeType: "image/png", bytes: 100, width: 512, height: 512, createdAt: "2026-10-10T00:00:00Z" };
let revision = 1;
let syncs = 0;
const problems = [];
try {
    await server.listen();
    console.log("Isolated UI fixture server ready");
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    page.on("pageerror", (error) => problems.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let data;
        if (url.pathname === "/api/workspace/model-config") {
            if (request.method() === "PUT") {
                const body = request.postDataJSON();
                savedLibrary = { ...body.config.volcAssetLibrary, apiKey: body.config.volcAssetLibrary.apiKey === "__BEEFTV_REDACTED__" ? savedLibrary.apiKey : body.config.volcAssetLibrary.apiKey };
                revision++;
                data = { saved: true, revision };
            } else data = { config: { channels: [], volcAssetLibrary: { ...savedLibrary, apiKey: savedLibrary.apiKey ? "__BEEFTV_REDACTED__" : "" } }, health: "ready", revision, source: "builtin+local" };
        } else if (url.pathname === "/api/volc-asset-library") data = [record];
        else if (url.pathname === "/api/resources/mock-resource/volc-asset") {
            syncs++;
            assert.equal(request.postDataJSON().name, "已归档角色");
            assert.ok(!request.postData().includes("mock-upload-key"), "Upload key must stay in the backend");
            data = { uri: record.uri, assetId: record.assetId, status: "active" };
        } else if (url.pathname.endsWith("/file")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZEsAAAAASUVORK5CYII=", "base64") });
        else return route.abort();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    });
    await page.goto(origin + "/volc-test");
    console.log("Settings fixture loaded");
    await page.getByLabel("火山资产上传 Key").fill("mock-upload-key");
    await page.getByRole("button", { name: "保存资产库配置", exact: true }).click();
    await page.getByText("火山资产库配置已保存", { exact: true }).waitFor({ state: "attached" });
    assert.equal(savedLibrary.apiKey, "mock-upload-key");
    await page.getByRole("button", { name: "火山本地资产库", exact: true }).click();
    await page.getByLabel("已保存的火山 URI").waitFor();
    assert.equal(await page.getByLabel("已保存的火山 URI").inputValue(), record.uri);
    await page.getByLabel("选择火山本地图片").click();
    await page.getByText("已归档角色", { exact: true }).last().click();
    await page.getByRole("button", { name: "同步选中图片", exact: true }).click();
    await page.getByText("原图和 URI 已一起保存到本地资产库", { exact: true }).waitFor({ state: "attached" });
    assert.equal(syncs, 1);
    const restored = await page.evaluate(() => window.volcHarnessAssets());
    assert.equal(restored.length, 1);
    assert.equal(restored[0].arkAssetId, record.assetId);
    assert.equal(restored[0].metadata.assetUri, record.uri);
    assert.equal(restored[0].data.storageKey, "resource:mock-resource");
    await page.screenshot({ path: resolve(output, "local-library.png"), fullPage: true });
    await page.reload();
    await page.getByLabel("火山资产上传 Key").waitFor();
    assert.equal(await page.getByLabel("火山资产上传 Key").inputValue(), "");
    await page.getByRole("button", { name: "火山本地资产库", exact: true }).click();
    await page.getByLabel("已保存的火山 URI").waitFor();
    assert.equal((await page.evaluate(() => window.volcHarnessAssets())).length, 1);
    assert.equal(savedLibrary.apiKey, "mock-upload-key");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, "mobile-library.png"), fullPage: true });
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    assert.deepEqual(problems, []);
    console.log(JSON.stringify({ ok: true, keyPersistsAfterReload: true, originalAndURIRestored: true, duplicateAssets: false, remoteRequestsBlocked: true, screenshots: output }));
} finally { await browser?.close(); await server.close(); }
