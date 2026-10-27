import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, ".local/cache/character-face-harness");
const output = resolve(root, "output/playwright/character-face-presets");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "face-harness-media", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], logLevel: "error", build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/project-asset-images.html") } } });
const server = createServer(async (request, response) => {
    try {
        const path = resolve(dist, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
        assert(path.startsWith(dist + sep));
        response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html" })[extname(path)] || "application/octet-stream" });
        response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let assets = [], tasks = [], uploads = 0, blockedExternalRequests = 0, savedConfig = {}, rejectSave = true;
let project = { id: "fixture-project", characterFacePresetsJson: "{}" };
const submissions = [], errors = [];
await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) { blockedExternalRequests++; return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = data => route.fulfill({ json: { code: 0, data, msg: "offline fixture" } });
    if (url.pathname === "/api/workspace/model-config") {
        if (request.method() === "PUT") savedConfig = request.postDataJSON().config;
        return json({ config: savedConfig, revision: 1, health: "ready", source: "builtin+local" });
    }
    if (/\/projects\/[^/]+\/core$/.test(url.pathname)) return json({ project });
    if (/\/projects\/[^/]+$/.test(url.pathname) && request.method() === "PATCH") {
        if (rejectSave) return route.fulfill({ status: 503, json: { code: 503, msg: "离线模拟保存失败", reason: "fixture_write_failed" } });
        project = { ...project, ...request.postDataJSON() };
        return json({ project });
    }
    if (url.pathname === "/api/resources" && request.method() === "POST") {
        assert.match(request.headers()["content-type"], /multipart\/form-data; boundary=/);
        uploads++;
        return json({ resource: { id: `face-upload-${uploads}`, kind: "image", mimeType: "image/png", status: "ready", size: 100, width: 64, height: 64 } });
    }
    if (/\/resources\/[^/]+\/file/.test(url.pathname)) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#cbbca4"/><ellipse cx="200" cy="180" rx="80" ry="110" fill="#475569"/></svg>' });
    if (/\/tasks$/.test(url.pathname)) {
        if (request.method() === "POST") {
            const body = request.postDataJSON(); submissions.push(body);
            const task = { id: `offline-face-${submissions.length}`, status: "queued", clientContext: { nodeId: body.input.metadata.nodeId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            tasks.push(task);
            return json(task);
        }
        return json(tasks);
    }
    if (/\/assets$/.test(url.pathname)) {
        const filtered = assets.filter(asset => !url.searchParams.get("category") || asset.category === url.searchParams.get("category"));
        const page = Number(url.searchParams.get("page") || 1), pageSize = Number(url.searchParams.get("pageSize") || 80);
        return json({ assets: filtered.slice((page - 1) * pageSize, page * pageSize), categoryCounts: { character: 2, environment: 1, prop: 1 }, folderCounts: { "": assets.length }, unitCounts: {}, total: filtered.length, page, pageSize, hasMore: page * pageSize < filtered.length });
    }
    if (/\/asset-folders$/.test(url.pathname)) return json({ folders: [] });
    if (/\/asset-candidates$/.test(url.pathname)) return json({ candidates: [], total: 0 });
    return json({ skills: [], sources: [], folders: [] });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", error => errors.push(error.message));
try {
    const address = `http://127.0.0.1:${server.address().port}/test/fixtures/project-asset-images.html`;
    await page.goto(address);
    await page.waitForFunction(() => Boolean(window.projectImageFixture));
    assets = await page.evaluate(() => window.projectImageFixture.assets);
    await page.reload();
    await page.getByRole("button", { name: "主角人脸预设", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "主角人脸预设", exact: true });
    await dialog.getByLabel("上传男主人脸参考图").waitFor({ state: "attached" });
    const imageBase64 = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const context = canvas.getContext("2d"); context.fillStyle = "#667788"; context.fillRect(0, 0, 64, 64); return canvas.toDataURL("image/png").split(",")[1]; });
    const imageFile = name => ({ name, mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") });
    await dialog.getByLabel("上传男主人脸参考图").setInputFiles(imageFile("男主.png"));
    await dialog.getByRole("button", { name: "替换男主参考图", exact: true }).waitFor();
    const choose = async (role, name) => {
        await dialog.getByRole("combobox", { name: `${role}绑定角色` }).click();
        await page.locator(".ant-select-dropdown:visible").last().getByText(name, { exact: true }).click();
        await dialog.getByRole("combobox", { name: `${role}绑定角色` }).press("Escape");
    };
    await choose("男主", "角色甲");
    await dialog.getByLabel("上传女主人脸参考图").setInputFiles(imageFile("女主.png"));
    await dialog.getByRole("button", { name: "替换女主参考图", exact: true }).waitFor();
    await choose("女主", "角色原图甲");
    await dialog.getByRole("button", { name: "保存人脸预设", exact: true }).click();
    await dialog.getByText("离线模拟保存失败", { exact: true }).waitFor();
    assert.equal(submissions.length, 0);
    rejectSave = false;
    await page.screenshot({ path: resolve(output, "face-presets-dark.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "保存人脸预设", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(uploads, 2);
    assert.deepEqual(JSON.parse(project.characterFacePresetsJson).male.assetIds, ["character"]);
    await page.reload();
    await page.getByRole("button", { name: "主角人脸预设", exact: true }).click();
    await dialog.getByText("男主.png", { exact: true }).waitFor();
    await dialog.getByText("女主.png", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 760, height: 1000 });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.getByRole("button", { name: "主角人脸预设", exact: true }).click();
    await dialog.getByText("女主.png", { exact: true }).waitFor();
    await page.waitForTimeout(450);
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 760);
    await page.screenshot({ path: resolve(output, "face-presets-light-narrow.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "生成角色三视图", exact: true }).click();
    const generationDialog = page.getByRole("dialog");
    await generationDialog.getByText(/已启用男主人脸参考/).waitFor();
    await generationDialog.getByRole("button", { name: "开始生成", exact: true }).click();
    await generationDialog.waitFor({ state: "hidden" });
    assert.deepEqual(submissions[0].input.referenceImages.map(image => image.storageKey), ["resource:face-upload-1"]);
    assert.match(submissions[0].input.metadata.promptTemplateVariables.角色设定, /保留该图的脸型/);
    tasks = [];
    await page.reload();
    await page.getByRole("button", { name: "一键批量生成角色图", exact: true }).click();
    const batchDialog = page.getByRole("dialog");
    await batchDialog.getByRole("switch", { name: "仅生成缺图资产" }).click();
    await batchDialog.getByRole("button", { name: /提交 3 个生图任务/ }).click();
    await batchDialog.getByText("已提交 3 个，提交失败 0 个", { exact: true }).waitFor();
    const batch = submissions.slice(1);
    assert.equal(batch.length, 3);
    assert.deepEqual(batch.map(task => task.input.referenceImages.map(image => image.storageKey)), [["resource:face-upload-1"], ["resource:face-upload-2"], []]);
    assert.equal(uploads, 2, "saved references must not be reuploaded as new local resources");
    assert.equal(blockedExternalRequests, 0);
    assert.deepEqual(errors, []);
    const report = { passed: true, uploads, automaticSingleAndBatchReferences: true, reloadRestoredPresets: true, saveFailureVisible: true, realGatewayRequests: 0, submissions: submissions.length, errors };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
