import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("ratioCase", "true");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin) return route.abort();
        if (request.method() !== "GET") {
            writes.push(request.method() + " " + target.pathname);
            return route.abort();
        }
        if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], versions: [], revision: 1, shots: [], shotRevisions: [], shotArtifacts: [], shotReferences: [], skills: [], tasks: [], total: 0 }, msg: "" } });
        return route.continue();
    });
    const ratio = page.locator(".ant-form-item").filter({ has: page.locator("label").filter({ hasText: /^画幅$/u }) }).getByRole("combobox");
    const expectRatio = async (expected) => {
        await ratio.waitFor();
        await page.waitForFunction((expected) => [...document.querySelectorAll(".ant-form-item")].find((element) => element.querySelector("label")?.textContent === "画幅")?.querySelector(".ant-select")?.textContent?.includes(expected), expected, { timeout: 5000 });
    };
    await page.goto(url.toString());
    await expectRatio("9:16");
    await ratio.click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").getByText("16:9", { exact: true }).click();
    await expectRatio("16:9");
    await page.getByRole("button", { name: "下个镜头", exact: true }).click();
    await expectRatio("16:9");
    await page.getByRole("button", { name: "下一章", exact: true }).click();
    await expectRatio("16:9");
    await page.reload();
    await expectRatio("16:9");
    await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
    await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
    await expectRatio("16:9");
    await page.getByRole("button", { name: "切换项目", exact: true }).click();
    await expectRatio("9:16");
    await page.getByRole("button", { name: "切换项目", exact: true }).click();
    await expectRatio("16:9");
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log("PASS Hanbao ratio survives shot/chapter switching, reload and stage changes; projects remain isolated; no generation or remote calls");
} finally {
    await browser.close();
}
