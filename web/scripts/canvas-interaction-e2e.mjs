import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(webDir, "../.local/cache/canvas-interaction-e2e");
mkdirSync(outputDir, { recursive: true });
process.env.TMPDIR = outputDir;
process.env.TEMP = outputDir;
process.env.TMP = outputDir;
const chromePath = [process.env.CHROME_BIN, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
const server = await createServer({ configFile: false, appType: "custom", root: webDir, plugins: [react()], resolve: { alias: { "@": resolve(webDir, "src") } }, define: { __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "true" }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
server.middlewares.use("/canvas-test", async (_request, response) => {
    const html = await server.transformIndexHtml("/canvas-test", '<!doctype html><html class="dark"><head><title>Canvas verification</title></head><body style="margin:0"><div id="root"></div><script type="module">import "/src/styles/globals.css";import {mountCanvasInteractionHarness} from "/test/fixtures/canvas-interaction-harness.tsx";mountCanvasInteractionHarness(document.getElementById("root"));</script></body></html>');
    response.setHeader("Content-Type", "text/html");
    response.end(html);
});

async function endpointGap(page) {
    return page.evaluate(() => {
        const canvas = document.querySelector("[data-canvas-leafer-underlay] canvas");
        const layer = canvas.getBoundingClientRect();
        const ratio = canvas.width / layer.width;
        return [...document.querySelectorAll('[data-node-id="source"], [data-node-id="target"]')].map((element) => {
            const node = element.getBoundingClientRect();
            const endpointX = element.dataset.nodeId === "source" ? node.right : node.left;
            const radius = 8;
            const pixels = canvas.getContext("2d").getImageData(Math.round((endpointX - layer.left) * ratio) - radius, Math.round((node.top + node.height / 2 - layer.top) * ratio) - radius, 17, 17).data;
            let gap = Infinity;
            for (let row = 0; row < 17; row++) {
                for (let column = 0; column < 17; column++) {
                    if (pixels[(row * 17 + column) * 4 + 3] > 80) gap = Math.min(gap, Math.hypot(column - radius, row - radius) / ratio);
                }
            }
            return gap;
        });
    });
}

async function expectAligned(page) {
    const gaps = await endpointGap(page);
    assert.equal(gaps.length, 2);
    assert.ok(gaps.every((gap) => gap <= 1.5), `Endpoint pixel gaps: ${gaps.join(", ")}`);
}

let browser;
let apiWrites = 0;
let manualUploads = 0;
const problems = [];
const validURL = "https://o.uguu.se/fixture-image.png";
const initialResource = { id: "fixture-image", type: "image", status: "ready", temporaryImageUrl: validURL, temporaryImageUploadedAt: new Date(Date.now() - 60_000).toISOString(), temporaryImageExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
let resource = initialResource;

try {
    await server.listen();
    const baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, timeout: 30_000, ...(chromePath ? { executablePath: chromePath } : {}) });
    for (const deviceScaleFactor of [1, 1.75]) {
        const context = await browser.newContext({ viewport: { width: 1500, height: 960 }, deviceScaleFactor, permissions: ["clipboard-read", "clipboard-write"] });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on("pageerror", (error) => problems.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== baseURL) return route.abort();
            if (!url.pathname.startsWith("/api/")) return route.continue();
            if (request.method() !== "GET") apiWrites++;
            if (request.method() === "POST" && url.pathname.endsWith("/temporary-image-url")) manualUploads++;
            if (url.pathname.endsWith("/file")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#487a84"/></svg>' });
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: request.method() === "POST" && url.pathname.endsWith("/temporary-image-url") ? { url: validURL } : { resource }, msg: "ok" }) });
        });
        await page.goto(baseURL + "/canvas-test");
        await page.waitForFunction(() => window.canvasHarness);
        console.log(`Checking canvas interactions at DPR ${deviceScaleFactor}`);
        await expectAligned(page);
        await page.evaluate(() => window.canvasHarness.refreshWhileZooming(true));
        await page.mouse.move(600, 500);
        for (const delta of [250, -70, -70, -70, -70, 70, 70, 70, 70]) {
            await page.mouse.wheel(0, delta);
            await page.waitForTimeout(40);
            await expectAligned(page);
        }
        await page.waitForTimeout(200);
        await expectAligned(page);
        await page.evaluate(() => window.canvasHarness.refreshWhileZooming(false));
        await page.getByRole("button", { name: "100%", exact: true }).click();
        const source = page.locator('[data-node-id="source"]');
        const bounds = await source.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        for (let frame = 1; frame <= 10; frame++) {
            await page.mouse.move(bounds.x + bounds.width / 2 + frame * 9, bounds.y + bounds.height / 2 + frame * 4);
            await page.waitForTimeout(20);
            await expectAligned(page);
        }
        await page.mouse.up();
        await page.waitForTimeout(40);
        await expectAligned(page);
        for (const width of [260, 280, 300]) {
            await page.evaluate((nextWidth) => window.canvasHarness.resize(nextWidth, nextWidth / 1.5), width);
            await expectAligned(page);
        }
        await page.evaluate(() => window.canvasHarness.finishResize(300, 200));
        await page.waitForTimeout(40);
        await expectAligned(page);
        await page.mouse.move(1200, 800);
        const movedBounds = await source.boundingBox();
        await page.mouse.move(movedBounds.x + movedBounds.width - 1, movedBounds.y + movedBounds.height / 2);
        await source.locator('[data-canvas-connection-pin="right"]').click({ force: true });
        await page.waitForTimeout(40);
        const before = await page.evaluate(() => window.canvasHarness.renderCount());
        for (let frame = 0; frame < 10; frame++) {
            await page.mouse.move(1150 + frame * 3, 800 + frame * 2);
            await page.waitForTimeout(20);
        }
        const after = await page.evaluate(() => window.canvasHarness.renderCount());
        assert.equal(after, before, "Moving a draft connection through empty space rerendered the canvas");
        await page.keyboard.press("Escape");
        resource = initialResource;
        await page.getByRole("button", { name: "图片信息", exact: true }).click();
        const urlField = page.getByRole("textbox", { name: "Uguu 临时图片 URL" });
        await urlField.waitFor();
        assert.equal(await urlField.inputValue(), validURL);
        await page.keyboard.press("Escape");
        const manualUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/temporary-image-url"));
        await page.getByRole("button", { name: "上传图床", exact: true }).click();
        await manualUploadResponse;
        await urlField.waitFor();
        assert.equal(await urlField.inputValue(), validURL);
        await page.getByRole("button", { name: "复制链接", exact: true }).click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), validURL);
        assert.equal(manualUploads, deviceScaleFactor === 1 ? 1 : 2);
        await page.screenshot({ path: resolve(outputDir, `temporary-url-dpr-${deviceScaleFactor}.png`) });
        resource = { ...initialResource, temporaryImageExpiresAt: new Date(Date.now() - 1000).toISOString() };
        await page.locator('[data-temporary-image-link="expired"]').waitFor({ timeout: 7000 });
        assert.equal(await page.getByRole("button", { name: "复制链接", exact: true }).count(), 0);
        await context.close();
        resource = initialResource;
        console.log(`PASS canvas wheel, drag, resize, draft and temporary URL at DPR ${deviceScaleFactor}`);
    }
    assert.equal(manualUploads, 2);
    assert.equal(apiWrites, manualUploads);
    assert.deepEqual(problems, []);
    console.log("PASS no API writes, external uploads or browser errors");
} finally {
    await browser?.close();
    await server.close();
}
