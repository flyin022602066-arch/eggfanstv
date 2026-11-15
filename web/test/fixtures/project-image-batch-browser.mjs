import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const [baseUrl, artifactDir] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const tasks = [], submissions = [], errors = [], unexpected = [];
let remote = 0;
const versions = Array.from({ length: 4 }, (_, index) => ["基础造型", "中期造型"].map((name, position) => ({
    assetId: `character-${index}`, title: `角色${index + 1}`, versionId: `${index}-${position}`, version: position + 1,
    definition: { appearance: "黑发青年", clothing: position ? "暗金核心，合金脊椎，爆炸颈环已去除" : "炭黑背心，红色爆炸颈环" },
    representations: [], visualStatus: "missing", voiceStatus: "missing", updatedAt: "2026-11-14T00:00:00Z",
    referenceProfile: { lookId: `look-${position}`, name, description: "", matchHints: "", excludeHints: "", enabled: true, preferred: false, default: position === 0 },
}))).flat();
const assets = versions.filter((version) => version.version === 1).map((character) => ({ id: character.assetId, title: character.title, category: "character", mediaType: "entity", status: "confirmed", primaryVersionId: character.versionId, versionCount: 2, usages: [], updatedAt: character.updatedAt, character }));
await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) { remote++; return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (data) => route.fulfill({ json: { code: 0, data, msg: "offline test" } });
    if (/\/projects\/batch-project\/core$/.test(url.pathname)) return json({ project: { id: "batch-project" } });
    if (/\/projects\/batch-project\/assets$/.test(url.pathname)) return json({ assets });
    if (/\/projects\/batch-project\/character-versions$/.test(url.pathname)) return json({ versions, revision: 1 });
    if (url.pathname === "/api/tasks" && request.method() === "POST") {
        const body = request.postDataJSON();
        submissions.push(body);
        const task = { id: `task-${submissions.length}`, projectId: "batch-project", type: "canvas_image", status: "running", stage: "上游正在生成基础图", prompt: body.prompt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attempts: 1, clientContext: { nodeId: body.input.metadata.nodeId } };
        tasks.push(task);
        return json(task);
    }
    if (url.pathname === "/api/tasks") return json(tasks.filter((task) => !url.searchParams.get("activeOnly") || ["running", "queued"].includes(task.status)));
    const taskId = url.pathname.match(/^\/api\/tasks\/([^/]+)$/)?.[1];
    if (taskId) return json(tasks.find((task) => task.id === taskId));
    unexpected.push({ path: url.pathname, method: request.method() });
    return route.fulfill({ status: 500, json: { code: 500, msg: "unexpected offline request" } });
});

const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
const finishBase = (index) => {
    const position = submissions.findIndex((body) => body.input.metadata.characterVersionId === `${index}-0`);
    assert.ok(position >= 0);
    const version = versions.find((candidate) => candidate.versionId === `${index}-0`);
    version.representations = [{ role: "turnaround_sheet", mediaType: "image", resourceId: `base-image-${index}` }];
    version.visualStatus = "ready";
    tasks[position].status = "succeeded";
};
try {
    await page.goto(baseUrl);
    await page.getByRole("button", { name: "打开角色批量生图", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "一键批量生成角色图", exact: true });
    await dialog.getByRole("button", { name: "提交 8 个生图任务", exact: true }).click();
    await dialog.getByText("已入队 4 / 8 个 · 提交失败 0 个 · 已处理 4 / 8 个", { exact: true }).waitFor();
    assert.equal(submissions.length, 4);
    await dialog.getByText("正在等待基础图，后续造型将自动继续", { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /任务 ID：task-1/);
    await page.screenshot({ path: resolve(artifactDir, "four-independent-bases.png") });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "打开角色批量生图", exact: true }).click();
    await dialog.getByText("待提交 0 个 · 正在生成跳过 8 个 · 已有图片跳过 0 个", { exact: true }).waitFor();
    assert.equal(submissions.length, 4);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    finishBase(2);
    await page.waitForFunction(() => document.querySelector('[aria-label="批次完成回调"]')?.textContent === "0");
    await new Promise((done) => {
        const timer = setInterval(() => { if (submissions.length >= 5) { clearInterval(timer); done(); } }, 50);
        setTimeout(() => { clearInterval(timer); done(); }, 12000);
    });
    assert.equal(submissions.length, 5);
    assert.equal(submissions[4].input.metadata.characterVersionId, "2-1");
    assert.equal(submissions[4].input.metadata.characterIdentityResourceId, "base-image-2");
    assert.match(submissions[4].input.metadata.promptTemplateVariables.角色设定, /本次造型编辑清单/);
    finishBase(0); finishBase(1); finishBase(3);
    await page.waitForFunction(() => document.querySelector('[aria-label="批次完成回调"]')?.textContent === "1");
    assert.equal(submissions.length, 8);
    assert.equal(new Set(submissions.map((body) => body.input.metadata.characterVersionId)).size, 8);
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    tasks.length = 0;
    versions.forEach((version) => { version.representations = []; version.visualStatus = "missing"; });
    await page.getByRole("button", { name: "打开角色批量生图", exact: true }).click();
    await dialog.getByRole("button", { name: "提交 8 个生图任务", exact: true }).click();
    await dialog.getByText("已入队 4 / 8 个 · 提交失败 0 个 · 已处理 4 / 8 个", { exact: true }).waitFor();
    assert.equal(submissions.length, 12);
    await dialog.getByRole("button", { name: "停止后续提交", exact: true }).click();
    await dialog.getByText("已提交 4 个，提交失败 0 个，已停止 4 个未提交任务", { exact: true }).waitFor();
    assert.equal(tasks.filter((task) => task.status === "running").length, 4);
    assert.equal(submissions.length, 12);
    await page.screenshot({ path: resolve(artifactDir, "stopped-unsubmitted-looks-light.png") });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    assert.equal(remote, 0);
    const report = { concurrentBases: 4, completedBatch: 8, resumedWhileClosed: true, duplicateSubmissions: 0, stoppedUnsubmitted: 4, queuedTasksPreserved: 4, remote, errors, unexpected };
    await writeFile(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ artifactDir, ...report }));
} catch (error) {
    await page.screenshot({ path: resolve(artifactDir, "failure.png") });
    console.error(JSON.stringify({ errors, unexpected, remote, submissions: submissions.length, body: (await page.locator("body").innerText()).slice(0, 4000) }));
    throw error;
} finally { await browser.close(); }
