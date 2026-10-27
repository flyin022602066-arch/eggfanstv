import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/canvas-local-image-upload-ui");
const outputDir = join(rootDir, "output/playwright/canvas-local-image-upload");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/canvas-local-image-upload.html") } } });
const resources = new Map();
const assets = [];
const uploads = [];
const unexpectedAPI = [];
let failUpload = false;
const server = createServer(async (request, response) => {
    const send = (data, status = 200) => {
        response.statusCode = status;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: status === 200 ? 0 : status, data, msg: status === 200 ? "ok" : "测试上传失败", reason: status === 200 ? undefined : "invalid_resource" }));
    };
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (request.method === "POST" && pathname === "/api/resources") {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers["content-type"] } }).formData();
            const file = form.get("file");
            uploads.push({ name: file.name, width: Number(form.get("width")), height: Number(form.get("height")) });
            await new Promise((done) => setTimeout(done, 600));
            if (failUpload) return send({}, 400);
            const id = `local-upload-${uploads.length}`;
            const bytes = Buffer.from(await file.arrayBuffer());
            resources.set(id, bytes);
            return send({ resource: { id, mimeType: "image/png", size: bytes.length, width: Number(form.get("width")), height: Number(form.get("height")), status: "ready" } });
        }
        if (request.method === "PUT" && pathname.startsWith("/api/assets/")) {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            assets.push(JSON.parse(Buffer.concat(chunks).toString()).asset);
            return send({});
        }
        const resource = pathname.match(/^\/api\/resources\/([^/]+)(?:\/(file))?$/);
        if (resource) {
            if (!resources.has(resource[1])) return send({}, 404);
            if (resource[2]) {
                response.setHeader("Content-Type", "image/png");
                return response.end(resources.get(resource[1]));
            }
            return send({ resource: { id: resource[1], mimeType: "image/png", status: "ready" } });
        }
        if (pathname.startsWith("/api/")) {
            unexpectedAPI.push(`${request.method} ${pathname}`);
            return send({});
        }
        const target = pathname === "/" ? "test/fixtures/canvas-local-image-upload.html" : pathname.replace(/^\/+/, "");
        response.setHeader("Content-Type", target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".js") ? "application/javascript" : target.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch (error) {
        response.statusCode = 500;
        response.end(error.message);
    }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
