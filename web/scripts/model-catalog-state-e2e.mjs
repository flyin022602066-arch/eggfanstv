import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("playwright");
const dist = resolve(root, ".local/cache/model-catalog-state-harness");
const output = resolve(root, "output/playwright/model-catalog-state");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "skip-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/model-catalog-state.html") } } });
const server = createServer(async (request, response) => {
    try {
        const path = resolve(dist, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
        assert.ok(path.startsWith(dist + sep));
        response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html" })[extname(path)] || "application/octet-stream" });
        response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const catalog = [
    { id: "gpt-4o", modelType: "text" }, { id: "deepseek-v3", modelType: "text" },
    { id: "gpt-image-2", modelType: "image" }, { id: "gemini-nano-banana-2.1", modelType: "image" },
    { id: "seedance-2.5", modelType: "video" }, { id: "suno-v4", modelType: "audio" },
    { id: "gemini-embedding-001", modelType: "text" }, { id: "BAAI/bge-reranker-v2-m3", modelType: "text" },
    ...Array.from({ length: 390 }, (_, index) => ({ id: `catalog-chat-${index}`, modelType: "text" })),
];
let savedConfig = { channels: [{ id: "beefapi", name: "Eggfans TV", baseUrl: "https://api.eggfans.com", apiKey: "offline-key", apiFormat: "openai", models: ["gpt-4o", "gpt-image-2"], pinned: false }] };
let revision = 1, fetches = 0, externalRequests = 0, failSave = false;
const errors = [], checks = [];
await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) { externalRequests++; return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = data => route.fulfill({ json: { code: 0, data, msg: "offline test" } });
    if (url.pathname === "/api/workspace/bootstrap") return json({ workspace: { id: "model-catalog-offline-test" }, user: { id: "local", username: "local" }, profile: "local", features: { customChannelsEnabled: true }, capabilities: { localAssets: true, providerCalls: true } });
    if (url.pathname === "/api/workspace/model-config") {
        if (request.method() === "PUT") {
            if (failSave) return route.fulfill({ status: 500, json: { code: 500, msg: "离线测试：磁盘不可写" } });
            assert.equal(request.postDataJSON().expectedRevision, revision);
            savedConfig = request.postDataJSON().config;
            revision++;
            return json({ saved: true, revision });
        }
        return json({ config: savedConfig, revision, health: "ready", source: "builtin+local" });
    }
    if (url.pathname === "/api/ai/models") { fetches++; return json({ models: catalog }); }
    if (url.pathname.includes("/beefapi/")) return json({ state: "disconnected" });
    if (url.pathname.endsWith("/skills")) return json({ skills: [] });
    return json([]);
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const url = `http://127.0.0.1:${server.address().port}/test/fixtures/model-catalog-state.html`;
try {
    await page.goto(url);
    await page.getByTestId("catalog-count").filter({ hasText: /^2$/ }).waitFor();
    await page.getByRole("button", { name: "拉取模型", exact: true }).click();
    await page.getByText("Eggfans TV模型列表已更新并保存", { exact: true }).waitFor({ state: "attached" });
    assert.equal(savedConfig.channels[0].models.length, catalog.length);
    assert.ok(savedConfig.channels[0].modelProfiles.some(profile => profile.model === "deepseek-v3" && profile.capability === "text"));
    assert.equal(savedConfig.channels[0].apiKey, "offline-key");
    checks.push("拉取完整目录、能力和 Key 后确认保存");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId("catalog-count").filter({ hasText: new RegExp(`^${catalog.length}$`) }).waitFor();
    assert.equal(fetches, 1);
    checks.push("清浏览器缓存重开仍恢复全部模型，不重复拉取");
    await page.getByRole("button", { name: "拆解文本测试", exact: true }).click();
    await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.locator("button[aria-haspopup='listbox']").click();
    await page.getByRole("button", { name: /Eggfans TV.*个模型/ }).click();
    const choices = await page.getByRole("option").allTextContents();
    assert.ok(choices.some(name => name.includes("deepseek-v3")));
    assert.ok(!choices.some(name => /image|banana|seedance|suno|embedding|rerank/i.test(name)));
    await page.screenshot({ path: resolve(output, "text-model-filter.png"), fullPage: true });
    await page.getByRole("option", { name: /deepseek-v3/ }).click();
    await modal.locator("button.ant-modal-close").click();
    checks.push("真实拆解弹窗只列出文本模型");
    await page.getByRole("button", { name: "模型设置测试", exact: true }).click();
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    failSave = true;
    await page.getByRole("button", { name: "拉取模型", exact: true }).click();
    await page.getByText(/模型列表已更新，但未保存到本地/).waitFor({ state: "attached" });
    checks.push("保存失败明确提示，不假报保存成功");
    assert.deepEqual(errors, []);
    assert.equal(externalRequests, 0);
    await writeFile(resolve(output, "report.json"), JSON.stringify({ checks, modelCount: catalog.length, externalRequests, errors }, null, 2));
    console.log(JSON.stringify({ checks, modelCount: catalog.length, externalRequests, errors }));
} finally {
    await context.close();
    await browser.close();
    await new Promise(done => server.close(done));
}
