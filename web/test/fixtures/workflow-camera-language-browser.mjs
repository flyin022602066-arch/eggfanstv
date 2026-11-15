import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("cameraCase", "true");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
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
        if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], tasks: [], total: 0 }, msg: "" } });
        return route.continue();
    });
    await page.goto(url.toString());
    assert.equal(new URL(page.url()).origin, url.origin);
    assert.ok((await page.locator("body").innerText()).includes("镜头语言"));
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    const fields = ["shotSize", "cameraAngle", "cameraMovement"];
    const expectCamera = async (expected) => {
        for (const [index, field] of fields.entries()) {
            await page.waitForFunction(({ field, expected }) => {
                const element = document.getElementById(field)?.closest(".ant-select");
                return expected ? element?.textContent?.includes(expected) : element?.textContent?.includes("随逐镜脚本");
            }, { field, expected: expected[index] }, { timeout: 5000 });
        }
    };
    await expectCamera(["大特写", "过肩", "跟拍"]);
    await page.getByRole("button", { name: "shot-b", exact: true }).click();
    await expectCamera(["中景 → 特写", "平视 → 俯拍", "推镜 → 固定"]);
    await page.locator("#cameraMovement").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").getByText("拉镜", { exact: true }).click();
    await expectCamera(["中景 → 特写", "平视 → 俯拍", "拉镜"]);
    await page.getByRole("button", { name: "模拟任务完成", exact: true }).click();
    await expectCamera(["中景 → 特写", "平视 → 俯拍", "拉镜"]);
    for (const shot of ["c", "empty"]) {
        await page.getByRole("button", { name: "shot-" + shot, exact: true }).click();
        await expectCamera(["", "", ""]);
    }
    for (const shot of ["a", "b", "a", "b"]) {
        await page.getByRole("button", { name: "shot-" + shot, exact: true }).click();
        await expectCamera(shot === "a" ? ["大特写", "过肩", "跟拍"] : ["中景 → 特写", "平视 → 俯拍", "推镜 → 固定"]);
    }
    for (const theme of ["light", "dark"]) {
        const themed = new URL(url);
        themed.searchParams.set("theme", theme);
        await page.goto(themed.toString());
        await page.getByRole("button", { name: "shot-b", exact: true }).click();
        await expectCamera(["中景 → 特写", "平视 → 俯拍", "推镜 → 固定"]);
        await page.locator("#shotSize").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(tmpdir(), "eggfans-shot-camera-" + theme + ".png") });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], "camera inspection must not submit generation tasks or write real project data");
    console.log("PASS camera fields: explicit values, legacy fallback, different internal shots, repeated switching, empty shots, manual choice survives task refresh, light/dark rendering; no generation or remote calls");
} finally {
    await browser.close();
}
