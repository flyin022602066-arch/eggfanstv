import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(8000);
    const writes = [], errors = [];
    let rejectWrite = true;
    const assets = ["original-hero", "duplicate-hero"].map((id, index) => ({ id, title: "苏卉", category: "character", mediaType: "entity", primaryVersionId: id + "-v1", versionCount: 1, usages: [], position: index, character: { versionId: id + "-v1", version: 1, definition: { clothing: index ? "黑色战斗服" : "白色外套" }, representations: [], visualStatus: "missing", voiceStatus: "missing" } }));
    const failedExtraction = { id: "failed-extraction", type: "canvas_text", projectId: "p", status: "failed", attempts: 1, prompt: "", createdAt: "2026-11-04T00:03:00Z", updatedAt: "2026-11-04T00:04:00Z", error: "离线模拟：章节资产 JSON 被截断", clientContext: { chapterId: "u", chapterOperation: "characters" } };
    const task = { id: "task-new", type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:01:00Z", clientContext: { chapterId: "u", chapterOperation: "storyboard" }, inputJson: JSON.stringify({ metadata: { source: "short-drama-chapter-storyboard", chapterId: "u", domainProjectId: "p", approvedRevision: 9, approvedShotIds: [] } }), resultJson: JSON.stringify({ rows: [{ shotNumber: 1, durationSeconds: 30, plotDescription: "苏卉走向窗前。", imageGenerationPrompt: "苏卉走向窗前。", videoMotionPrompt: "镜头1：跟拍。起幅：苏卉起身。→ 落幅：苏卉站在窗前。", characters: [] }] }) };
    task.projectId = "p";
    const result = JSON.parse(task.resultJson);
    result.rows[0].characters = ["苏卉"];
    task.resultJson = JSON.stringify(result);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request(), target = new URL(request.url()), path = target.pathname;
        if (target.origin !== new URL(url).origin) { errors.push("external request"); return route.abort(); }
        const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (request.method() !== "GET") {
            writes.push({ path, body: request.postDataJSON() });
            if (path === "/api/projects/p/units/u/shots") {
                if (rejectWrite) return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "离线测试模拟项目已归档", reason: "project_archived" } });
                if (writes.length === 2) return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "版本已变化", reason: "project_revision_conflict" } });
                return ok({ shots: [{ id: "new-shot" }] });
            }
            errors.push("unexpected write " + path); return route.abort();
        }
        if (path === "/api/tasks") return ok([failedExtraction, task]);
        if (path === "/api/tasks/task-new") return ok(task);
        if (path.endsWith("/chapter-apply-receipts")) return ok({ receipts: [] });
        if (path.endsWith("/character-versions")) return ok({ versions: assets.map((asset) => ({ ...asset.character, assetId: asset.id, title: asset.title })), revision: 11 });
        if (path.endsWith("/workspace")) return ok({ shots: [] });
        if (path.endsWith("/core")) return ok({ project: { id: "p", revision: 11 } });
        if (path.endsWith("/assets")) return ok({ assets });
        if (path.includes("/skills")) return ok({ skills: [] });
        if (path.startsWith("/api/")) return ok({});
        return route.continue();
    });
    await page.goto(url);
    try { await page.getByText("离线模拟：章节资产 JSON 被截断").waitFor(); } catch (error) {
        console.log(JSON.stringify({ errors, body: await page.locator("body").innerText() }));
        throw error;
    }
    const extract = page.getByRole("button", { name: "提取角色、场景与道具", exact: true });
    assert.equal(await extract.innerText(), "重新提取资产");
    assert.equal(await extract.isDisabled(), false, "a failed extraction must not block retry");
    await extract.click();
    const extractionDialog = page.getByRole("dialog").filter({ hasText: "提取章节角色、场景与道具" });
    await extractionDialog.getByText(/以最新结果整体替换本集全部未确认资产草稿/u).waitFor();
    await page.screenshot({ path: join(artifactDir, "reextract-dialog.png") });
    await extractionDialog.getByRole("button", { name: /取\s*消/u, exact: true }).click();
    await extractionDialog.waitFor({ state: "hidden" });
    assert.equal(writes.length, 0, "opening and canceling extraction must not submit generation");
    const review = page.getByRole("button", { name: "核对后写入", exact: true });
    try { await review.waitFor(); } catch (error) {
        console.log(JSON.stringify({ errors, body: await page.locator('body').innerText() }));
        throw error;
    }
    await review.click();
    const confirm = page.getByRole("dialog").filter({ hasText: "写入已生成的分镜" });
    await confirm.waitFor();
    assert.equal(writes.length, 0);
    await confirm.getByRole("button", { name: "先不写入", exact: true }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal(writes.length, 0, "cancel must leave the generated result untouched");
    await review.click();
    await confirm.waitFor();
    const writeButton = confirm.getByRole("button", { name: "写入已生成的分镜", exact: true });
    assert.equal(await writeButton.isDisabled(), true, "ambiguous characters must be resolved before writing");
    await confirm.getByRole("combobox", { name: "核对苏卉资产" }).click();
    await page.getByText(/白色外套.*original/u).click();
    assert.equal(await writeButton.isDisabled(), false);
    await page.screenshot({ path: join(artifactDir, "recovery-review.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await confirm.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false, "review must fit narrow screens");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await confirm.getByRole("button", { name: "写入已生成的分镜", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "写入失败" }).waitFor();
    assert.equal(writes.length, 1);
    rejectWrite = false;
    await review.click();
    await confirm.waitFor();
    await confirm.getByRole("combobox", { name: "核对苏卉资产" }).click();
    await page.getByText(/白色外套.*original/u).click();
    await writeButton.click();
    await page.getByText("分镜写入后已跳转", { exact: true }).waitFor();
    assert.equal(writes.length, 3, "one failed write and one revision retry, without regeneration");
    assert.equal(writes[0].body.sourceTaskId, "task-new");
    assert.equal(writes[0].body.expectedRevision, 11);
    assert.deepEqual(writes[0].body.shots[0].assetVersionIds, ["original-hero-v1"]);
    assert.deepEqual(writes[1].body.shots, writes[2].body.shots, "retry must submit the same explicitly reviewed asset choice");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(artifactDir, "recovery-complete.png") });
    console.log(JSON.stringify({ writes: writes.length, errors, artifactDir }));
} finally { await browser.close(); }
