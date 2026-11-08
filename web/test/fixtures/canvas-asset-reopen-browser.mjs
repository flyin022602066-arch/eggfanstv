import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const [url, surface] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    const context = await browser.newContext({ viewport: { width: surface === "search" ? 1280 : 390, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(error.message));
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console.error(message.text()); });
    page.on("requestfailed", (request) => console.error(request.url(), request.failure()?.errorText));
    for (const theme of ["light", "dark"]) {
        await page.goto(url);
        await page.evaluate((theme) => { localStorage.setItem("reopen-theme", theme); }, theme);
        await page.reload();
        await page.evaluate((theme) => { document.documentElement.className = theme; }, theme);
        if (surface === "search") await page.getByRole("button", { name: "Search nodes" }).click();
        const selector = surface === "character" ? '[data-testid="character"] img' : surface === "mentions" ? '[data-testid="mentions"] img' : '[role="dialog"] img';
        await page.waitForFunction(({ selector, count }) => {
            const images = Array.from(document.querySelectorAll(selector));
            return images.length === count && images.every((image) => image.complete && image.naturalWidth === 32 && image.src.startsWith("blob:"));
        }, { selector, count: surface === "character" ? 1 : 3 }, { timeout: 6000 }).catch(async (error) => {
            console.error(JSON.stringify(await page.locator("img").evaluateAll((images) => images.map((image) => ({ src: image.src, width: image.naturalWidth, complete: image.complete })))));
            throw error;
        });
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("asset-reopen-nodes"))[0].metadata.characterCoverUrl), "http://127.0.0.1:9/api/resources/character-cover/file");
    }
} finally { await browser.close(); }
