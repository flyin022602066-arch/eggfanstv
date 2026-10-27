import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(webDir, "..");
const outputDir = join(rootDir, "output/playwright/video-playback");
const bundleDir = join(rootDir, ".local/cache/video-playback-ui");
const original = await readFile(process.argv[2]);
const compatible = await readFile(process.argv[3]);
await mkdir(outputDir, { recursive: true });
await build({ configFile: join(webDir, "vite.config.ts"), root: webDir, logLevel: "error", build: {
    outDir: bundleDir, emptyOutDir: true, rolldownOptions: { input: join(webDir, "test/fixtures/canvas-video-playback.html") },
} });
let variantDownloads = 0;
let originalDownloads = 0;
let failVariant = false;
let corruptVariant = false;
let requestError;
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname === "/original.mp4") { response.setHeader("Content-Type", "video/mp4"); response.end(original); return; }
        if (url.pathname === "/api/resources/video") {
            assert.equal(request.headers["x-desktop-token"], "synthetic-desktop-token");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ code: 0, data: { resource: { id: "video", kind: "video", playbackStatus: "ready" } }, msg: "" })); return;
        }
        if (url.pathname === "/api/resources/video/file") {
            assert.equal(request.headers["x-desktop-token"], "synthetic-desktop-token");
            if (url.searchParams.get("variant") === "playback") {
                variantDownloads++;
                if (failVariant) { response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ code: 503, msg: "本地播放副本暂不可用" })); return; }
                response.setHeader("Content-Type", "video/mp4"); response.end(corruptVariant ? Buffer.from("invalid video") : compatible);
            } else { originalDownloads++; response.setHeader("Content-Type", "video/mp4"); response.end(original); }
            return;
        }
        if (url.pathname.startsWith("/api/")) { response.writeHead(404).end("unexpected API request"); return; }
        const path = url.pathname === "/" ? "test/fixtures/canvas-video-playback.html" : url.pathname.slice(1);
        response.setHeader("Content-Type", path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream");
        response.end(await readFile(join(bundleDir, path)));
    } catch (error) { requestError = error; response.writeHead(500).end("test failed"); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 760, height: 480 } });
await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
try {
    const page = await context.newPage();
    await page.goto(baseURL);
    await page.getByTestId("video-node").hover();
    await page.waitForTimeout(1_000);
    assert.equal(await page.locator("video").count(), 0, "Hovering a video node must keep its static poster until Play is clicked");
    await page.getByRole("button", { name: "编辑其他节点 0" }).click();
    await page.getByTestId("video-node").hover();
    await page.waitForTimeout(1_000);
    assert.equal(await page.locator("video").count(), 0, "Editing another node must not activate a video preview");
    await page.getByRole("button", { name: "播放 本地视频播放测试" }).click();
    await page.waitForFunction(() => {
        const video = document.querySelector("video:not([data-canvas-hover-preview])");
        return video && video.videoWidth === 1280 && video.currentTime > 0.5 && !video.paused && video.getVideoPlaybackQuality().totalVideoFrames > 0;
    }, { timeout: 30_000 });
    const playback = await page.evaluate(() => {
        const video = document.querySelector("video:not([data-canvas-hover-preview])");
        let visible = true;
        for (let parent = video; parent; parent = parent.parentElement) if (getComputedStyle(parent).opacity === "0") visible = false;
        return { width: video.videoWidth, height: video.videoHeight, currentTime: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, visible };
    });
    assert.ok(playback.visible);
    assert.equal(originalDownloads, 0);
    assert.equal(variantDownloads, 1);
    await page.screenshot({ path: join(outputDir, "playing.png") });
    await page.locator(".vds-play-button").click();
    await page.waitForFunction(() => document.querySelector("video")?.paused);
    const pausedTime = await page.locator("video").evaluate(video => video.currentTime);
    await page.getByRole("button", { name: "编辑其他节点 1" }).click();
    await page.getByTestId("video-node").hover();
    await page.locator("video").evaluate(video => video.dispatchEvent(new Event("canplay")));
    await page.waitForTimeout(1_000);
    const pausedAfterEdit = await page.locator("video").evaluate(video => ({ paused: video.paused, currentTime: video.currentTime }));
    assert.ok(pausedAfterEdit.paused, "Editing another node must preserve a manual pause");
    assert.ok(Math.abs(pausedAfterEdit.currentTime - pausedTime) < 0.1);
    failVariant = true;
    const failureContext = await browser.newContext({ viewport: { width: 760, height: 480 } });
    await failureContext.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const failurePage = await failureContext.newPage();
    await failurePage.goto(baseURL);
    await failurePage.getByRole("button", { name: "播放 本地视频播放测试" }).click();
    await failurePage.getByRole("alert").waitFor();
    assert.equal(await failurePage.getByRole("status").count(), 0);
    failVariant = false;
    await failurePage.getByRole("button", { name: "重试播放" }).click();
    await failurePage.waitForFunction(() => document.querySelector("video:not([data-canvas-hover-preview])")?.currentTime > 0.5);
    assert.equal(await failurePage.getByRole("alert").count(), 0);
    assert.equal(requestError, undefined);
    corruptVariant = true;
    const corruptContext = await browser.newContext();
    await corruptContext.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const corruptPage = await corruptContext.newPage();
    await corruptPage.goto(baseURL);
    await corruptPage.getByRole("button", { name: "播放 本地视频播放测试" }).click();
    await corruptPage.getByRole("alert").waitFor({ timeout: 5_000 }).catch(async (error) => {
        await corruptPage.screenshot({ path: join(outputDir, "decode-failure-debug.png") });
        console.log(JSON.stringify(await corruptPage.evaluate(() => ({ text: document.body.innerText, videos: Array.from(document.querySelectorAll("video")).map(video => ({ src: video.currentSrc, readyState: video.readyState, networkState: video.networkState, paused: video.paused, error: video.error?.code, html: video.outerHTML })), players: Array.from(document.querySelectorAll(".canvas-video-player")).map(player => ({ html: player.outerHTML.slice(0, 1500) })) }))));
        throw error;
    });
    assert.ok((await corruptPage.getByRole("alert").textContent()).includes("视频解码失败"));
    assert.equal(await corruptPage.getByRole("status").count(), 0);
    await corruptPage.getByRole("button", { name: "重试播放" }).click();
    await corruptPage.getByRole("alert").waitFor();
    assert.equal(await corruptPage.getByRole("status").count(), 0);
    await corruptContext.close();
    await writeFile(join(outputDir, "result.json"), JSON.stringify({ passed: true, playback, originalDownloads, variantDownloads, hoverKeepsPoster: true, unrelatedEditsDoNotPlay: true, manualPausePreserved: true, desktopAuthVerified: true, failureStopsLoading: true, retrySucceeded: true, decodeErrorVisible: true }, null, 2));
    await failureContext.close();
    console.log(JSON.stringify({ passed: true, playback, hoverKeepsPoster: true, unrelatedEditsDoNotPlay: true, manualPausePreserved: true, failureStopsLoading: true, retrySucceeded: true, decodeErrorVisible: true }));
} finally { await context.close(); await browser.close(); await new Promise(done => server.close(done)); }
