import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const jiasuJ2 = process.argv.includes("--jiasu-j2");
const fixtureDir = join(rootDir, ".local/cache/jiasu-face-mask-ui");
const outputDir = join(rootDir, jiasuJ2 ? "output/playwright/jiasu-j2-face-mask" : "output/playwright/jiasu-face-mask");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/jiasu-face-mask.html") } } });
const originals = new Map([
    ["source-portrait", await readFile(process.env.JIASU_MASK_PORTRAIT || "S:/codex/Temp/Codex/codex-clipboard-070815d2-f870-4a2e-8d30-c7c798ea23e7.png")],
    ["source-sheet", await readFile(process.env.JIASU_MASK_SHEET || "S:/codex/Temp/Codex/codex-clipboard-b126733e-3f4b-43cd-9a80-04dd72ed2ad9.png")],
]);
const resources = new Map(originals);
const uploaded = [];
const tasks = [];
const hosted = [];
const events = [];
let hostingShouldFail = false;
let uploadShouldFail = false;
let resourceSequence = 0;
async function waitForPreview(page, sourceId) {
    const original = originals.get(sourceId);
    const dimensions = { width: original.readUInt32BE(16), height: original.readUInt32BE(20) };
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByRole("img", { name: "处理后的参考图预览" }).waitFor({ state: "visible" });
    await page.waitForFunction(({ width, height }) => {
        const dialog = document.querySelector('[role="dialog"]');
        const image = dialog?.querySelector('img[alt="处理后的参考图预览"]');
        const save = Array.from(dialog?.querySelectorAll("button") || []).find((button) => button.textContent === "保存调整");
        return image?.complete && image.naturalWidth === width && image.naturalHeight === height && save && !save.disabled && !dialog.textContent.includes("正在本地识别人脸");
    }, dimensions);
    await page.waitForFunction(() => {
        let element = document.querySelector('[role="dialog"]');
        while (element) {
            const style = getComputedStyle(element);
            if (Number(style.opacity) < 1 || style.visibility === "hidden") return false;
            element = element.parentElement;
        }
        return document.getAnimations().every((animation) => animation.playState !== "running");
    });
}
const server = createServer(async (request, response) => {
    const sendJSON = (data, status = 200, code = 0) => { response.statusCode = status; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ code, data, msg: status === 200 ? "ok" : "mock upload failed" })); };
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        const resourcePath = pathname.match(/^\/api\/resources\/([^/]+)(?:\/(file|upstream-url|temporary-image-url))?$/);
        if (request.method === "POST" && pathname === "/api/resources") {
            if (uploadShouldFail) return sendJSON({}, 400, 400);
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers["content-type"] } }).formData();
            const bytes = Buffer.from(await form.get("file").arrayBuffer());
            const id = `masked-${++resourceSequence}`;
            resources.set(id, bytes);
            uploaded.push({ id, bytes, idempotencyKey: request.headers["x-idempotency-key"] });
            events.push(`save:${id}`);
            return sendJSON({ resource: { id, mimeType: "image/png", size: bytes.length, width: Number(form.get("width")), height: Number(form.get("height")), status: "ready" } });
        }
        if (resourcePath) {
            const [, id, operation] = resourcePath;
            if (!resources.has(id)) return sendJSON({}, 404, 404);
            if (operation === "file") { response.setHeader("Content-Type", "image/png"); return response.end(resources.get(id)); }
            if (operation === "upstream-url" || operation === "temporary-image-url") {
                events.push(`host:${id}`);
                if (hostingShouldFail) return sendJSON({}, 503, 503);
                const url = `https://h.uguu.se/${id}-${hosted.length + 1}.png`;
                hosted.push({ id, url });
                return sendJSON({ url });
            }
            return sendJSON({ resource: { id, mimeType: "image/png", size: resources.get(id).length, status: "ready" } });
        }
        if (request.method === "POST" && pathname === "/api/tasks") {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const input = JSON.parse(Buffer.concat(chunks).toString());
            tasks.push(input);
            events.push("task");
            return sendJSON({ id: `mock-task-${tasks.length}`, type: "canvas_video", status: "queued", progress: 0 });
        }
        if (pathname.startsWith("/api/")) return sendJSON({});
        if (pathname.startsWith("/samples/")) { response.setHeader("Content-Type", "image/png"); return response.end(originals.get(pathname.includes("sheet") ? "source-sheet" : "source-portrait")); }
        const target = pathname === "/" ? "test/fixtures/jiasu-face-mask.html" : pathname.replace(/^\/+/, "");
        response.setHeader("Content-Type", target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".js") ? "application/javascript" : target.endsWith(".css") ? "text/css" : target.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch (error) { response.statusCode = 500; response.end(error.message); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
const browserErrors = [];
const remoteRequests = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== baseURL) { remoteRequests.push(url.origin); return route.abort(); }
        return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(baseURL + (jiasuJ2 ? "/?jiasu-j2=1" : ""));
    assert.equal(await page.title(), "佳速人脸遮罩测试");
    await page.waitForFunction(() => Boolean(window.faceMaskHarness));
    await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    assert.ok(await page.getByRole("button", { name: /^移动人脸/ }).count() >= 1, "Real detector must find at least one portrait face");
    assert.equal(uploaded.length, 0, "Preview must not save or upload images");
    assert.equal(hosted.length, 0, "Preview must not contact hosting");
    const pixelChecks = await page.evaluate(async () => {
        const harness = window.faceMaskHarness;
        const inspected = await harness.inspect(harness.references[0]);
        const region = inspected.regions[0];
        const pixels = async (blob) => {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const original = await pixels(inspected.source);
        const masked = await harness.render(inspected.source, inspected.regions, "mosaic");
        const result = await pixels(masked);
        let changedInside = 0;
        let changedOutside = 0;
        for (let offset = 0; offset < result.length; offset += 4) {
            if (result.slice(offset, offset + 4).every((value, index) => value === original[offset + index])) continue;
            const horizontal = (offset / 4) % inspected.width;
            const vertical = Math.floor(offset / 4 / inspected.width);
            const inside = horizontal >= Math.floor(region.x * inspected.width) && horizontal <= Math.ceil((region.x + region.width) * inspected.width) && vertical >= Math.floor(region.y * inspected.height) && vertical <= Math.ceil((region.y + region.height) * inspected.height);
            if (inside) changedInside++;
            else changedOutside++;
        }
        const off = await harness.render(inspected.source, inspected.regions, "off");
        const noFaces = await harness.render(inspected.source, [], "grid");
        return { changedInside, changedOutside, offKeepsOriginal: off === inspected.source, noFacesKeepsOriginal: noFaces === inspected.source };
    });
    assert.ok(pixelChecks.changedInside > 0);
    assert.equal(pixelChecks.changedOutside, 0);
    assert.equal(pixelChecks.offKeepsOriginal, true);
    assert.equal(pixelChecks.noFacesKeepsOriginal, true);
    await page.screenshot({ path: join(outputDir, "portrait-light.png"), animations: "disabled" });
    const move = page.getByRole("button", { name: "移动人脸1", exact: true });
    const oldX = Number(await page.getByRole("spinbutton", { name: "人脸框横坐标", exact: true }).inputValue());
    const box = await move.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 4, { steps: 5 });
    await page.mouse.up();
    assert.ok(Number(await page.getByRole("spinbutton", { name: "人脸框横坐标", exact: true }).inputValue()) > oldX);
    const oldWidth = Number(await page.getByRole("spinbutton", { name: "人脸框宽度", exact: true }).inputValue());
    const handle = await page.getByRole("button", { name: "调整人脸1大小", exact: true }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 8, handle.y + handle.height / 2 + 8, { steps: 5 });
    await page.mouse.up();
    assert.ok(Number(await page.getByRole("spinbutton", { name: "人脸框宽度", exact: true }).inputValue()) > oldWidth);
    await page.getByRole("button", { name: "图片2", exact: true }).click();
    await waitForPreview(page, "source-sheet");
    assert.equal(await page.getByRole("button", { name: "图片2", exact: true }).getAttribute("aria-pressed"), "true");
    assert.ok(await page.getByRole("button", { name: /^移动人脸/ }).count() >= 2, "Real detector must find multiple sheet faces");
    await page.screenshot({ path: join(outputDir, "sheet-light.png"), animations: "disabled" });
    await page.getByRole("button", { name: "手动框选", exact: true }).click();
    const beforeManual = await page.getByRole("button", { name: /^移动人脸/ }).count();
    const region = await page.getByRole("group", { name: "人脸遮罩编辑区域", exact: true }).boundingBox();
    await page.mouse.move(region.x + region.width * 0.84, region.y + region.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width * 0.95, region.y + region.height * 0.8, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.getByRole("button", { name: /^移动人脸/ }).count(), beforeManual + 1);
    await page.getByRole("button", { name: "删除选中框", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /^移动人脸/ }).count(), beforeManual);
    await page.getByRole("button", { name: "保存调整", exact: true }).click();
    const saved = await page.evaluate(() => window.faceMaskHarness.node().metadata.jiasuFaceMasks);
    assert.ok(saved.portrait.sourceHash && saved.sheet.sourceHash);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.faceMaskHarness));
    assert.deepEqual(await page.evaluate(() => window.faceMaskHarness.node().metadata.jiasuFaceMasks), saved);
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByText("已提交 mock-task-1", { exact: true }).waitFor();
    assert.equal(uploaded.length, 2);
    assert.deepEqual(events.filter((event) => /save:|task/.test(event)).slice(0, 3), ["save:masked-1", "save:masked-2", "task"]);
    const references = tasks[0].input.referenceImages;
    assert.equal(tasks[0].input.config.model, jiasuJ2 ? "sd-2.5-j2-V" : "dola-sd-2.5");
    assert.equal(Object.hasOwn(tasks[0].input.config, "face"), false);
    assert.deepEqual(references.map((image) => image.id), ["portrait", "sheet"]);
    assert.deepEqual(references.map((image) => image.storageKey), ["resource:masked-1", "resource:masked-2"]);
    assert.ok(references.every((image) => !image.url && !image.arkAssetId));
    assert.equal(Object.hasOwn(tasks[0].input.config, "videoJiasuFaceMask"), false);
    await writeFile(join(outputDir, "masked-portrait.png"), uploaded[0].bytes);
    await writeFile(join(outputDir, "masked-sheet.png"), uploaded[1].bytes);
    assert.notDeepEqual(uploaded[0].bytes, originals.get("source-portrait"));
    assert.ok(uploaded.every((item) => /^jiasu-face-mask:[a-f0-9]{64}$/.test(item.idempotencyKey)));
    await page.reload();
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByText("已提交 mock-task-2", { exact: true }).waitFor();
    assert.equal(uploaded.length, 2, "Reload must reuse saved derived resources");
    assert.deepEqual(tasks[1].input.referenceImages, references);
    uploadShouldFail = true;
    const failedSave = await page.evaluate(async () => {
        try {
            const harness = window.faceMaskHarness;
            await harness.submitWithMode("mosaic");
            return "unexpected success";
        } catch (error) { return error.message; }
    });
    uploadShouldFail = false;
    assert.notEqual(failedSave, "unexpected success");
    assert.equal(uploaded.length, 2);
    assert.equal(tasks.length, 2, "Failed reference preparation must not create a task");
    const cancelled = await page.evaluate(async () => {
        const controller = new AbortController();
        controller.abort();
        const harness = window.faceMaskHarness;
        try { await harness.submitWithMode("grid", controller.signal); return "unexpected success"; }
        catch (error) { return error.name; }
    });
    assert.equal(cancelled, "AbortError");
    assert.equal(uploaded.length, 2);
    await page.getByRole("button", { name: "切换明暗", exact: true }).click();
    await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    await page.screenshot({ path: join(outputDir, "portrait-dark.png"), animations: "disabled" });
    await page.getByRole("switch", { name: "自动人脸遮罩", exact: true }).click();
    await page.getByRole("button", { name: "保存调整", exact: true }).click();
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByText("已提交 mock-task-3", { exact: true }).waitFor();
    assert.deepEqual(tasks[2].input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    await page.reload();
    await page.waitForFunction(() => window.faceMaskHarness.config().videoJiasuFaceMask === "off");
    await page.getByRole("button", { name: "H3 模型", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).count(), 0);
    await page.getByRole("button", { name: "SD2 渠道", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).count(), 0);
    await page.evaluate(() => window.faceMaskHarness.submitWithMode("grid"));
    assert.equal(uploaded.length, 2, "SD2 must not create Jiasu masked images even when the local preference is enabled");
    assert.deepEqual(tasks[3].input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    await page.goto(`${baseURL}/?assets=1`);
    await page.getByRole("button", { name: "佳速 SD", exact: true }).click();
    await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    await page.getByRole("button", { name: "图片2", exact: true }).click();
    await waitForPreview(page, "source-sheet");
    await page.getByRole("button", { name: "保存调整", exact: true }).click();
    const assetMasks = await page.evaluate(() => window.faceMaskHarness.node().metadata.jiasuFaceMasks);
    assert.equal(assetMasks.portrait.storageKey, "resource:source-portrait");
    assert.equal(assetMasks.sheet.storageKey, "resource:source-sheet");
    assert.equal(Object.hasOwn(assetMasks, ""), false, "Asset references must have separate stable mask identities");
    const jiasuMode = await page.evaluate(() => window.faceMaskHarness.config().videoJiasuFaceMask);
    await page.getByRole("button", { name: "SD2 D 模型", exact: true }).click();
    await page.getByRole("button", { name: "Eggfans SD2 D 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    assert.equal(await page.getByRole("switch", { name: "自动人脸遮罩", exact: true }).getAttribute("aria-checked"), "false");
    await page.getByRole("switch", { name: "自动人脸遮罩", exact: true }).click();
    const dX = page.getByRole("spinbutton", { name: "人脸框横坐标", exact: true });
    await dX.fill(String(Number(await dX.inputValue()) + 5));
    await dX.blur();
    await page.getByRole("button", { name: "图片2", exact: true }).click();
    await waitForPreview(page, "source-sheet");
    await page.getByRole("button", { name: "保存调整", exact: true }).click();
    const dMasks = await page.evaluate(() => window.faceMaskHarness.node().metadata.sd2FaceMasks);
    assert.ok(dMasks.portrait.sourceHash && dMasks.sheet.sourceHash);
    assert.deepEqual(await page.evaluate(() => window.faceMaskHarness.node().metadata.jiasuFaceMasks), assetMasks);
    await page.reload();
    await page.waitForFunction(() => window.faceMaskHarness.config().videoSd2FaceMask === "grid");
    assert.equal(await page.evaluate(() => window.faceMaskHarness.config().videoJiasuFaceMask), jiasuMode);
    assert.deepEqual(await page.evaluate(() => window.faceMaskHarness.node().metadata.sd2FaceMasks), dMasks);
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByText("已提交 mock-task-5", { exact: true }).waitFor();
    assert.equal(uploaded.length, 4, "D must create channel-specific derivatives");
    const dReferences = tasks[4].input.referenceImages;
    assert.deepEqual(dReferences.map((image) => image.storageKey), ["resource:masked-3", "resource:masked-4"]);
    assert.ok(dReferences.every((image) => !image.url && !image.arkAssetId));
    assert.equal(tasks[4].input.config.face, true);
    assert.equal(Object.hasOwn(tasks[4].input.config, "videoNativeFace"), false);
    assert.equal(Object.hasOwn(tasks[4].input.config, "videoSd2FaceMask"), false);
    assert.ok(uploaded.slice(2).every((item) => /^eggfans-sd2-face-mask:[a-f0-9]{64}$/.test(item.idempotencyKey)));
    const gridBytes = await page.evaluate(async () => {
        const harness = window.faceMaskHarness;
        const inspection = await harness.inspect(harness.references[0], harness.node().metadata.sd2FaceMasks.portrait);
        const rendered = await harness.render(inspection.source, inspection.regions, "grid");
        return Array.from(new Uint8Array(await rendered.arrayBuffer()));
    });
    assert.deepEqual(uploaded[2].bytes, Buffer.from(gridBytes), "Submitted D image must contain the selected grid");
    assert.notDeepEqual(uploaded[2].bytes, originals.get("source-portrait"));
    await writeFile(join(outputDir, "sd2-d-grid-portrait.png"), uploaded[2].bytes);
    await page.getByRole("button", { name: "Eggfans SD2 D 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    await page.screenshot({ path: join(outputDir, "sd2-d-grid-panel.png"), animations: "disabled" });
    await page.getByRole("button", { name: /^取\s*消$/ }).click();
    await page.reload();
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await page.getByText("已提交 mock-task-6", { exact: true }).waitFor();
    assert.equal(uploaded.length, 4, "D must reuse its own derivatives after reload");
    assert.deepEqual(tasks[5].input.referenceImages, dReferences);
    await page.getByRole("button", { name: "SD2 渠道", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Eggfans SD2 D 人脸遮罩", exact: true }).count(), 0);
    await page.evaluate(() => window.faceMaskHarness.submitWithMode("grid"));
    assert.equal(uploaded.length, 4, "C must ignore D and Jiasu mask preferences");
    assert.equal(tasks[6].input.config.face, true);
    assert.deepEqual(tasks[6].input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    await page.getByRole("button", { name: "SD2 D 模型", exact: true }).click();
    await page.evaluate(() => window.faceMaskHarness.submitWithMode("off"));
    assert.equal(uploaded.length, 4);
    assert.equal(tasks[7].input.config.face, true);
    assert.deepEqual(tasks[7].input.referenceImages.map((image) => image.storageKey), ["resource:source-portrait", "resource:source-sheet"]);
    await page.getByRole("button", { name: "佳速 SD", exact: true }).click();
    await page.getByRole("button", { name: "佳速 SD 人脸遮罩", exact: true }).click();
    await waitForPreview(page, "source-portrait");
    assert.deepEqual(await page.evaluate(() => window.faceMaskHarness.node().metadata.jiasuFaceMasks), assetMasks);
    assert.equal(await page.evaluate(() => window.faceMaskHarness.config().videoJiasuFaceMask), jiasuMode);
    await page.getByRole("button", { name: /^取\s*消$/ }).click();
    const gridLineCounts = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 360;
        canvas.height = 240;
        const context = canvas.getContext("2d");
        context.fillStyle = "rgb(20,20,20)";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const source = await new Promise((done) => canvas.toBlob(done, "image/png"));
        const counts = [];
        for (const mode of ["grid", "grid-60", "grid-75"]) {
            const rendered = await window.faceMaskHarness.render(source, [{ id: "face", x: 0, y: 0, width: 1, height: 1 }], mode);
            const bitmap = await createImageBitmap(rendered);
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixels = context.getImageData(0, 11, canvas.width, 1).data;
            let lines = 0;
            let onLine = false;
            for (let horizontal = 0; horizontal < canvas.width; horizontal++) {
                const bright = pixels[horizontal * 4] > 80;
                if (bright && !onLine) lines++;
                onLine = bright;
            }
            counts.push(lines);
        }
        return counts;
    });
    assert.equal(gridLineCounts[0], 19, "50% must retain the original 18-column grid including boundary lines");
    assert.ok(Math.abs(gridLineCounts[1] / gridLineCounts[0] - 1.2) < 0.06, "60% must draw about 20% more grid lines");
    assert.ok(Math.abs(gridLineCounts[2] / gridLineCounts[0] - 1.5) < 0.06, "75% must draw about 50% more grid lines");
    for (const channel of [
        { button: "佳速 SD", label: "佳速 SD 人脸遮罩", configKey: "videoJiasuFaceMask", nodeKey: "jiasuFaceMask", masksKey: "jiasuFaceMasks" },
        { button: "SD2 D 模型", label: "Eggfans SD2 D 人脸遮罩", configKey: "videoSd2FaceMask", nodeKey: "sd2FaceMask", masksKey: "sd2FaceMasks" },
    ]) {
        await page.getByRole("button", { name: channel.button, exact: true }).click();
        const derivativeIds = [];
        for (const [mode, label] of [["grid", "50%"], ["grid-60", "60%"], ["grid-75", "75%"]]) {
            const uploadsBeforePreview = uploaded.length;
            await page.getByRole("button", { name: channel.label, exact: true }).click();
            await waitForPreview(page, "source-portrait");
            const image = page.getByRole("img", { name: "处理后的参考图预览" });
            const previous = await image.getAttribute("src");
            const previousMode = await page.evaluate((key) => window.faceMaskHarness.config()[key], channel.configKey);
            await page.getByRole("combobox", { name: "人脸遮罩样式" }).click();
            await page.getByText(`半透明网格 ${label}`, { exact: true }).last().click();
            if (previousMode !== mode) await page.waitForFunction((source) => document.querySelector('img[alt="处理后的参考图预览"]')?.src !== source, previous);
            await waitForPreview(page, "source-portrait");
            assert.equal(uploaded.length, uploadsBeforePreview, "Changing density must not upload during preview");
            await page.screenshot({ path: join(outputDir, `${channel.configKey}-${label}.png`), animations: "disabled" });
            await page.getByRole("button", { name: "保存调整", exact: true }).click();
            await page.reload();
            await page.waitForFunction(({ configKey, nodeKey, mode }) => window.faceMaskHarness?.config()[configKey] === mode && window.faceMaskHarness.node().metadata[nodeKey] === mode, { ...channel, mode });
            const taskCount = tasks.length;
            await page.evaluate(() => window.faceMaskHarness.submit());
            assert.equal(tasks.length, taskCount + 1);
            const references = tasks.at(-1).input.referenceImages;
            derivativeIds.push(references[0].storageKey);
            const selectedBytes = await page.evaluate(async ({ masksKey, mode }) => {
                const harness = window.faceMaskHarness;
                const inspection = await harness.inspect(harness.references[0], harness.node().metadata[masksKey].portrait);
                const rendered = await harness.render(inspection.source, inspection.regions, mode);
                return Array.from(new Uint8Array(await rendered.arrayBuffer()));
            }, { ...channel, mode });
            const submitted = resources.get(references[0].storageKey.replace("resource:", ""));
            assert.deepEqual(submitted, Buffer.from(selectedBytes), "Task must use the selected density PNG");
            await writeFile(join(outputDir, `${channel.configKey}-${label}-portrait.png`), submitted);
            const uploadsBeforeReuse = uploaded.length;
            await page.evaluate(() => window.faceMaskHarness.submit());
            assert.equal(uploaded.length, uploadsBeforeReuse, "Same density must reuse its cached derivative");
            assert.deepEqual(tasks.at(-1).input.referenceImages, references);
            if (channel.nodeKey === "sd2FaceMask") assert.equal(tasks.at(-1).input.config.face, true);
        }
        assert.equal(new Set(derivativeIds).size, 3, "Densities must never share the same cached image");
    }
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(remoteRequests, []);
    console.log(JSON.stringify({ passed: true, gridLineCounts, allGridDensitiesSubmitted: true, densityCachesSeparated: true, densitySavedAfterReload: true, realDetection: true, previewNoUploads: true, moveResizeManual: true, mosaicKeepsOutsidePixels: true, saveFailureBlocksTask: true, abortNoUpload: true, savedAfterReload: true, processedBeforeTask: true, derivativeReuseAfterReload: true, sd2DGridBytesSubmitted: true, sd2DSettingsPersisted: true, nativeFaceModesSeparated: true, otherChannelsIsolated: true, remoteRequests: 0 }));
} catch (error) {
    console.error(JSON.stringify({ browserErrors, remoteRequests, snapshot: await page?.locator("body").ariaSnapshot() }));
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
