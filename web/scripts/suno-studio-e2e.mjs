import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const fixtureDir = join(rootDir, ".local/cache/suno-studio-ui");
const outputDir = join(rootDir, "output/playwright/suno-studio");
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: { outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/music-studio.html") } } });
const sampleRate = 16000;
const seconds = 8;
const samples = sampleRate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let sample = 0; sample < samples; sample++) wav.writeInt16LE(Math.round(Math.sin(sample / sampleRate * Math.PI * 440) * (0.35 + 0.25 * Math.sin(sample / sampleRate * 5)) * 32767), 44 + sample * 2);
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (pathname.startsWith("/fixtures/") || /\/resources\/[^/]+\/file$/.test(pathname)) {
            response.setHeader("Content-Type", "audio/wav"); response.end(wav); return;
        }
        const target = pathname === "/" ? "test/fixtures/music-studio.html" : pathname.replace(/^\/+/, "");
        const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css" }[extname(target)];
        response.setHeader("Content-Type", mime || "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch { response.statusCode = 404; response.end("not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const requests = [];
const pageErrors = [];
const forbidden = [];
let status = "processing";
let interrupted = false;
let imported = 0;
let savedAssets = 0;
let browser;
let page;
const taskId = "1268154180129529857";
const envelope = (data) => ({ code: 0, data, msg: "ok" });
const json = (route, data, httpStatus = 200) => route.fulfill({ status: httpStatus, contentType: "application/json", body: JSON.stringify(data) });
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--autoplay-policy=no-user-gesture-required"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(25_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== baseURL) { forbidden.push(request.url()); return route.abort(); }
        if (url.pathname === "/api/ai/custom") {
            const upstream = new URL(request.headers()["x-canvas-upstream-url"]);
            assert.equal(upstream.origin, "https://api.eggfans.com");
            assert.equal(request.headers()["authorization"], "Bearer synthetic-suno-fixture");
            const payload = request.method() === "POST" ? request.postDataJSON() : undefined;
            requests.push({ path: upstream.pathname, query: upstream.search, method: request.method(), payload });
            if (upstream.pathname.startsWith("/suno/fetch/")) {
                if (interrupted) return json(route, { message: "Fixture status temporarily unavailable" }, 503);
                const clips = status === "success" ? ["a", "b"].map((name) => ({ id: `clip-${name}`, title: `离线试音 ${name.toUpperCase()}`, audio_url: `${baseURL}/fixtures/${name}.wav`, duration: seconds, status: "complete", metadata: { tags: "piano, ambient", prompt: "[Verse]\n离线测试歌词" } })) : [];
                return json(route, { code: "success", data: { task_id: taskId, status, data: clips } });
            }
            if (upstream.pathname === "/suno/submit/music") return json(route, { code: "success", data: taskId });
            if (upstream.pathname === "/suno/uploads/audio") return json(route, { code: "success", data: { clip_id: "uploaded-clip", status: "complete", audio_url: `${baseURL}/fixtures/upload.wav` } });
            if (upstream.pathname === "/suno/account/integral") return json(route, { code: 200, data: 122 });
            return json(route, { code: "success", data: {} });
        }
        if (url.pathname === "/api/resources/import" && request.method() === "POST") {
            imported++;
            const payload = request.postDataJSON();
            assert.equal(payload.kind, "audio");
            assert.ok(payload.url.startsWith(baseURL));
            return json(route, envelope({ resource: { id: `resource-${imported}`, kind: "audio", status: "ready", mimeType: "audio/wav", size: wav.length, durationMs: seconds * 1000 } }));
        }
        if (url.pathname.startsWith("/api/assets/") && request.method() === "PUT") { savedAssets++; return json(route, envelope({})); }
        if (url.pathname === "/api/resources" && request.method() === "POST") return json(route, envelope({ resource: { id: "upload-fixture", kind: "audio", mimeType: "audio/wav", size: wav.length } }));
        if (url.pathname === "/api/resources/upload-fixture/upstream-url") return json(route, envelope({ url: "https://fixture.uguu.se/local.wav" }));
        if (/\/resources\/[^/]+\/file$/.test(url.pathname)) return route.fulfill({ contentType: "audio/wav", body: wav });
        if (url.pathname.startsWith("/api/")) return json(route, envelope({}));
        return route.continue();
    });
    await page.goto(baseURL);
    await page.waitForFunction(() => window.sunoHarness?.state().hydrated && window.sunoHarness.state().draft.channelId);
    await page.getByRole("button", { name: "提交创建音乐", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "请修正标记的参数" }).first().waitFor();
    assert.equal(requests.length, 0);
    await page.getByRole("textbox", { name: "音乐灵感描述", exact: true }).fill("雨夜钢琴，温暖女声，舒缓节奏");
    await page.getByRole("textbox", { name: "歌曲标题", exact: true }).fill("雨夜试音");
    await page.evaluate(() => window.sunoHarness.flush());
    await page.reload();
    await page.getByRole("textbox", { name: "歌曲标题", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "歌曲标题", exact: true }).inputValue(), "雨夜试音");
    assert.equal(await page.getByRole("textbox", { name: "音乐灵感描述", exact: true }).inputValue(), "雨夜钢琴，温暖女声，舒缓节奏");
    await page.getByRole("button", { name: "提交创建音乐", exact: true }).click();
    await page.waitForFunction(() => window.sunoHarness.state().jobs[0]?.taskId);
    assert.equal(requests.filter((request) => request.path === "/suno/submit/music").length, 1);
    const musicRequest = requests.find((request) => request.path === "/suno/submit/music");
    assert.deepEqual(musicRequest.payload, { mv: "chirp-v5", make_instrumental: false, gpt_description_prompt: "雨夜钢琴，温暖女声，舒缓节奏", title: "雨夜试音" });
    interrupted = true;
    await page.getByRole("button", { name: "刷新创建音乐状态", exact: true }).first().click();
    await page.getByRole("status").filter({ hasText: "不会重新提交" }).first().waitFor();
    assert.equal(await page.evaluate(() => window.sunoHarness.state().jobs[0].status), "running");
    interrupted = false;
    await page.evaluate(() => window.sunoHarness.flush());
    status = "success";
    await page.reload();
    await page.waitForFunction(() => window.sunoHarness.state().jobs[0]?.clips.filter((clip) => clip.assetId).length === 2);
    assert.equal(requests.filter((request) => request.path === "/suno/submit/music").length, 1);
    assert.equal(imported, 2);
    assert.equal(savedAssets, 2);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => { const audio = document.querySelector("audio"); return audio && !audio.paused && audio.currentTime > 0; });
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.waitForFunction(() => { const canvas = document.querySelector('canvas[aria-label="音频波形"]'); return canvas?.width > 100 && !document.querySelector(".suno-studio-waveform-state"); });
    const pixels = await page.evaluate(() => {
        const canvas = document.querySelector('canvas[aria-label="音频波形"]');
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        return { painted: Array.from(data).filter((value, index) => index % 4 === 3 && value > 0).length, total: canvas.width * canvas.height };
    });
    assert.ok(pixels.painted > pixels.total * 0.1);
    await page.evaluate(() => window.sunoHarness.operation("post-suno-submit-music", { mode: "custom", task: "infill", continue_clip_id: "clip-a", prompt: "替换副歌" }));
    await page.getByRole("spinbutton", { name: "选区入点（秒）", exact: true }).fill("1");
    await page.getByRole("spinbutton", { name: "选区出点（秒）", exact: true }).fill("4");
    await page.getByRole("button", { name: "应用选区", exact: true }).click();
    assert.equal(await page.evaluate(() => window.sunoHarness.state().draft.values["metadata_params.infill_start_s"]), 1);
    assert.equal(await page.evaluate(() => window.sunoHarness.state().draft.values["metadata_params.infill_end_s"]), 4);
    await page.screenshot({ path: join(outputDir, "desktop-dark.png") });
    const operations = await page.evaluate(() => window.sunoHarness.operations);
    assert.equal(operations.length, 26);
    for (const operation of operations) {
        await page.evaluate((id) => window.sunoHarness.operation(id), operation.id);
        await page.locator(".suno-studio-endpoint code").filter({ hasText: operation.path }).waitFor();
    }
    await page.evaluate(() => window.sunoHarness.operation("post-suno-uploads-audio", { url: "https://fixture.uguu.se/local.wav", name: "授权音频", upload_type: "MUSIC_COPYRIGHT" }));
    await page.locator(".suno-studio-submit-bar button").click();
    const confirm = page.getByRole("button", { name: "确认并提交上传", exact: true });
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(requests.filter((request) => request.path === "/suno/uploads/audio").length, 0);
    await page.getByRole("checkbox", { name: /我拥有该音频的版权/ }).check();
    await confirm.click();
    await page.waitForFunction(() => window.sunoHarness.state().jobs.some((job) => job.operationId === "post-suno-uploads-audio"));
    await page.waitForFunction(() => !document.querySelector(".suno-studio-submit-bar .ant-btn-loading"));
    assert.equal(requests.filter((request) => request.path === "/suno/uploads/audio").length, 1);
    await page.evaluate(() => window.sunoHarness.operation("get-suno-account-integral"));
    await page.locator(".suno-studio-submit-bar button").click();
    await page.waitForFunction(() => window.sunoHarness.state().jobs[0].operationId === "get-suno-account-integral" && window.sunoHarness.state().jobs[0].status === "succeeded");
    assert.equal(await page.evaluate(() => window.sunoHarness.state().jobs[0].taskId), undefined);
    await page.evaluate(() => window.sunoHarness.operation("post-suno-submit-music"));
    await page.getByLabel("本地音频文件", { exact: true }).setInputFiles({ name: "local-reference.wav", mimeType: "audio/wav", buffer: wav });
    await page.getByRole("button", { name: "上传引用", exact: true }).click();
    await page.waitForFunction(() => window.sunoHarness.state().draft.values.url === "https://fixture.uguu.se/local.wav");
    assert.equal(await page.evaluate(() => window.sunoHarness.state().draft.operationId), "post-suno-uploads-audio");
    await page.evaluate(() => window.sunoHarness.operation("post-suno-submit-music", { mode: "custom", title: "雨夜", prompt: "[Verse]\n一束微光照进雨夜", tags: "piano, cinematic, warm" }));
    await page.evaluate(() => window.sunoHarness.theme(false));
    await page.screenshot({ path: join(outputDir, "desktop-light.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "创作参数", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(outputDir, "mobile-create.png") });
    await page.getByRole("tab", { name: "试听 / 结果", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("audio")?.currentTime > 0 && !document.querySelector(".suno-studio-waveform-state"));
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.screenshot({ path: join(outputDir, "mobile-player.png") });
    await page.getByRole("tab", { name: /制作队列/ }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(outputDir, "mobile-queue.png") });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.evaluate(() => window.sunoHarness.canvas());
    await page.getByRole("button", { name: /高级设置/ }).click();
    await page.getByRole("region", { name: "Suno 音乐参数", exact: true }).waitFor();
    assert.equal(await page.getByText("Alloy", { exact: true }).count(), 0);
    const versions = page.getByRole("combobox", { name: "模型版本", exact: true });
    await versions.click();
    await versions.fill("v6 Mini");
    await page.getByTitle("Suno v6 Mini", { exact: true }).click();
    await page.getByRole("region", { name: "Suno 音乐参数", exact: true }).waitFor();
    assert.equal(JSON.parse(await page.evaluate(() => window.sunoHarness.nodeConfig().audioSunoParams)).mv, "chirp-v6-mini");
    await page.getByText("自定义模式", { exact: true }).click();
    await page.getByRole("textbox", { name: "歌曲标题", exact: true }).fill("节点原创音乐");
    await page.getByRole("textbox", { name: "音乐风格标签", exact: true }).fill("piano, cinematic");
    await page.getByRole("switch", { name: "纯音乐（无人声）", exact: true }).click();
    const nodePayload = await page.evaluate(() => window.sunoHarness.canvasPayload());
    assert.deepEqual(JSON.parse(nodePayload.audioSunoParams), { mv: "chirp-v6-mini", make_instrumental: true, prompt: "[Verse] 这是离线测试歌词", title: "节点原创音乐", tags: "piano, cinematic" });
    await page.reload();
    await page.getByRole("button", { name: /高级设置/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "歌曲标题", exact: true }).inputValue(), "节点原创音乐");
    await page.screenshot({ path: join(outputDir, "canvas-suno-settings.png") });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(forbidden, []);
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: true, operations: operations.length, mockedRequests: requests, imported, savedAssets, waveform: pixels, remoteRequests: forbidden.length, pageErrors }, null, 2));
    console.log("PASS: Suno studio native payload, inline validation, draft persistence, query interruption, reload resume without duplicate submission, all 26 forms, multi-clip import, real audio/waveform, range editing, copyright confirmation, local upload, and desktop/mobile themes. No remote requests.");
} catch (error) {
    console.error(JSON.stringify({ pageErrors, forbidden, audio: await page?.evaluate(() => { const audio = document.querySelector("audio"); return audio && { src: audio.src, readyState: audio.readyState, networkState: audio.networkState, error: audio.error?.message, code: audio.error?.code }; }), snapshot: await page?.locator("body").ariaSnapshot() }));
    await page?.screenshot({ path: join(outputDir, "failure.png") });
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
