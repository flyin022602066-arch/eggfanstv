import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, extname, sep } from "node:path";
import { build } from "vite";
const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("playwright");
const dist = resolve(root, ".local/cache/asset-workflows-harness-dist");
const output = resolve(root, "output/playwright/asset-workflows");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "skip-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/asset-workflows.html") } } });
const server = createServer(async (req, res) => {
    try {
        const path = resolve(dist, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
        if (!path.startsWith(dist + sep)) throw new Error("invalid path");
        const body = await readFile(path);
        res.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[extname(path)] || "application/octet-stream" });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
let remoteRequests = 0;
const errors = [];
await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: {}, msg: "offline fixture" } });
    if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    remoteRequests += 1;
    return route.abort();
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
const report = { layouts: [], checks: [] };
try {
    await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/asset-workflows.html`);
    await page.getByRole("button", { name: "按工作流导出", exact: true }).waitFor();
    for (const dark of [true, false]) {
        await page.evaluate(value => window.assetHarness.theme(value), dark);
        for (const width of [3840, 1440, 1280, 900, 640]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.waitForTimeout(100);
            const bounds = await page.evaluate(() => {
                const rect = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
                const selectors = [".assets-library-hero .app-page-header", ".assets-header-action-buttons", ".assets-secondary-controls", ".assets-collection-content"];
                return Object.fromEntries(selectors.map(selector => [selector, rect(selector)]));
            });
            assert.ok(bounds[".assets-header-action-buttons"].bottom <= bounds[".assets-secondary-controls"].y + 1, `header actions overlap at ${width}/${dark}`);
            assert.ok(bounds[".assets-secondary-controls"].bottom <= bounds[".assets-collection-content"].y + 1, `filters overlap content at ${width}/${dark}`);
            report.layouts.push({ width, dark, bounds });
            await page.screenshot({ path: resolve(output, `assets-${width}-${dark ? "dark" : "light"}.png`) });
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "按工作流导出", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("status").filter({ hasText: "共 46 个资产" }).waitFor();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出资产包", exact: true }).click();
    const download = await downloadPromise;
    const zipPath = resolve(output, download.suggestedFilename());
    await download.saveAs(zipPath);
    report.checks.push("Exported 46 assets across pagination, including current unsaved text");
    await page.locator(".ant-modal-close").click();
    await page.locator('input[type="file"][accept="application/zip,.zip"]').setInputFiles(zipPath);
    await page.waitForFunction(() => window.assetHarness.state().filter(asset => asset.metadata?.source === "asset-package").length === 46);
    const imported = await page.evaluate(() => window.assetHarness.state().filter(asset => asset.metadata?.source === "asset-package"));
    assert.equal(imported.length, 46);
    assert.ok(imported.every(asset => asset.metadata.workflowId.startsWith("imported-workflow-") && !asset.metadata.canvasId));
    report.checks.push("Import isolated workflow and removed source canvas references");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await page.getByRole("menuitem", { name: "保存文本", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("手动确认保存台词");
    await page.getByLabel("文本内容", { exact: true }).fill("第一行台词\n第二行台词");
    await page.getByRole("dialog").getByRole("button", { name: /^保\s*存$/ }).click();
    await page.waitForFunction(() => window.assetHarness.state().some(asset => asset.title === "手动确认保存台词"));
    const manual = await page.evaluate(() => window.assetHarness.state().find(asset => asset.title === "手动确认保存台词"));
    assert.equal(manual.data.content, "第一行台词\n第二行台词");
    assert.equal(manual.metadata.workflowId, imported[0].metadata.workflowId);
    report.checks.push("Manually confirmed text assigned to the selected workflow");
    const first = await page.evaluate(() => window.assetHarness.saveText("画布第一次手动保存"));
    const second = await page.evaluate(() => window.assetHarness.saveText("画布修改后再次手动保存\n完整正文"));
    assert.equal(first.created, true);
    assert.equal(second.assetId, first.assetId);
    assert.equal(second.created, false);
    await page.reload();
    await page.getByRole("button", { name: "按工作流导出", exact: true }).waitFor();
    const restored = await page.evaluate(() => window.assetHarness.state());
    assert.equal(restored.find(asset => asset.id === first.assetId).data.content, "画布修改后再次手动保存\n完整正文");
    assert.ok(restored.some(asset => asset.id === manual.id));
    assert.equal(restored.filter(asset => asset.metadata?.source === "asset-package").length, 46);
    report.checks.push("Text update reused one asset ID and survived full page reload with imported assets");
    await page.evaluate(() => window.assetHarness.rename());
    await page.getByRole("heading", { name: "改名后的工作流甲", exact: true }).waitFor();
    report.checks.push("Workflow rename updated classification");
    const media = await page.evaluate(() => window.assetHarness.verifyOriginalMediaTransfer());
    assert.equal(media.unchanged, true);
    assert.equal(media.width, 4096);
    assert.equal(media.height, 2160);
    assert.equal(media.audioUnchanged, true);
    await page.reload();
    await page.getByRole("button", { name: "按工作流导出", exact: true }).waitFor();
    const dimensions = await page.evaluate(id => window.assetHarness.imageDimensions(id), media.imageId);
    assert.equal(dimensions.width, 4096);
    assert.equal(dimensions.height, 2160);
    report.checks.push("Original 4096x2160 PNG and audio bytes survived default ZIP transfer, local storage and reload");
    assert.deepEqual(errors, []);
    assert.equal(remoteRequests, 0);
    report.remoteRequests = remoteRequests;
    report.pageErrors = errors;
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.checks));
} catch (error) {
    await page.screenshot({ path: resolve(output, "failure.png") });
    console.error("Page errors", errors, "body", (await page.locator("body").innerText()).slice(0, 4000));
    throw error;
} finally { await browser.close(); await new Promise(done => server.close(done)); }
