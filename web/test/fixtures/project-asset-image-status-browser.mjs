import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const [url, artifacts] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 10000 });
try {
    for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(6000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
        await page.goto(`${url}?theme=${theme}`);
        try {
            await page.getByText("正在检测图片任务", { exact: true }).waitFor();
            await page.getByText("图片任务状态已同步", { exact: true }).waitFor();
            const details = page.locator("section>details");
            assert.equal(await details.getAttribute("open"), null);
            await details.locator("summary").first().click();
            const interrupted = page.getByRole("article").filter({ hasText: "任务 interrupted" });
            await interrupted.getByText("响应中断，结果未确认", { exact: true }).waitFor();
            assert.equal(await interrupted.locator("details.generation-failure-log").getAttribute("open"), null);
            await interrupted.getByRole("button", { name: /检查并取回/ }).click();
            await interrupted.getByText("未保留完整图片结果，无法补查；不会重新提交生成。", { exact: true }).waitFor();
            await page.evaluate(() => window.imageStatus.transfer());
            await page.getByText("正在取回图片", { exact: true }).waitFor();
            await page.evaluate(() => window.imageStatus.disconnect());
            await page.getByText("状态检测中断", { exact: true }).waitFor();
            await page.getByRole("button", { name: /刷新任务状态/ }).click();
            await page.getByText("图片任务状态已同步", { exact: true }).waitFor();
            assert.deepEqual(errors, []);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.screenshot({ path: `${artifacts}/${theme}-${width}.png`, fullPage: true });
            console.log(`PASS image status ${theme}/${width}: detection, transfer, interrupted query-only recovery, reconnect and collapsed logs`);
        } catch (error) {
            console.log(JSON.stringify({ theme, width, errors, body: await page.locator("body").innerText() }));
            await page.screenshot({ path: `${artifacts}/failure-${theme}-${width}.png`, fullPage: true });
            throw error;
        } finally { await page.close(); }
    }
} finally { await browser.close(); }
