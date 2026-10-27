import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/canvas-local-video-upload-ui");
const outputDir = join(rootDir, "output/playwright/canvas-local-video-upload");
await mkdir(outputDir, { recursive: true });
const videoPath = join(outputDir, "synthetic-reference.mp4");
const encoded = spawnSync(join(rootDir, ".local/tools/ffmpeg/ffmpeg.exe"), ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=10", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath], { encoding: "utf8", windowsHide: true });
assert.equal(encoded.status, 0, encoded.stderr);
const videoBytes = await readFile(videoPath);
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/canvas-local-image-upload.html") } } });
const resources = new Map();
const assets = [];
const uploads = [];
const posterUploads = [];
const unexpectedAPI = [];
let failUpload = false;
const server = createServer(async (request, response) => {
    const send = (data, status = 200) => {
        response.statusCode = status;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: status === 200 ? 0 : status, data, msg: status === 200 ? "ok" : "测试视频上传失败", reason: status === 200 ? undefined : "invalid_resource" }));
    };
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (request.method === "POST" && pathname === "/api/resources") {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers["content-type"] } }).formData();
            const file = form.get("file");
            const bytes = Buffer.from(await file.arrayBuffer());
            if (form.get("kind") === "image") {
                const id = `local-poster-${posterUploads.push(file.name)}`;
                resources.set(id, { bytes, mimeType: file.type, kind: "image" });
                return send({ resource: { id, kind: "image", mimeType: file.type, size: bytes.length, width: 320, height: 180, status: "ready" } });
            }
            uploads.push({ name: file.name, mimeType: file.type, kind: form.get("kind"), unchanged: bytes.equals(videoBytes) });
            await new Promise((done) => setTimeout(done, 400));
            if (failUpload) return send({}, 400);
            const id = `local-video-${uploads.length}`;
            resources.set(id, { bytes, mimeType: "video/mp4", kind: "video" });
            return send({ resource: { id, kind: "video", mimeType: "video/mp4", size: bytes.length, width: 320, height: 180, durationMs: 1000, status: "ready" } });
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
            const stored = resources.get(resource[1]);
            if (resource[2]) {
                response.setHeader("Content-Type", stored.mimeType);
                return response.end(stored.bytes);
            }
            return send({ resource: { id: resource[1], kind: stored.kind, mimeType: stored.mimeType, status: "ready", width: 320, height: 180, durationMs: 1000 } });
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
    await page.goto(`${baseURL}/?media=video`);
    await page.waitForFunction(() => Boolean(window.localImageHarness));
    const node = page.locator('[data-node-id="upload-target"]');
    const toolbar = page.getByRole("toolbar", { name: "节点快捷工具" });
    const uploadButton = node.getByRole("button", { name: "上传本地视频", exact: true });
    await uploadButton.waitFor();
    await toolbar.getByRole("button", { name: "上传本地视频", exact: true }).waitFor();
    await page.screenshot({ path: join(outputDir, "empty-video-node.png") });
    await page.evaluate(() => window.localImageHarness.readOnly(true));
    await uploadButton.waitFor({ state: "detached" });
    assert.ok(await toolbar.getByRole("button", { name: "上传本地视频", exact: true }).isDisabled());
    await page.evaluate(() => { window.localImageHarness.readOnly(false); window.localImageHarness.locked(true); });
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata.locked);
    assert.equal(await uploadButton.count(), 0);
    await page.evaluate(() => window.localImageHarness.locked(false));
    const chooseFile = async (button) => {
        const chooserPromise = page.waitForEvent("filechooser");
        await button.click();
        const chooser = await chooserPromise;
        assert.equal(chooser.isMultiple(), false);
        assert.equal(await page.locator('input[type="file"]').getAttribute("accept"), "video/*");
        await chooser.setFiles({ name: "本地参考视频.mp4", mimeType: "video/mp4", buffer: videoBytes });
    };
    await chooseFile(uploadButton);
    await node.getByText("正在上传视频", { exact: true }).waitFor();
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-video-1" && window.localImageHarness.nodes()[0].metadata.assetId && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    const first = await page.evaluate(() => ({ node: window.localImageHarness.nodes()[0], count: window.localImageHarness.nodes().length, wires: window.localImageHarness.connections(), drags: window.localImageHarness.dragCount() }));
    assert.equal(first.count, 1);
    assert.equal(first.node.id, "upload-target");
    assert.equal(first.node.title, "我的参考视频");
    assert.equal(first.node.metadata.mimeType, "video/mp4");
    assert.equal(first.node.metadata.status, "success");
    assert.deepEqual(first.node.position, { x: 100, y: 200 });
    assert.ok(Math.abs(first.node.width / first.node.height - 16 / 9) < 0.001);
    assert.equal(first.drags, 0);
    assert.equal(first.wires[0].fromNodeId, first.node.id);
    await page.reload();
    await page.waitForFunction(() => window.localImageHarness?.nodes()[0].metadata?.storageKey === "resource:local-video-1");
    await page.evaluate(() => { window.localImageHarness.mode("simple"); window.localImageHarness.theme("dark"); });
    const replacementButton = toolbar.getByRole("button", { name: "替换视频", exact: true });
    await chooseFile(replacementButton);
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-video-2" && window.localImageHarness.nodes()[0].metadata.assetId && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    const replaced = await page.evaluate(() => window.localImageHarness.nodes()[0]);
    failUpload = true;
    await chooseFile(replacementButton);
    await page.getByText("测试视频上传失败", { exact: true }).waitFor({ state: "attached" });
    await page.waitForFunction(() => !window.localImageHarness.nodes()[0].metadata?.fileUpload);
    assert.deepEqual(await page.evaluate(() => window.localImageHarness.nodes()[0]), replaced);
    failUpload = false;
    await chooseFile(replacementButton);
    await page.waitForFunction(() => window.localImageHarness.nodes()[0].metadata?.storageKey === "resource:local-video-4" && window.localImageHarness.nodes()[0].metadata.assetId && !window.localImageHarness.nodes()[0].metadata.fileUpload);
    await page.evaluate(() => window.localImageHarness.loading(true));
    assert.ok(await replacementButton.isDisabled());
    await page.evaluate(() => window.localImageHarness.loading(false));
    await page.screenshot({ path: join(outputDir, "uploaded-video-node.png") });
    assert.equal(assets.length, 3);
    assert.ok(assets.every((asset) => asset.kind === "video" && asset.data.storageKey.startsWith("resource:local-video-")));
    assert.ok(uploads.every((upload) => upload.kind === "video" && upload.mimeType === "video/mp4" && upload.unchanged));
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    assert.deepEqual(unexpectedAPI, []);
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: true, uploads: uploads.length, savedVideoAssets: assets.length, preservedNode: true, preservedConnections: true, sameFileRetry: true, reloadPersistence: true, failureRestoresOriginal: true, readOnlyAndLockedBlocked: true, remoteRequests: 0 }, null, 2));
    console.log("PASS: local video chooser, replacement, persistence, failure recovery and unchanged video bytes");
} catch (error) {
    if (page) await page.screenshot({ path: join(outputDir, "failure.png") }).catch(() => {});
    const state = await page?.evaluate(() => window.localImageHarness?.nodes()).catch(() => undefined);
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: false, error: error.stack, errors, remoteRequests, unexpectedAPI, uploads, posterUploads, state }, null, 2));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
