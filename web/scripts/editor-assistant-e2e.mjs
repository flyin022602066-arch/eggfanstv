import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const multimodal = process.argv.includes("--multimodal");
const director = process.argv.includes("--director");
const offline = process.argv.includes("--offline");
const desktopURL = new URL(offline ? "http://127.0.0.1" : process.argv[2]);
assert.equal(desktopURL.hostname, "127.0.0.1");
assert.equal(desktopURL.protocol, "http:");
const requestedHeaders = "authorization,content-type,x-desktop-token,x-canvas-upstream-url,x-canvas-upstream-base-url,x-canvas-upstream-format,x-canvas-upstream-headers";
const probe = offline ? new Response(null, { status: 204, headers: { "access-control-allow-headers": requestedHeaders, "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-credentials": "true" } }) : await fetch(new URL("/api/ai/custom", desktopURL), { method: "OPTIONS", headers: {
    Origin: "http://wails.localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": requestedHeaders,
} });
assert.equal(probe.status, 204);
const allowedHeaders = probe.headers.get("access-control-allow-headers");
const allowedMethods = probe.headers.get("access-control-allow-methods");
const fixtureDir = join(rootDir, ".local/cache/editor-assistant-ui");
const outputDir = process.env.EGGFANS_EDITOR_QA_DIR || join(tmpdir(), "eggfans-editor-director-qa");
await mkdir(outputDir, { recursive: true });
const syntheticVideo = join(rootDir, ".local/cache/editor-analysis-synthetic.mp4");
if (multimodal) await promisify(execFile)(process.env.FFMPEG_BIN || "D:/ffmpeg-7.1-full_build/bin/ffmpeg.exe", ["-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12:duration=14", "-f", "lavfi", "-i", "sine=frequency=440:duration=14", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", syntheticVideo]);
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: {
    outDir: fixtureDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/editor-assistant.html") },
} });
let preflights = 0;
let submissions = 0;
let failNext = false;
let contractError;
let holdNext = false;
let heldResponse;
let transcriptions = 0;
let directorRepair = director;
let libraryPlan = false;
const bodies = [];
function respondWithPlan(response, commands = [{ op: "trimClip", payload: { id: "clip-1", durationMs: 5_000 } }]) {
    const directorPlan = { title: "情绪递进剪辑", reasoning: "保留完整对白与反应，通过镜头顺序形成情绪递进。", sequence: libraryPlan ? [{ clipId: "asset:library-video", sourceStartMs: 1000, durationMs: 8000, purpose: "完整对白与情绪反应" }] : Array.from({ length: 12 }, (_, index) => ({ clipId: `clip-${12 - index}`, sourceStartMs: 1000, durationMs: 8000, purpose: `叙事推进与反应镜头 ${index + 1}` })) };
    if (directorRepair) { directorPlan.sequence[0].clipId = "unknown-source"; directorRepair = false; }
    const plan = JSON.stringify(director ? directorPlan : { reasoning: "已根据素材分析生成剪辑计划", commands });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: plan.slice(0, 24) } }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: plan.slice(24) } }] })}\n\ndata: [DONE]\n\n`);
}
const relay = createServer(async (request, response) => {
    try {
        response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
        response.setHeader("Access-Control-Allow-Credentials", probe.headers.get("access-control-allow-credentials"));
        response.setHeader("Access-Control-Allow-Headers", allowedHeaders);
        response.setHeader("Access-Control-Allow-Methods", allowedMethods);
        if (request.method === "OPTIONS") {
            preflights += 1;
            response.writeHead(204).end();
            return;
        }
        if (request.url.startsWith("/api/resources/synthetic-video/file")) {
            response.setHeader("Content-Type", "video/mp4");
            response.end(await readFile(syntheticVideo));
            return;
        }
        if (request.url === "/api/timeline/transcriptions") {
            assert.equal(request.method, "POST");
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { resourceId: "synthetic-video", projectId: "offline-editor" });
            transcriptions++;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ code: 0, data: { id: "synthetic-transcript", status: "queued" }, msg: "" }));
            return;
        }
        if (request.url === "/api/tasks/synthetic-transcript") {
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ code: 0, data: { id: "synthetic-transcript", status: "succeeded", resultJson: JSON.stringify({ language: "zh", segments: [{ startMs: 2000, endMs: 8000, text: "本地转写测试对白" }] }) }, msg: "" }));
            return;
        }
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/api/ai/custom");
        assert.equal(request.headers.authorization, "Bearer synthetic-model-key");
        assert.equal(request.headers["x-desktop-token"], "synthetic-desktop-token");
        assert.equal(request.headers["x-canvas-upstream-url"], "https://api.eggfans.com/v1/chat/completions");
        assert.equal(request.headers["x-canvas-upstream-base-url"], "https://api.eggfans.com/");
        assert.equal(request.headers["x-canvas-upstream-format"], "openai");
        assert.deepEqual(JSON.parse(Buffer.from(request.headers["x-canvas-upstream-headers"], "base64").toString()), [{ name: "X-Test-Channel", value: "editor-assistant" }]);
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        bodies.push(body);
        assert.equal(body.model, "gpt-6.1-sol");
        assert.equal(body.stream, true);
        assert.ok(body.messages.some(message => message.role === "system" && JSON.stringify(message.content).includes(libraryPlan ? "asset:library-video" : "clip-1")));
        submissions += 1;
        if (holdNext) { holdNext = false; heldResponse = response; return; }
        if (failNext) {
            failNext = false;
            response.writeHead(503, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: { message: "离线测试：上游暂不可用" } }));
            return;
        }
        respondWithPlan(response);
    } catch (error) {
        contractError = error;
        response.writeHead(500).end("test contract failed");
    }
});
const server = createServer(async (request, response) => {
    try {
        if (/^https?:\/\//.test(request.url)) {
            response.writeHead(403).end("external requests blocked");
            return;
        }
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        if (multimodal && pathname === "/synthetic-video.mp4") { response.setHeader("Content-Type", "video/mp4"); response.end(await readFile(syntheticVideo)); return; }
        const target = pathname === "/" ? "test/fixtures/editor-assistant.html" : pathname.replace(/^\/+/, "");
        response.setHeader("Content-Type", target.endsWith(".html") ? "text/html; charset=utf-8" : target.endsWith(".js") ? "application/javascript" : target.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(join(fixtureDir, target)));
    } catch { response.writeHead(404).end("not found"); }
});
server.on("connect", (_request, socket) => socket.destroy());
await new Promise(done => relay.listen(0, "127.0.0.1", done));
await new Promise(done => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const relayURL = `http://127.0.0.1:${relay.address().port}`;
let browser;
let page;
const errors = [];
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe",
        proxy: { server: baseURL, bypass: "127.0.0.1" },
        args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"],
    });
    page = await browser.newPage({ viewport: { width: 900, height: 720 } });
    page.setDefaultTimeout(12_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${baseURL}/?relay=${encodeURIComponent(relayURL + "/api")}${multimodal ? "&multimodal=1" : ""}${director ? "&director=1" : ""}`);
    await page.waitForFunction(() => Boolean(window.editorAssistantHarness));
    assert.equal(await page.getByRole("combobox", { name: "选择文本对话模型" }).inputValue(), "assistant-test::gpt-6.1-sol");
    if (!director) {
        await page.getByRole("button", { name: "对话微调", exact: true }).click();
        await page.getByRole("checkbox", { name: "本地语音转写" }).uncheck();
    }
    const input = page.getByRole("textbox");
    if (director) {
        const original = await page.evaluate(() => window.editorAssistantHarness.project());
        await input.fill("剪成有情绪递进的剧情短剧，不截断对白");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.getByRole("button", { name: "应用并预览", exact: true }).waitFor();
        assert.equal(submissions, 2);
        assert.deepEqual(await page.evaluate(() => window.editorAssistantHarness.project()), original);
        assert.equal(await page.getByRole("list", { name: "成片镜头清单" }).getByRole("listitem").count(), 12);
        await page.screenshot({ path: join(outputDir, "director-plan.png") });
        await page.getByRole("button", { name: "应用并预览", exact: true }).click();
        await page.getByText("已应用「情绪递进剪辑」", { exact: false }).waitFor();
        const applied = await page.evaluate(() => window.editorAssistantHarness.project());
        await writeFile(join(outputDir, "director-timeline.json"), JSON.stringify(applied, null, 2));
        assert.equal(applied.clips.filter(clip => clip.kind === "video").length, 12);
        assert.equal(applied.clips.filter(clip => clip.kind === "subtitle").length, 12);
        assert.ok(applied.clips.filter(clip => clip.kind === "video").every(clip => clip.directMedia.storageKey === "resource:synthetic-video" && clip.volume > 0));
        await page.getByRole("button", { name: "撤销剪辑" }).click();
        assert.deepEqual(await page.evaluate(() => window.editorAssistantHarness.project()), original);
        await input.fill("重新构思完整剪辑方案");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.getByRole("button", { name: "应用并预览", exact: true }).waitFor();
        await page.evaluate(() => window.editorAssistantHarness.move());
        const changed = await page.evaluate(() => window.editorAssistantHarness.project());
        await page.getByRole("button", { name: "应用并预览", exact: true }).click();
        await page.getByText("时间线已变化，旧方案未应用。", { exact: false }).last().waitFor();
        assert.deepEqual(await page.evaluate(() => window.editorAssistantHarness.project()), changed);
        await page.getByRole("combobox", { name: "素材范围" }).selectOption("library");
        libraryPlan = true;
        await input.fill("使用媒体库中的完整视频制作成片");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.getByRole("button", { name: "应用并打开导出", exact: true }).waitFor();
        await page.getByRole("button", { name: "应用并打开导出", exact: true }).click();
        assert.equal(await page.evaluate(() => window.editorAssistantHarness.exportOpened()), 1);
        const library = await page.evaluate(() => window.editorAssistantHarness.project());
        assert.equal(library.clips.filter(clip => clip.kind === "video")[0].nodeId, "asset:library-video");
        await page.getByRole("combobox", { name: "剪辑风格" }).selectOption("montage");
        await page.getByRole("combobox", { name: "目标时长" }).selectOption("60000");
        await page.reload();
        assert.equal(await page.getByRole("combobox", { name: "剪辑风格" }).inputValue(), "montage");
        assert.equal(await page.getByRole("combobox", { name: "目标时长" }).inputValue(), "60000");
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.screenshot({ path: join(outputDir, "director-mobile.png") });
        assert.equal(contractError, undefined);
        assert.deepEqual(errors, []);
        const report = { passed: true, mode: "director", submissions, realGatewayRequests: 0, autoRepair: true, previewBeforeMutation: true, twelveShotAssembly: true, transcriptSubtitles: true, originalSound: true, atomicUndo: true, stalePlanRejected: true, librarySources: true, exportHandoff: true, settingsPersisted: true, narrowViewport: true, errors };
        await writeFile(join(outputDir, "director-result.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } else {
    await input.fill("将测试素材裁剪为五秒");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() => window.editorAssistantHarness.project().clips[0].durationMs === 5000);
    assert.equal(submissions, 1);
    assert.ok(preflights >= 1);
    assert.equal(await page.getByText("已提交 1 条指令：", { exact: false }).count(), 1);
    assert.equal(await page.locator("button .animate-spin").count(), 0);
    await page.screenshot({ path: join(outputDir, "assistant-connected.png") });
    if (multimodal) {
        const userContent = bodies[0].messages.at(-1).content;
        const images = userContent.filter(part => part.type === "image_url");
        assert.equal(images.length, 3);
        assert.ok(images.every(part => /^data:image\/jpeg;base64,/.test(part.image_url.url)));
        assert.equal(new Set(images.map(part => part.image_url.url)).size, 3);
        const context = JSON.stringify(userContent);
        assert.ok(context.includes("源时间 2000ms") && context.includes("时间线 0ms"));
        assert.ok(context.includes("音量检测"));
        assert.ok(!context.includes("/synthetic-video.mp4"));
        await page.getByRole("button", { name: "撤销剪辑" }).click();
        await page.waitForFunction(() => window.editorAssistantHarness.project().clips[0].durationMs === 10000);
    }
    failNext = true;
    await input.fill("继续裁剪测试素材");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "修正后重试" }).waitFor();
    assert.equal(await page.locator("button .animate-spin").count(), 0);
    assert.equal(await input.isEnabled(), true);
    await page.getByRole("button", { name: "修正后重试" }).click();
    await page.waitForFunction(() => document.querySelectorAll("button .animate-spin").length === 0);
    await page.getByText("已提交 1 条指令：", { exact: false }).nth(1).waitFor();
    assert.equal(submissions, 3);
    if (multimodal) {
        await page.getByRole("button", { name: "撤销剪辑" }).click();
        await page.waitForFunction(() => window.editorAssistantHarness.project().clips[0].durationMs === 10000);
        holdNext = true;
        await input.fill("测试停止分析");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes("模型正在分析"));
        while (!heldResponse) await new Promise(done => setTimeout(done, 30));
        await page.getByRole("button", { name: "停止分析" }).click();
        await page.getByText("已停止素材分析与模型请求，时间线未修改。", { exact: true }).waitFor();
        assert.equal(await input.isEnabled(), true);
        assert.equal(await page.locator("button .animate-spin").count(), 0);
        heldResponse.destroy(); heldResponse = undefined;
        holdNext = true;
        await input.fill("测试分析期间时间线变化");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        while (!heldResponse) await new Promise(done => setTimeout(done, 30));
        await page.evaluate(() => window.editorAssistantHarness.move());
        respondWithPlan(heldResponse); heldResponse = undefined;
        await page.getByText("分析期间时间线已变化，旧方案未应用，请重新分析。", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.editorAssistantHarness.project().clips[0].durationMs), 10000);
        assert.equal(await page.evaluate(() => window.editorAssistantHarness.project().clips[0].startMs), 1000);
        await page.evaluate(() => window.editorAssistantHarness.disableVision());
        await input.fill("测试缺少视觉能力");
        const before = submissions;
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.getByText("当前模型尚未开启看图能力。", { exact: false }).last().waitFor();
        assert.equal(submissions, before);
        await page.getByRole("checkbox", { name: "画面分析" }).uncheck();
        await page.getByRole("checkbox", { name: "本地语音转写" }).check();
        await page.reload();
        assert.equal(await page.getByRole("checkbox", { name: "画面分析" }).isChecked(), false);
        assert.equal(await page.getByRole("checkbox", { name: "本地语音转写" }).isChecked(), true);
        await page.getByRole("button", { name: "对话微调", exact: true }).click();
        await page.screenshot({ path: join(outputDir, "assistant-multimodal.png") });
        await input.fill("根据转写对白裁剪素材");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.waitForFunction(() => window.editorAssistantHarness.project().clips[0].durationMs === 5000);
        assert.equal(transcriptions, 1);
        assert.ok(JSON.stringify(bodies.at(-1)).includes("本地转写测试对白"));
        assert.ok(JSON.stringify(bodies.at(-1)).includes("0-6000ms"));
        await page.reload();
        await page.getByRole("button", { name: "对话微调", exact: true }).click();
        await input.fill("再次根据对白裁剪素材");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.waitForFunction(() => window.editorAssistantHarness.project().clips[0].durationMs === 5000);
        assert.equal(transcriptions, 1);
    }
    assert.equal(contractError, undefined);
    assert.deepEqual(errors, []);
    if (multimodal) assert.equal(transcriptions, 1);
    await page.screenshot({ path: join(outputDir, "assistant-retry.png") });
    const report = { passed: true, multimodal, preflights, submissions, realGatewayRequests: 0, corsFromDesktop: offline ? false : desktopURL.origin, timelineCommandApplied: true, retryRecovered: true, ...(multimodal ? { actualFramesSubmitted: 3, audioAnalyzed: true, singleUndo: true, cancellationRecovered: true, stalePlanRejected: true, capabilityGuard: true, preferencesRestored: true } : {}), errors };
    await writeFile(join(outputDir, multimodal ? "multimodal-result.json" : "result.json"), JSON.stringify(report, null, 2));
    if (multimodal) await writeFile(join(outputDir, "transcription-cache-result.json"), JSON.stringify({ passed: true, transcriptions, cacheReusedAfterReload: true, speechIncludedInPayload: true, realGatewayRequests: 0 }, null, 2));
    console.log(JSON.stringify(report));
    }
} catch (error) {
    await page?.screenshot({ path: join(outputDir, "assistant-failed.png") });
    console.error(JSON.stringify({ errors, preflights, submissions, contractError: contractError?.message, ui: await page?.locator("body").ariaSnapshot() }));
    throw error;
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
    await new Promise(done => relay.close(done));
}
