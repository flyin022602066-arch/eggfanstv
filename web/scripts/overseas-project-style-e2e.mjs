import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(webDirectory, "../.local/cache/overseas-project-style");
mkdirSync(outputDirectory, { recursive: true });
const server = await createServer({ configFile: resolve(webDirectory, "vite.config.ts"), appType: "custom", root: webDirectory, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
server.middlewares.use("/overseas-style-test", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(await server.transformIndexHtml("/overseas-style-test", '<!doctype html><html><head><meta charset="UTF-8"><title>Overseas styles offline test</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/test/fixtures/overseas-project-style-harness.tsx"></script></body></html>'));
});
let browser;
try {
    await server.listen();
    const origin = "http://127.0.0.1:" + server.httpServer.address().port;
    const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true });
    for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width: 1380, height: 920 } });
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin || url.pathname.startsWith("/api/")) {
                errors.push("unexpected network request: " + url.pathname);
                return route.abort();
            }
            return route.continue();
        });
        await page.goto(origin + "/overseas-style-test?theme=" + theme);
        await page.getByRole("button", { name: "海外画风", exact: true }).click();
        assert.equal(await page.locator("article.style-center-card").count(), 16);
        await page.screenshot({ path: resolve(outputDirectory, theme + "-overseas-library.png") });
        await page.getByRole("button", { name: "组合画风", exact: true }).click();
        const composer = page.getByRole("dialog", { name: "组合项目画风", exact: true });
        await composer.getByRole("combobox", { name: "题材世界", exact: true }).click();
        await page.getByRole("option", { name: "海外现代都市", exact: true }).click();
        await composer.getByRole("combobox", { name: "地域选角", exact: true }).click();
        await page.getByRole("option", { name: "欧美剧", exact: true }).click();
        await composer.getByRole("combobox", { name: "视觉媒介", exact: true }).click();
        await page.getByRole("option", { name: "真人实拍", exact: true }).click();
        await composer.getByRole("combobox", { name: "角色造型", exact: true }).click();
        await page.getByRole("option", { name: "写实人物", exact: true }).click();
        assert.match(await composer.getByLabel("组合画风完整规范").innerText(), /地域选角：欧美剧/);
        await composer.getByRole("heading").click();
        await page.getByRole("listbox").waitFor({ state: "hidden" });
        await page.screenshot({ path: resolve(outputDirectory, theme + "-casting-composer.png") });
        await composer.getByRole("button", { name: "应用组合画风", exact: true }).click();
        const applied = JSON.parse(await page.getByLabel("已应用画风").innerText());
        assert.equal(applied.selection.casting, "western");
        assert.equal(applied.selection.medium, "live-action");
        assert.match(applied.prompt, /人脸参考优先/);
        await page.getByRole("button", { name: "模拟个人风格快照", exact: true }).click();
        await page.getByRole("button", { name: "打开画风", exact: true }).click();
        await page.getByRole("button", { name: "组合画风", exact: true }).click();
        assert.match(await page.getByLabel("组合画风完整规范").innerText(), /地域选角：欧美剧/);
        assert.deepEqual(errors, []);
        console.log("PASS " + theme + ": overseas category, 16 presets, independent casting, apply and reopen a custom snapshot; no model requests");
        await page.close();
    }
} finally {
    await browser?.close();
    await server.close();
}
