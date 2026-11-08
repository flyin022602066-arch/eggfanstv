import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["dark", "light"]) for (const width of [2560, 1920, 1200, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1200 } });
        const errors = [];
        const writes = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
            const request = route.request();
            const target = new URL(request.url());
            if (target.origin !== new URL(url).origin) { errors.push("unexpected external request"); return route.abort(); }
            if (request.method() !== "GET") { writes.push(request.method() + " " + target.pathname); return route.abort(); }
            if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], tasks: [], shots: [], shotRevisions: [], shotReferences: [], shotArtifacts: [], versions: [], total: 0 }, msg: "" } });
            return route.continue();
        });
        await page.goto(url + `?theme=${theme}&assetCase=ready&layout=long`);
        const editor = page.locator(".workflow-shot-editor");
        const script = editor.locator(".workflow-shot-script-column");
        const settings = editor.locator(".workflow-shot-settings-column");
        const generation = settings.locator("details").filter({ has: page.getByText("生成设置", { exact: true }) });
        const supplement = script.locator("details").filter({ has: page.getByText("生成补充", { exact: true }) });
        const finalPrompt = editor.locator("details").filter({ has: page.getByText("最终提交提示词", { exact: true }) });
        const prompt = finalPrompt.getByRole("textbox", { name: "最终提交提示词全文" });
        await prompt.waitFor();
        await page.waitForFunction(() => {
            const value = document.querySelector('textarea[aria-label="最终提交提示词全文"]')?.value || "";
            return value.includes("镜头12") && value.includes("手掌松开") && value.includes("同伴");
        });
        assert.equal(await settings.getByRole("textbox", { name: "最终提交提示词全文" }).count(), 1, "the editable final prompt belongs directly under generation settings");
        assert.equal(await supplement.count(), 1, "generation supplements stay in the script column");
        const gap = await finalPrompt.evaluate((element) => {
            const settingsPanel = element.previousElementSibling;
            return element.getBoundingClientRect().top - settingsPanel.getBoundingClientRect().bottom;
        });
        assert.ok(gap >= 0 && gap <= 24, `settings and final prompt must be adjacent, actual gap ${gap}`);
        const bounds = await Promise.all([script.boundingBox(), settings.boundingBox(), generation.boundingBox(), finalPrompt.boundingBox()]);
        if (width >= 1920) {
            assert.ok(bounds[1].x > bounds[0].x + bounds[0].width, "script and settings retain two columns");
            assert.ok(bounds[3].y < bounds[0].y + bounds[0].height - 100, "a long script must not push the right-hand final prompt to its bottom");
        } else {
            assert.ok(bounds[1].y >= bounds[0].y + bounds[0].height - 1, "narrow screens stack the columns without overlap");
        }
        const original = await prompt.inputValue();
        await prompt.fill(original + "\n保留用户手动修改。");
        await generation.locator(":scope > summary").click();
        assert.ok((await prompt.inputValue()).endsWith("保留用户手动修改。"), "collapsing settings must preserve prompt edits");
        await generation.locator(":scope > summary").click();
        await finalPrompt.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-editor-layout.png`) });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, "no horizontal page overflow");
        await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
        assert.equal(await editor.getByText("最终提交提示词", { exact: true }).count(), 0, "image stages do not show a video prompt editor");
        assert.equal(await supplement.count(), 1, "image stages retain generation supplements");
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, [], "layout interactions never submit or alter tasks");
        await page.close();
        console.log(`PASS ${theme}/${width}: adjacent final prompt, supplements, editable text, collapse, image stage, no generation`);
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