const errors = [];
const remoteRequests = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== baseURL) {
            remoteRequests.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.localImageHarness));
    const node = page.locator('[data-node-id="upload-target"]');
    const toolbar = page.getByRole("toolbar", { name: "节点快捷工具" });
    assert.equal(await node.getByRole("button", { name: "上传本地图片", exact: true }).count(), 1);
    await toolbar.getByRole("button", { name: "上传本地图片", exact: true }).waitFor();
    await page.screenshot({ path: join(outputDir, "empty-node.png") });
    await page.evaluate(() => window.localImageHarness.readOnly(true));
    await page.waitForFunction(() => !document.querySelector('[data-node-id="upload-target"]').textContent.includes("上传本地图片"));
    assert.ok(await toolbar.getByRole("button", { name: "上传本地图片", exact: true }).isDisabled());
    await page.evaluate(() => { window.localImageHarness.readOnly(false); window.localImageHarness.locked(true); });
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata.locked);
    assert.equal(await node.getByRole("button", { name: "上传本地图片", exact: true }).count(), 0);
    assert.ok(await toolbar.getByRole("button", { name: "上传本地图片", exact: true }).isDisabled());
    await page.evaluate(() => window.localImageHarness.locked(false));
    const makeFile = async (name, width, height) => ({ name, mimeType: "image/png", buffer: Buffer.from(await page.evaluate(({ width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const drawing = canvas.getContext("2d");
        drawing.fillStyle = "#687dad";
        drawing.fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png").split(",")[1];
    }, { width, height }), "base64") });
    const landscape = await makeFile("本地参考图片.png", 900, 600);
    const portrait = await makeFile("替换肖像.png", 480, 800);
    const chooseFile = async (button, file) => {
        const chooserPromise = page.waitForEvent("filechooser");
        await button.click();
        const chooser = await chooserPromise;
        assert.equal(chooser.isMultiple(), false);
        assert.equal(await page.locator('input[type="file"]').getAttribute("accept"), "image/*");
        await chooser.setFiles(file);
    };
    await chooseFile(node.getByRole("button", { name: "上传本地图片", exact: true }), landscape);
    await node.getByText("正在上传图片", { exact: true }).waitFor();
    assert.ok(await toolbar.getByRole("button", { name: "上传本地图片", exact: true }).isDisabled());
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-upload-1" && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    const first = await page.evaluate(() => ({ node: window.localImageHarness.nodes()[0], count: window.localImageHarness.nodes().length, wires: window.localImageHarness.connections(), drags: window.localImageHarness.dragCount() }));
    assert.equal(first.count, 1);
    assert.equal(first.node.id, "upload-target");
    assert.equal(first.node.title, "我的参考图片");
    assert.deepEqual(first.node.position, { x: 100, y: 200 });
    assert.ok(Math.abs(first.node.width / first.node.height - 1.5) < 0.001);
    assert.equal(first.drags, 0);
    assert.equal(first.wires[0].fromNodeId, first.node.id);
    await page.waitForFunction(() => document.querySelector('[data-node-id="upload-target"] img')?.naturalWidth === 900);
    await page.reload();
    await page.waitForFunction(() => window.localImageHarness?.nodes()[0].metadata?.storageKey === "resource:local-upload-1");
    await page.waitForFunction(() => document.querySelector('[data-node-id="upload-target"] img')?.naturalWidth === 900);
    await page.evaluate(() => { window.localImageHarness.mode("simple"); window.localImageHarness.theme("dark"); });
    await chooseFile(toolbar.getByRole("button", { name: "替换图片", exact: true }), portrait);
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-upload-2" && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    const replaced = await page.evaluate(() => window.localImageHarness.nodes()[0]);
    assert.ok(Math.abs(replaced.width / replaced.height - 0.6) < 0.001);
    assert.deepEqual(replaced.position, first.node.position);
    await page.waitForFunction(() => document.querySelector('[data-node-id="upload-target"] img')?.naturalWidth === 480);
    failUpload = true;
    await chooseFile(toolbar.getByRole("button", { name: "替换图片", exact: true }), landscape);
    await page.getByText("测试上传失败", { exact: true }).waitFor({ state: "attached" });
    await page.waitForFunction(() => !window.localImageHarness.nodes()[0].metadata?.fileUpload);
    assert.deepEqual(await page.evaluate(() => window.localImageHarness.nodes()[0]), replaced);
    failUpload = false;
    await chooseFile(toolbar.getByRole("button", { name: "替换图片", exact: true }), landscape);
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-upload-4" && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    await page.evaluate(() => window.localImageHarness.loading(true));
    assert.ok(await toolbar.getByRole("button", { name: "替换图片", exact: true }).isDisabled());
    await page.evaluate(() => window.localImageHarness.loading(false));
    await page.screenshot({ path: join(outputDir, "uploaded-node.png") });
    assert.equal(assets.length, 3);
    assert.equal(uploads[0].name, landscape.name);
    assert.equal(uploads[0].width, 900);
    assert.equal(uploads[1].height, 800);
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    assert.deepEqual(unexpectedAPI, []);
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: true, uploads: uploads.length, savedAssets: assets.length, preservedNode: true, preservedConnections: true, sameFileRetry: true, reloadPreview: true, failureRestoresOriginal: true, readOnlyAndLockedBlocked: true, generationBlocked: true, remoteRequests: 0, screenshots: ["empty-node.png", "uploaded-node.png"] }, null, 2));
    console.log("PASS: local image picker, replacement, persistence, failure recovery and channel isolation");
} catch (error) {
    if (page) await page.screenshot({ path: join(outputDir, "failure.png") }).catch(() => {});
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: false, error: error.stack, errors, remoteRequests, unexpectedAPI }, null, 2));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
