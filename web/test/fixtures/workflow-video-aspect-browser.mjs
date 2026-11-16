import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2];
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const writes = [];
    let media = {};
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== new URL(url).origin) return route.abort();
        if (request.method() !== "GET") {
            writes.push(request.method() + " " + target.pathname);
            return route.abort();
        }
        const fixture = Object.keys(media).find((name) => target.pathname.includes(name));
        if (fixture) return route.fulfill({ contentType: "video/webm", body: Buffer.from(media[fixture], "base64") });
        if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], versions: [], revision: 1, shots: [], shotRevisions: [], shotArtifacts: [], shotReferences: [], skills: [], tasks: [], total: 0 }, msg: "" } });
        return route.continue();
    });
    await page.goto(url);
    media = await page.evaluate(async () => {
        const result = {};
        for (const [name, width, height] of [["portrait-video", 180, 320], ["landscape-video", 320, 180]]) {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            const stream = canvas.captureStream(10);
            const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
            const chunks = [];
            recorder.ondataavailable = (event) => chunks.push(event.data);
            const done = new Promise((resolve) => { recorder.onstop = resolve; });
            recorder.start();
            for (let frame = 0; frame < 5; frame++) {
                context.fillStyle = "#161b32";
                context.fillRect(0, 0, width, height);
                context.fillStyle = "#ef4444";
                context.fillRect(0, 0, width, 30);
                context.fillStyle = "#22c55e";
                context.fillRect(0, height - 30, width, 30);
                context.fillStyle = "white";
                context.font = "18px sans-serif";
                context.fillText("FULL FRAME", 24, height / 2);
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            recorder.stop();
            await done;
            stream.getTracks().forEach((track) => track.stop());
            const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
            result[name] = btoa(String.fromCharCode(...bytes));
        }
        return result;
    });
    const scenario = new URL(url);
    scenario.searchParams.set("videoCase", "aspect");
    const directory = resolve(import.meta.dirname, "../../../output/playwright/workflow-video-aspect");
    mkdirSync(directory, { recursive: true });
    for (const theme of ["light", "dark"]) {
        scenario.searchParams.set("theme", theme);
        await page.goto(scenario.toString());
        await page.addStyleTag({ url: new URL("/workflow.css", url).toString() });
        await page.addStyleTag({ content: "html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}nav{flex:none}.workflow-production-shell{flex:1;min-height:0}:root{--workspace-surface:#fff;--workspace-content:#f7f8fa;--foreground:#151515;--workspace-border:#ddd;--r-lg:8px}.dark{--workspace-surface:#171717;--workspace-content:#111;--foreground:#fff;--workspace-border:#444}" });
        for (const [shot, orientation] of [["a", "portrait"], ["b", "landscape"], ["a", "portrait"]]) {
            await page.getByRole("button", { name: "shot-" + shot, exact: true }).click();
            await page.getByRole("button", { name: "点击播放镜头视频", exact: true }).click();
            const video = page.locator("video.workflow-preview-media");
            await video.waitFor();
            await page.waitForFunction(() => document.querySelector("video.workflow-preview-media")?.readyState >= 2);
            const state = await video.evaluate((element) => {
                element.pause();
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return { fit: style.objectFit, aspect: style.aspectRatio, width: box.width, height: box.height, nativeWidth: element.videoWidth, nativeHeight: element.videoHeight };
            });
            assert.equal(state.fit, "contain", "preview must never crop reference frame edges");
            assert.equal(state.aspect, "auto", "preview must use the media's actual aspect ratio");
            assert.equal(state.nativeWidth / state.nativeHeight, orientation === "portrait" ? 9 / 16 : 16 / 9);
            assert.ok(orientation === "portrait" ? state.height > state.width : state.width > state.height, JSON.stringify(state));
            await video.screenshot({ path: resolve(directory, theme + "-" + orientation + "-preview.png") });
            await video.evaluate((element) => {
                element.addEventListener("click", () => void element.requestFullscreen(), { once: true });
            });
            await video.click({ position: { x: 20, y: 20 } });
            await page.waitForFunction(() => document.fullscreenElement === document.querySelector("video.workflow-preview-media"));
            const fullscreen = await video.evaluate((element) => {
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return { fit: style.objectFit, maxHeight: style.maxHeight, width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
            });
            assert.equal(fullscreen.fit, "contain", "fullscreen must show both top and bottom frame markers");
            assert.equal(fullscreen.maxHeight, "none");
            assert.ok(Math.abs(fullscreen.width - fullscreen.viewportWidth) <= 1 && Math.abs(fullscreen.height - fullscreen.viewportHeight) <= 1, JSON.stringify(fullscreen));
            await page.screenshot({ path: resolve(directory, theme + "-" + orientation + "-fullscreen.png") });
            await page.evaluate(() => document.exitFullscreen());
            await page.waitForFunction(() => !document.fullscreenElement);
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log("PASS portrait/landscape preview, native fullscreen, repeated shot switching, light/dark themes; zero writes or remote calls");
} finally {
    await browser.close();
}
