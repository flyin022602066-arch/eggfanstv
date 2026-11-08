import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
const [url, mode] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(6000);
        await page.request.get(url + "fixture/reset" + (mode === "failure" ? "?failure=1" : ""));
        page.on("pageerror", (error) => console.error(error.message));
        await page.goto(url + "?theme=" + theme);
        await page.getByRole("button", { name: "查看素材：Public script", exact: true }).waitFor({ timeout: 10000 });
        if (mode === "scope" || mode === "project-scope") {
            await page.getByRole("button", { name: mode === "scope" ? "Open picker" : "Open project assets", exact: true }).click();
            const dialog = page.getByRole("dialog");
            await dialog.getByText("A script", { exact: true }).waitFor();
            assert.equal(await dialog.getByText("A sibling", { exact: true }).count(), 1);
            assert.equal(await dialog.getByText("B script", { exact: true }).count(), 0);
            assert.equal(await dialog.getByText("Public script", { exact: true }).count(), 0);
            await page.keyboard.press("Escape");
            await page.getByRole("button", { name: "Switch project" }).click();
            await page.getByRole("button", { name: mode === "scope" ? "Open picker" : "Open project assets", exact: true }).click();
            await dialog.getByText("B script", { exact: true }).waitFor();
            assert.equal(await dialog.getByText("A script", { exact: true }).count(), 0);
            assert.equal(await dialog.getByText("A sibling", { exact: true }).count(), 0);
            assert.equal(await dialog.getByText("Public script", { exact: true }).count(), 0);
        } else if (mode === "tray-scope") {
            await page.getByRole("button", { name: /打开素材空间/ }).click();
            const tray = page.locator("[data-canvas-asset-tray]");
            await tray.getByText("A script", { exact: true }).waitFor();
            assert.equal(await tray.getByText("A sibling", { exact: true }).count(), 1);
            assert.equal(await tray.getByText("B script", { exact: true }).count(), 0);
            assert.equal(await tray.getByText("Public script", { exact: true }).count(), 0);
            await page.getByRole("button", { name: "Switch project" }).click();
            await tray.getByText("B script", { exact: true }).waitFor();
            assert.equal(await tray.getByText("A script", { exact: true }).count(), 0);
        } else if (mode === "mentions-scope") {
            const textbox = page.getByRole("textbox", { name: "Scoped mentions" });
            await textbox.click();
            await textbox.pressSequentially("@script");
            const menu = page.locator("[data-canvas-resource-mention-menu]");
            await menu.getByText("A script", { exact: true }).waitFor();
            assert.equal(await menu.getByText("B script", { exact: true }).count(), 0);
            assert.equal(await menu.getByText("Public script", { exact: true }).count(), 0);
        } else {
            const card = page.locator(".asset-library-card").filter({ has: page.getByRole("button", { name: "查看素材：Public script", exact: true }) });
            const more = card.getByRole("button", { name: "更多素材操作" });
            await more.click();
            await page.getByRole("menuitem", { name: "永久删除" }).click();
            await page.getByRole("button", { name: /取\s*消/, exact: true }).click();
            assert.deepEqual((await (await page.request.get(url + "fixture/state")).json()).deleted, []);
            await more.click();
            await page.getByRole("menuitem", { name: "永久删除" }).click();
            await page.getByRole("button", { name: "永久删除", exact: true }).click();
            if (mode === "failure") {
                await page.getByText("Fixture asset is referenced by canvas B", { exact: true }).waitFor({ timeout: 5000 });
                assert.equal(await page.getByRole("button", { name: "查看素材：Public script", exact: true }).count(), 1);
                await page.reload();
                await page.getByRole("button", { name: "查看素材：Public script", exact: true }).waitFor({ timeout: 6000 });
            } else {
                await page.getByRole("button", { name: "查看素材：Public script", exact: true }).waitFor({ state: "detached", timeout: 5000 });
                await page.reload();
                await page.getByRole("button", { name: "查看素材：A script", exact: true }).waitFor();
                assert.equal(await page.getByRole("button", { name: "查看素材：Public script", exact: true }).count(), 0);
            }
            assert.deepEqual((await (await page.request.get(url + "fixture/state")).json()).deleted, ["Public script"]);
        }
        await page.close();
    }
} finally { await browser.close(); }
