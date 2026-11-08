import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [url, mode] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
const browser = await chromium.launch({ headless: true, executablePath, timeout: 15000 });
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.goto(url + "?source=" + (mode.startsWith("remote") ? "remote" : ["local", "legacy"].includes(mode) ? mode : "owned"));
    await page.getByRole("button", { name: "加载音频波形", exact: true }).waitFor();
    if (mode === "waveform" || mode === "remote-waveform") {
        await page.getByRole("button", { name: "加载音频波形", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("canvas")?.width === 600);
        await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
        await page.locator("canvas").click({ position: { x: 300, y: 60 } });
        await page.waitForFunction(() => { const element = document.querySelector("audio"); return element && element.currentTime > 1.4 && element.currentTime < 1.6; });
        assert.equal(await page.locator("audio").evaluate(element => element.paused), true);
    } else {
        await page.getByRole("button", { name: "播放", exact: true }).click();
        if (mode === "retry") {
            await page.getByRole("button", { name: "重新读取本地音频", exact: true }).click();
            await page.waitForFunction(() => document.querySelector("audio")?.getAttribute("src")?.startsWith("blob:"));
            await page.getByRole("button", { name: "播放", exact: true }).click();
        }
        await page.waitForFunction(() => { const element = document.querySelector("audio"); return element && element.currentSrc.startsWith("blob:") && !element.paused && element.currentTime > 0; });
        await page.waitForFunction(() => document.querySelector("canvas")?.width === 600);
        if (mode === "owned" || mode === "remote") {
            await page.getByRole("button", { name: "暂停", exact: true }).click();
            const downloaded = page.waitForEvent("download");
            await page.getByRole("button", { name: "下载音轨", exact: true }).click();
            const file = await downloaded;
            assert.equal(file.suggestedFilename(), "测试歌曲.wav");
            const expected = await page.request.get(url + "fixture.wav");
            assert.deepEqual(readFileSync(await file.path()), await expected.body());
        }
    }
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.close();
} finally { await browser.close(); }
