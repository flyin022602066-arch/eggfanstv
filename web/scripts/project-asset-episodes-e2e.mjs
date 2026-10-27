import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, extname, sep } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("playwright");
const dist = resolve(root, ".local/cache/project-asset-episodes-harness");
const output = resolve(root, "output/playwright/project-asset-episodes");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "skip-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/project-asset-images.html") } } });
const server = createServer(async (request, response) => {
    try {
        const path = resolve(dist, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
        if (!path.startsWith(dist + sep)) throw new Error("invalid path");
        response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html" })[extname(path)] || "application/octet-stream" });
        response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const errors = [], report = [], assetQueries = [];
let assets = [], savedConfig = {}, revision = 0, remote = 0, taskSubmissions = 0;
const scopeAssets = unitId => assets.filter(asset => !unitId || (unitId === "__unassigned__" ? !asset.unitIds?.length : asset.unitIds?.includes(unitId)));
const candidates = [{ id: "pending-2", unitId: "unit-2", name: "庭院石桌", category: "prop", status: "pending_confirmation" }];
await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) { remote++; return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = data => route.fulfill({ json: { code: 0, data, msg: "offline fixture" } });
    if (url.pathname === "/api/workspace/model-config") {
        if (request.method() === "PUT") { savedConfig = request.postDataJSON().config; revision++; return json({ saved: true, revision }); }
        return json({ config: savedConfig, revision, health: "ready", source: "builtin+local" });
    }
    if (/\/tasks$/.test(url.pathname)) {
        if (request.method() === "POST") { taskSubmissions++; throw new Error("This interaction test must not generate media"); }
        return json([]);
    }
    if (/\/skills\/added$/.test(url.pathname)) return json({ skills: [
        { skillId: "screenplay", skillName: "剧本拆解", description: "离线剧本技能", isAdded: true, versionId: "skill-v1" },
        { skillId: "camera", skillName: "镜头语言", description: "离线摄影技能", isAdded: true, versionId: "skill-v2" },
    ] });
    if (/\/resources\/[^/]+\/file/.test(url.pathname)) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#39779a"/></svg>' });
    if (/\/assets$/.test(url.pathname)) {
        assetQueries.push(url.search);
        if (!url.searchParams.has("page")) return json({ assets });
        const scoped = scopeAssets(url.searchParams.get("unitId"));
        const filtered = scoped.filter(asset => (!url.searchParams.get("category") || asset.category === url.searchParams.get("category")) && (!url.searchParams.has("folderId") || (asset.folderId || "") === url.searchParams.get("folderId")) && (!url.searchParams.get("q") || asset.title.includes(url.searchParams.get("q"))));
        const page = Number(url.searchParams.get("page")), pageSize = Number(url.searchParams.get("pageSize"));
        const unitCounts = {};
        for (const asset of assets) for (const unitId of asset.unitIds?.length ? asset.unitIds : [""]) unitCounts[unitId] = (unitCounts[unitId] || 0) + 1;
        return json({ assets: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, categoryCounts: scoped.reduce((counts, asset) => ({ ...counts, [asset.category]: (counts[asset.category] || 0) + 1 }), {}), folderCounts: { "": scoped.length }, unitCounts, page, pageSize, hasMore: page * pageSize < filtered.length });
    }
    if (/\/asset-folders$/.test(url.pathname)) return json({ folders: [] });
    if (/\/asset-candidates$/.test(url.pathname)) {
        const filtered = candidates.filter(candidate => (!url.searchParams.get("unitId") || candidate.unitId === url.searchParams.get("unitId")) && (!url.searchParams.get("category") || candidate.category === url.searchParams.get("category")) && (!url.searchParams.get("q") || candidate.name.includes(url.searchParams.get("q"))));
        return json({ candidates: filtered, total: filtered.length });
    }
    return json({ skills: [], folders: [], sources: [], data: [] });
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.on("pageerror", error => errors.push(error.message));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/test/fixtures/project-asset-images.html?asset-episodes`;
const visibleIds = () => page.locator("[data-project-asset-id]").evaluateAll(elements => elements.map(element => element.dataset.projectAssetId).sort());
const selectEpisode = async label => {
    await page.getByRole("combobox", { name: "资产集数", exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(label, { exact: true }).click();
};
const waitIds = async expected => {
    await page.waitForFunction(ids => {
        const actual = [...document.querySelectorAll("[data-project-asset-id]")].map(element => element.dataset.projectAssetId).sort();
        return JSON.stringify(actual) === JSON.stringify(ids.sort());
    }, expected);
};
try {
    await page.goto(fixtureUrl);
    await page.waitForFunction(() => Boolean(window.projectImageFixture));
    assets = await page.evaluate(() => window.projectImageFixture.assets);
    await page.reload();
    await waitIds(assets.map(asset => asset.id));
    for (const category of ["角色", "场景", "道具"]) await page.getByRole("region", { name: `${category}资产分组`, exact: true }).waitFor();
    assert.equal(await page.locator('[data-project-asset-id="character-ready"]').getByLabel(/关联集数：.*第1集.*第2集/).count(), 1);
    await selectEpisode("第1集 · 古城初遇（5 项已确认）");
    await waitIds(["scene", "prop", "character", "character-ready", "character-portrait"]);
    assert.equal(await page.getByText("庭院石桌", { exact: true }).count(), 0);
    await page.screenshot({ path: resolve(output, "episode-one-dark.png"), fullPage: true, animations: "disabled" });
    await selectEpisode("第2集 · 庭院重逢（3 项已确认）");
    await waitIds(["scene-2", "prop-2", "character-ready"]);
    await page.getByText("庭院石桌", { exact: true }).waitFor();
    const sidebar = page.getByRole("navigation", { name: "素材目录与资产分类" });
    await sidebar.getByRole("button", { name: /^道具/ }).click();
    await waitIds(["prop-2"]);
    await page.getByRole("textbox", { name: "搜索项目资产" }).fill("不存在");
    await page.getByText("没有找到匹配资产", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "搜索项目资产" }).fill("");
    await waitIds(["prop-2"]);
    await sidebar.getByRole("button", { name: /^全部资产/ }).click();
    await waitIds(["scene-2", "prop-2", "character-ready"]);
    await page.getByRole("button", { name: "一键批量生成场景图", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByText(/范围：第2集 · 庭院重逢的已确认场景/).waitFor();
    await dialog.getByRole("button", { name: "提交 1 个生图任务", exact: true }).waitFor();
    assert.ok(assetQueries.some(query => query.includes("unitId=unit-2") && query.includes("pageSize=80")));
    await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.screenshot({ path: resolve(output, "episode-two-light.png"), fullPage: true, animations: "disabled" });
    await selectEpisode("未关联集数（1 项已确认）");
    await waitIds(["image"]);
    await selectEpisode("全部集数");
    await waitIds(assets.map(asset => asset.id));
    report.push("Episode filters use confirmed extraction and shot associations; shared asset appears in both episodes; unassigned assets remain discoverable; category/search and scoped batch preview work");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, "assets-mobile.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("button", { name: "测试章节页", exact: true }).click();
    await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "生成章节分镜" });
    const skillPicker = () => dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true });
    await skillPicker().click();
    await page.locator('.ant-select-item-option-content').getByText("剧本拆解", { exact: true }).click();
    await page.locator('.ant-select-item-option-content').getByText("镜头语言", { exact: true }).click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.projectImageFixture.readConfig().projectChapterStoryboardSkills?.["fixture-project"]?.length === 2);
    await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /02 庭院重逢/ }).click();
    await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
    await dialog.getByText("庭院重逢", { exact: true }).waitFor();
    for (const name of ["剧本拆解", "镜头语言"]) await dialog.locator('.ant-select-selection-item-content').getByText(name, { exact: true }).waitFor();
    await dialog.screenshot({ path: resolve(output, "episode-two-skills-inherited.png"), animations: "disabled" });
    await page.waitForTimeout(800);
    assert.deepEqual(savedConfig.projectChapterStoryboardSkills?.["fixture-project"], ["screenplay", "camera"]);
    await page.reload();
    await page.getByRole("button", { name: "测试章节页", exact: true }).click();
    await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
    for (const name of ["剧本拆解", "镜头语言"]) await dialog.locator('.ant-select-selection-item-content').getByText(name, { exact: true }).waitFor();
    await page.goto(fixtureUrl + "&project=second-project");
    await page.getByRole("button", { name: "测试章节页", exact: true }).click();
    await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
    await page.waitForFunction(() => window.projectImageFixture.readConfig().projectChapterStoryboardSkills?.["fixture-project"]?.length === 2 && !window.projectImageFixture.readConfig().projectChapterStoryboardSkills?.["second-project"]);
    assert.equal(await dialog.locator('.ant-select-selection-item-content').getByText("剧本拆解", { exact: true }).count(), 0);
    report.push("Storyboard skill selection persists when cancelling/reopening, changing to episode two, and reloading; a separate project does not inherit it");
    assert.equal(taskSubmissions, 0);
    assert.equal(remote, 0);
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, "report.json"), JSON.stringify({ report, remote, taskSubmissions, errors, visibleIds: await visibleIds() }, null, 2));
    console.log(JSON.stringify({ report, remote, taskSubmissions, errors, output }, null, 2));
} catch (error) {
    await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true, animations: "disabled" });
    throw error;
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
