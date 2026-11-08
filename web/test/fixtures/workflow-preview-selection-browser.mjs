import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2];
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    const page = await browser.newPage();
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== new URL(url).origin) return route.abort();
        if (request.method() !== "GET") {
            writes.push(request.method() + " " + target.pathname);
            return route.abort();
        }
        if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], tasks: [], total: 0 }, msg: "" } });
        return route.continue();
    });
    await page.goto(url);
    const panel = page.locator(".workflow-preview-panel");
    const cards = panel.locator(".workflow-video-task-info");
    async function checkTask(shot, version = "latest") {
        await panel.getByText("api-shot-" + shot + "-" + version, { exact: true }).waitFor({ timeout: 5000 }).catch(async (error) => {
            throw new Error(error.message + "\nBrowser errors: " + JSON.stringify(errors) + "\nPage: " + (await page.locator("body").innerText()).slice(0, 5000));
        });
        assert.equal(await cards.count(), 1, "only the selected shot may have a task card: " + shot + "/" + version);
        const text = await cards.innerText();
        assert.ok(text.includes("shot-" + shot + "-" + version));
        for (const other of ["a", "b", "c"].filter((name) => name !== shot)) assert.ok(!text.includes("shot-" + other + "-"), "another shot's ID must not remain");
    }
    await checkTask("a");
    for (const shot of ["b", "c", "a", "b", "a"]) {
        await page.getByRole("button", { name: "shot-" + shot, exact: true }).click();
        await checkTask(shot);
    }
    await panel.locator(".workflow-history.is-compact button").last().click();
    await checkTask("a", "old");
    await page.getByRole("button", { name: "shot-b", exact: true }).click();
    await checkTask("b");
    await page.getByRole("button", { name: "shot-empty", exact: true }).click();
    assert.equal(await cards.count(), 0, "taskless shots must clear the old task card");
    await page.getByRole("button", { name: "shot-c", exact: true }).click();
    await checkTask("c");
    await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
    assert.equal(await cards.count(), 0, "image stages must not retain video task cards");
    await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
    await checkTask("c");
    await page.getByRole("button", { name: "模拟任务完成", exact: true }).click();
    for (const shot of ["b", "a", "c"]) {
        await page.getByRole("button", { name: "shot-" + shot, exact: true }).click();
        await checkTask(shot);
    }
    for (const assetCase of ["missing", "unbound", "ready"]) {
        const scenario = new URL(url);
        scenario.searchParams.set("assetCase", assetCase);
        await page.goto(scenario.toString());
        const finalPrompt = page.getByText("最终提交提示词", { exact: true }).locator("xpath=ancestor::details[1]");
        const assets = page.locator(".workflow-bound-assets");
        if (assetCase === "missing") {
            await assets.getByText("待补参考图", { exact: true }).waitFor();
            assert.equal(await assets.getByLabel("修复镜头资产引用").count(), 0, "missing pictures do not make existing bindings unresolved");
            await finalPrompt.getByText("资产参考待完善", { exact: true }).waitFor();
            assert.ok(!(await finalPrompt.innerText()).includes("fixture-scene"), "final prompt panel must not contain internal asset diagnostics");
            assert.ok(!(await finalPrompt.innerText()).includes("替换为已绑定资产"));
        } else if (assetCase === "unbound") {
            const repair = assets.getByLabel("修复镜头资产引用");
            await repair.waitFor({ state: "attached" });
            const disclosure = repair.locator("xpath=ancestor::details[1]");
            assert.equal(await disclosure.getAttribute("open"), null, "repair details are collapsed by default");
            await disclosure.locator(":scope > summary").click();
            await repair.getByText("训练护具", { exact: true }).waitFor();
            assert.equal(await finalPrompt.getByLabel("修复镜头资产引用").count(), 0);
            assert.ok(!(await finalPrompt.innerText()).includes("fixture-prop"));
            await repair.getByRole("button", { name: "移除此引用", exact: true }).click();
            await finalPrompt.getByRole("textbox", { name: "最终提交提示词全文" }).waitFor();
            assert.equal(await assets.getByLabel("修复镜头资产引用").count(), 0);
        } else {
            const editor = finalPrompt.getByRole("textbox", { name: "最终提交提示词全文" });
            await editor.waitFor();
            await page.waitForFunction(() => document.querySelector('textarea[aria-label="最终提交提示词全文"]')?.value.includes("镜头1：固定机位"));
            const prompt = await editor.inputValue();
            assert.ok(prompt.includes("镜头1：固定机位"));
            assert.ok(prompt.includes("图片1") && prompt.includes("图片2"));
            assert.ok(!prompt.includes("资产 ID") && !prompt.includes("fixture-scene") && !prompt.includes("待补参考图"));
            await editor.fill(prompt + "\n保留自然停顿。");
            assert.ok((await editor.inputValue()).endsWith("保留自然停顿。"));
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], "preview navigation must never submit or alter generation tasks");
    console.log("PASS selected-shot preview: repeated switching, history, taskless shot, image stage, completed tasks; no generation submissions");
} finally {
    await browser.close();
}
