import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, extname, sep } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("playwright");
const output = resolve(root, ".local/cache/video-recovery-ui");
const dist = resolve(output, "dist");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "skip-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/project-asset-images.html") } } });
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
const errors = [], queries = [], creations = [];
let workspace, releaseQuery, queryArrived;
let outcome = "network-error";
await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) {
        errors.push("external request attempted");
        return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = data => route.fulfill({ json: { code: 0, data, msg: "offline test" } });
    if (url.pathname.endsWith("/query-provider")) {
        queries.push({ path: url.pathname, method: request.method() });
        if (outcome === "network-error") return route.fulfill({ status: 502, json: { code: 502, msg: "离线测试：查询连接暂时中断" } });
        await new Promise(done => { releaseQuery = done; queryArrived?.(); });
        workspace.tasks[0] = { ...workspace.tasks[0], status: outcome === "succeeded" ? "succeeded" : "running", error: "", updatedAt: new Date().toISOString() };
        if (outcome === "succeeded") workspace.shotArtifacts = [{ id: "recovered-artifact", shotId: "shot", type: "video", resourceId: "recovered-resource", version: 1, selected: true, status: "ready", taskId: "original-local-task" }];
        return json({ task: workspace.tasks[0], recovered: outcome === "succeeded", providerStatus: outcome === "succeeded" ? "succeeded" : "processing" });
    }
    if (url.pathname === "/api/tasks" && request.method() === "POST") {
        creations.push(request.postDataJSON());
        return route.fulfill({ status: 400, json: { code: 400, msg: "禁止重新提交生成" } });
    }
    if (url.pathname === "/api/workspace/model-config") return json({ config: {}, revision: 0, health: "ready", source: "builtin+local" });
    if (url.pathname.endsWith("/units/unit/workspace")) return json(workspace);
    if (url.pathname.includes("/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" />' });
    if (url.pathname.endsWith("/assets")) return json({ assets: [], total: 0, categoryCounts: {}, folderCounts: {}, page: 1, pageSize: 24, hasMore: false });
    if (url.pathname.endsWith("/tasks")) return json(workspace?.tasks || []);
    return json({ skills: [], folders: [], sources: [] });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
try {
    console.log("recovery UI: loading fixture");
    await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/project-asset-images.html?bindings=1&provider=jiasu-j2`);
    await page.waitForFunction(() => Boolean(window.projectImageFixture));
    workspace = await page.evaluate(() => {
        const detail = window.projectImageFixture.videoDetail;
        detail.tasks = [{ id: "original-local-task", type: "canvas_video", status: "failed", providerRequestId: "original-upstream-task", error: "TLS handshake interrupted", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), clientContext: { shotId: "shot", artifactType: "video" } }];
        detail.shotArtifacts = [];
        return structuredClone(detail);
    });
    await page.getByRole("button", { name: "测试视频页", exact: true }).click();
    const prompt = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
    await prompt.fill("保留我未保存的新提示词");
    const recover = page.getByRole("button", { name: "查询并取回", exact: true });
    await recover.click();
    console.log("recovery UI: queried original failed task");
    await page.getByText("离线测试：查询连接暂时中断", { exact: false }).first().waitFor({ state: "attached" });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("查询并取回"))?.classList.contains("ant-btn-loading"));
    assert.equal(await prompt.inputValue(), "保留我未保存的新提示词");
    outcome = "processing";
    const processingArrived = new Promise(done => { queryArrived = done; });
    await recover.click();
    await processingArrived;
    await page.waitForFunction(() => document.querySelector(".workflow-editor-actions .ant-btn-primary")?.disabled);
    assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).isDisabled(), true);
    releaseQuery();
    console.log("recovery UI: resuming processing task");
    await recover.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /生成镜头视频（已运行/ }).waitFor();
    assert.equal(await prompt.inputValue(), "保留我未保存的新提示词");
    await page.reload();
    await page.waitForFunction(() => Boolean(window.projectImageFixture));
    workspace = await page.evaluate(() => {
        const detail = window.projectImageFixture.videoDetail;
        detail.tasks = [{ id: "original-local-task", type: "canvas_video", status: "failed", providerRequestId: "original-upstream-task", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), clientContext: { shotId: "shot", artifactType: "video" } }];
        detail.shotArtifacts = [];
        return structuredClone(detail);
    });
    await page.getByRole("button", { name: "测试视频页", exact: true }).click();
    outcome = "succeeded";
    const successArrived = new Promise(done => { queryArrived = done; });
    await recover.click();
    await successArrived;
    await page.waitForFunction(() => document.querySelector(".workflow-editor-actions .ant-btn-primary")?.disabled);
    releaseQuery();
    console.log("recovery UI: restoring completed result");
    await recover.waitFor({ state: "hidden" });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("下载视频") && !button.disabled));
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.screenshot({ path: resolve(output, "recovered-light.png"), animations: "disabled" });
    assert.equal(creations.length, 0);
    assert.deepEqual(queries, Array.from({ length: 3 }, () => ({ path: "/api/tasks/original-local-task/query-provider", method: "POST" })));
    assert.deepEqual(errors, []);
    const report = { queries: queries.length, generationSubmissions: creations.length, passed: ["查询异常可再次取回", "查询期间禁用重复生成", "处理中恢复原任务运行状态", "保留未保存的提示词", "成功结果刷新到原镜头并可下载"], errors };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
} catch (error) {
    console.error(error);
    await page.screenshot({ path: resolve(output, "failure.png"), animations: "disabled", timeout: 5000 }).catch(() => undefined);
    throw error;
} finally {
    releaseQuery?.();
    await browser.close();
    await new Promise(done => server.close(done));
}
