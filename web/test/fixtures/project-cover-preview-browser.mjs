import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["dark", "light"]) {
        for (const width of [1280, 390]) {
            for (const view of ["settings", "list"]) {
                const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: "reduce" });
                const page = await context.newPage();
                const errors = [];
                const resourceRequests = [];
                page.on("pageerror", (error) => errors.push(error.message));
                page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/resources/")) resourceRequests.push(request); });
                await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
                try {
                    await page.goto(`${url}?theme=${theme}&view=${view}`);
                    const image = view === "settings" ? page.getByAltText("封面回归项目项目主图", { exact: true }) : page.locator(".project-library-cover-art");
                    await page.waitForFunction((selector) => { const img = document.querySelector(selector); return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 && img.currentSrc.startsWith("blob:"); }, view === "settings" ? 'img[alt="封面回归项目项目主图"]' : ".project-library-cover-art", { timeout: 10000 });
                    assert.equal(await image.evaluate((img) => img.naturalWidth), 320);
                    if (view === "settings") {
                        await page.getByRole("button", { name: "替换主图", exact: true }).click();
                        await page.getByText("项目素材封面", { exact: true }).waitFor();
                        for (const title of ["当前项目主图", "项目素材封面"]) {
                            const thumbnail = page.getByAltText(title, { exact: true });
                            await thumbnail.waitFor();
                            await thumbnail.scrollIntoViewIfNeeded();
                            await page.waitForFunction((alt) => { const img = [...document.images].find((entry) => entry.alt === alt); return img?.complete && img.naturalWidth === 320 && img.currentSrc.startsWith("blob:"); }, title, { timeout: 10000 });
                        }
                        await page.keyboard.press("Escape");
                        await page.getByRole("dialog").waitFor({ state: "hidden" });
                        await page.getByRole("button", { name: "测试替换封面", exact: true }).click();
                        await page.waitForFunction(() => { const img = document.querySelector('img[alt="封面回归项目项目主图"]'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth === 640; });
                    }
                    const bounds = await image.boundingBox();
                    assert.ok(bounds && bounds.width > 100 && bounds.height > 50 && bounds.width <= width, "cover must stay visible at this viewport");
                    assert.ok(resourceRequests.length > 0, "cold cache must fetch the protected resource");
                    for (const request of resourceRequests) {
                        assert.equal(request.headers()["x-desktop-token"], "offline-cover-test", "cover must use the authenticated media client");
                        assert.equal(new URL(request.url()).searchParams.get("proxy"), "1");
                    }
                    await page.screenshot({ path: join(artifactDir, `${theme}-${width}-${view}.png`) });
                    if (view === "settings") {
                        await page.getByRole("button", { name: "测试失效封面", exact: true }).click();
                        await page.getByText("主图加载失败", { exact: true }).waitFor();
                        assert.equal(await image.count(), 0, "unavailable covers must show a readable fallback");
                    }
                    assert.deepEqual(errors, []);
                    console.log(`PASS ${theme} ${width}px ${view}: decoded authenticated cover${view === "settings" ? ", picker thumbnails, replacement and failure fallback" : ""}`);
                } catch (error) {
                    await page.screenshot({ path: join(artifactDir, "failure.png") });
                    console.error(JSON.stringify({ view, theme, width, errors, requests: resourceRequests.map((request) => ({ url: request.url(), authenticated: request.headers()["x-desktop-token"] === "offline-cover-test" })), artifactDir }));
                    throw error;
                } finally { await context.close(); }
            }
        }
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
