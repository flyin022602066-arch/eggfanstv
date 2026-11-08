import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const report = ["摄影机位与镜头设计", "人物表演与调度", "光影连续性"].map((skillName, index) => ({ skillId: "skill-" + index, skillName, version: "1.0", status: "loaded", files: ["SKILL.md", "references/camera.md"], truncated: false }));
const task = { id: "chapter-task", projectId: "preview-project", type: "canvas_text", status: "succeeded", attempts: 1,
    createdAt: "2026-11-01T01:00:00Z", updatedAt: "2026-11-01T01:00:00Z", prompt: "",
    clientContext: { chapterId: "preview-chapter", chapterOperation: "storyboard" }, inputJson: JSON.stringify({ metadata: { skillLoadReport: report } }) };
try {
    for (const theme of ["dark", "light"]) for (const width of [1600, 900, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        const writes = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.route("**/*", (route) => {
            const request = route.request();
            const target = new URL(request.url());
            if (target.origin !== new URL(url).origin) { errors.push("unexpected external request"); return route.abort(); }
            if (request.method() !== "GET") { writes.push(request.method() + " " + target.pathname); return route.abort(); }
            if (target.pathname === "/api/tasks") return route.fulfill({ json: { code: 0, data: [task], msg: "" } });
            if (target.pathname === "/api/tasks/chapter-task") return route.fulfill({ json: { code: 0, data: task, msg: "" } });
            if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], total: 0 }, msg: "" } });
            return route.continue();
        });
        await page.goto(url + "?theme=" + theme);
        assert.equal(await page.title(), "Eggfans TV skill sidebar test");
        assert.ok((await page.locator("body").innerText()).includes("镜头脚本"));
        assert.equal(await page.locator("vite-error-overlay").count(), 0);
        const status = page.locator(width > 760 ? ".workflow-preview-panel .chapter-skill-status" : ".workflow-mobile-skill-status .chapter-skill-status");
        await status.getByText("已加载 3 项", { exact: true }).waitFor();
        if (width > 760) assert.equal(await page.locator(".workflow-shot-editor .chapter-skill-status").isVisible(), false, "skill status must not take editor space");
        assert.equal(await status.locator("details").evaluate((element) => element.open), false);
        assert.ok((await status.boundingBox()).height <= 100, "collapsed summary must remain small");
        await status.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-collapsed.png`) });
        await status.locator("summary").focus();
        await page.keyboard.press("Enter");
        await status.getByText("摄影机位与镜头设计", { exact: true }).waitFor();
        await status.scrollIntoViewIfNeeded();
        const bounds = await status.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "skill report must fit the rail or narrow viewport");
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-expanded.png`) });
        await status.locator("summary").click();
        assert.equal(await status.getByText("摄影机位与镜头设计", { exact: true }).isVisible(), false);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, "no page horizontal overflow");
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, [], "status interaction must not submit generation tasks");
        await page.close();
        console.log(`PASS ${theme}/${width}: sidebar placement, compact summary, keyboard expand/collapse, no generation`);
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
