import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(webDir, "../output/playwright/packaged-settings");
mkdirSync(output, { recursive: true });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
const problems = [];
const reports = [];
let remoteRequests = 0;
try {
    for (const packaged of [false, true]) {
        const server = await createServer({ configFile: false, appType: "custom", root: webDir, plugins: [react()], resolve: { alias: { "@": resolve(webDir, "src") } }, define: { __APP_VERSION__: '"test"', __APP_CHANGELOG__: '""', __BEEFTV_HEAVY_MEDIA_ENABLED__: "true", __BEEFTV_PACKAGED_WINDOWS__: JSON.stringify(packaged) }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
        server.middlewares.use("/settings-test", async (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end(await server.transformIndexHtml("/settings-test", '<!doctype html><html><body><div id="root"></div><script type="module">import "/src/styles/globals.css";import "/test/fixtures/packaged-settings-harness.tsx";</script></body></html>'));
        });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on("pageerror", (error) => problems.push(error.message));
        try {
            await server.listen();
            const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
            await page.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) { remoteRequests++; return route.abort(); }
                if (!url.pathname.startsWith("/api/")) return route.continue();
                if (url.pathname === "/api/beefapi/connection") return route.fulfill({ json: { code: 0, data: { state: "disconnected" } } });
                return route.fulfill({ status: 503, json: { code: 1, msg: "Fixture only" } });
            });
            await page.goto(origin + "/settings-test");
            await page.getByRole("heading", { name: "本地模型渠道" }).waitFor();
            assert.equal(await page.getByRole("button", { name: "新增渠道", exact: true }).count(), packaged ? 0 : 1);
            assert.equal(await page.getByRole("heading", { name: "火山 URI 资产库", exact: true }).count(), packaged ? 0 : 1);
            await page.getByRole("button", { name: "编辑", exact: true }).first().click();
            const dialog = page.getByRole("dialog");
            await dialog.waitFor();
            if (packaged) {
                assert.equal(await dialog.locator("input[inputmode=url]").count(), 0);
                assert.ok(!(await dialog.innerText()).includes("https://api.eggfans.com"));
                const baseIcon = dialog.getByRole("button", { name: "查看 Base URL", exact: true });
                await baseIcon.hover();
                const tip = page.getByRole("tooltip", { name: "https://api.eggfans.com", exact: true });
                await tip.waitFor();
                await page.screenshot({ path: resolve(output, "packaged-hover.png"), fullPage: true });
                await page.mouse.move(0, 0);
                await tip.waitFor({ state: "hidden" });
                const catalogIcon = dialog.getByRole("button", { name: "查看模型目录 URL", exact: true });
                await catalogIcon.focus();
                await page.getByRole("tooltip", { name: "https://api.eggfans.com/pricing", exact: true }).waitFor();
                await catalogIcon.blur();
                await dialog.getByText("Gemini", { exact: true }).click();
                assert.equal((await page.evaluate(() => window.settingsFixture.snapshot())).channels[0].baseUrl, "https://api.eggfans.com");
            } else {
                const base = dialog.getByLabel("Base URL", { exact: true });
                assert.equal(await base.inputValue(), "https://api.eggfans.com");
                await base.fill("https://fixture.example/v1");
                await dialog.getByLabel("模型目录 URL", { exact: true }).fill("https://fixture.example/models");
            }
            await dialog.getByLabel("API Key", { exact: true }).fill("fixture-updated-key");
            await dialog.getByRole("button", { name: /^完\s*成$/ }).click();
            await page.reload();
            await page.getByRole("button", { name: "编辑", exact: true }).first().click();
            assert.equal(await page.getByRole("dialog").getByLabel("API Key", { exact: true }).inputValue(), "fixture-updated-key");
            const snapshot = await page.evaluate(() => window.settingsFixture.snapshot());
            assert.equal(snapshot.channels[0].baseUrl, packaged ? "https://api.eggfans.com" : "https://fixture.example/v1");
            assert.equal(snapshot.channels[0].catalogUrl, packaged ? "https://api.eggfans.com/pricing" : "https://fixture.example/models");
            assert.equal(snapshot.channels[1].baseUrl, "https://ai.jiasuapi.com");
            assert.equal(snapshot.volcAssetLibrary.baseUrl, "https://20nbifxd.magine.work/v1");
            await page.screenshot({ path: resolve(output, packaged ? "packaged-settings.png" : "development-settings.png"), fullPage: true });
            if (packaged) {
                const empty = await context.newPage();
                await empty.goto(origin + "/settings-test?empty");
                await empty.getByText("暂无个人渠道", { exact: true }).waitFor();
                assert.equal(await empty.getByRole("button", { name: "新增渠道", exact: true }).count(), 0);
                await empty.close();
            }
            reports.push({ packaged, hoverAndFocus: packaged, keyEditableAndRetained: true, addressesPreserved: packaged, developmentEditable: !packaged });
        } finally { await context.close(); await server.close(); }
    }
    assert.deepEqual(problems, []);
    assert.equal(remoteRequests, 0);
    const result = { passed: true, reports, remoteRequests, problems };
    writeFileSync(resolve(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
} finally { await browser.close(); }
