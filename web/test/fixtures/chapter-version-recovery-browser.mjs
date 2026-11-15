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
    const correctId = "a2e9090ddce2259c0aecc239cb7c76c2";
    const wrongId = "a2e9090ddce22259c0aecc239cb7c76c2";
    const hero = { id: "original-hero", title: "李建国", category: "character", mediaType: "entity", primaryVersionId: correctId, versionCount: 2, usages: [], position: 0, character: { versionId: correctId, version: 1, definition: { clothing: "基础造型白色外套" }, representations: [], visualStatus: "missing", voiceStatus: "missing" } };
    const foreign = { ...hero, id: "other-hero", title: "其他角色", primaryVersionId: "other-hero-v1", character: { ...hero.character, versionId: "other-hero-v1", definition: { clothing: "其他角色的造型" } } };
    const props = ["white-envelope", "black-envelope"].map((id, index) => ({ id, title: "旧信封", category: "prop", mediaType: "image", primaryVersionId: id + "-v1", versionCount: 1, usages: [], position: index + 2, previewText: index ? "黑色信封" : "白色信封" }));
    const assets = [hero, foreign, ...props];
    const versions = [{ ...hero.character, assetId: hero.id, title: hero.title }, { ...hero.character, assetId: hero.id, title: hero.title, versionId: "hero-work-v2", version: 2, definition: { clothing: "蓝色工作服" } }, { ...foreign.character, assetId: foreign.id, title: foreign.title }];
    const rows = [correctId, wrongId].map((versionId, index) => ({ shotNumber: index + 1, durationSeconds: 30, plotDescription: index ? "李建国在窗前拿起旧信封。" : "李建国走向窗前。", imageGenerationPrompt: index ? "李建国拿起旧信封。" : "李建国走向窗前。", videoMotionPrompt: `镜头${index + 1}：缓慢推进。起幅：李建国站在窗前。→ 落幅：李建国抬头。`, characters: [{ characterName: hero.title, characterAssetId: hero.id, characterVersionId: versionId }], propNames: index ? ["旧信封"] : [] }));
    const task = { id: "task-version-repair", projectId: "p", type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:01:00Z", clientContext: { chapterId: "u", chapterOperation: "storyboard" }, inputJson: JSON.stringify({ metadata: { source: "short-drama-chapter-storyboard", chapterId: "u", domainProjectId: "p", approvedRevision: 9, approvedShotIds: [] } }), resultJson: JSON.stringify({ mode: "continuous", text: JSON.stringify({ rows }) }) };
    const originalResult = task.resultJson;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request(), target = new URL(request.url()), path = target.pathname;
        if (target.origin !== new URL(url).origin) { errors.push("external request"); return route.abort(); }
        const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (request.method() !== "GET") {
            writes.push({ path, body: request.postDataJSON() });
            if (path === "/api/projects/p/units/u/shots") return ok({ shots: [{ id: "new-shot-1" }, { id: "new-shot-2" }] });
            errors.push("unexpected write " + path);
            return route.abort();
        }
        if (path === "/api/tasks") return ok([task]);
        if (path === "/api/tasks/" + task.id) return ok(task);
        if (path.endsWith("/chapter-apply-receipts")) return ok({ receipts: [] });
        if (path.endsWith("/character-versions")) return ok({ versions, revision: 11 });
        if (path.endsWith("/workspace")) return ok({ shots: [] });
        if (path.endsWith("/core")) return ok({ project: { id: "p", revision: 11 } });
        if (path.endsWith("/assets")) return ok({ assets });
        if (path.includes("/skills")) return ok({ skills: [] });
        if (path.startsWith("/api/")) return ok({});
        return route.continue();
    });
    await page.goto(url);
    const reviewButton = page.getByRole("button", { name: "核对后写入", exact: true });
    await reviewButton.click();
    const dialog = page.getByRole("dialog").filter({ hasText: "写入已生成的分镜" });
    const writeButton = dialog.getByRole("button", { name: "写入已生成的分镜", exact: true });
    await dialog.getByText("镜头02 · 李建国", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("镜头01 · 李建国", { exact: true }).count(), 0, "valid references must not request another selection");
    assert.ok((await dialog.innerText()).includes(wrongId), "the exact bad version ID must be visible");
    assert.ok((await dialog.innerText()).includes("该版本不存在或已被移除"));
    assert.equal(await writeButton.isDisabled(), true);
    await dialog.evaluate(async (element) => {
        await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
        const bounds = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return bounds && bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
    });
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false, "error details must fit narrow screens");
    await page.screenshot({ path: join(artifactDir, "version-repair-narrow.png") });
    await page.setViewportSize({ width: 1600, height: 1000 });
    const chooseVersion = async (label) => {
        await dialog.getByRole("combobox", { name: "核对镜头02李建国版本" }).click();
        const menu = page.locator(".ant-select-dropdown").filter({ visible: true });
        assert.equal(await menu.getByText(/其他角色/u).count(), 0, "only the same character's versions may be selected");
        await menu.getByText(label).click();
    };
    await chooseVersion(/蓝色工作服/u);
    await dialog.getByRole("combobox", { name: "核对旧信封资产" }).waitFor();
    assert.equal(await writeButton.isDisabled(), true, "later-discovered ambiguity must still block writing");
    await dialog.getByRole("combobox", { name: "核对旧信封资产" }).click();
    await page.getByText(/白色信封/u).click();
    assert.equal(await writeButton.isDisabled(), false);
    await chooseVersion(/基础造型白色外套/u);
    assert.equal(await dialog.getByRole("combobox", { name: "核对旧信封资产" }).count(), 1, "resolved choices must stay editable");
    assert.equal(await writeButton.isDisabled(), false);
    await dialog.getByRole("button", { name: "先不写入", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(writes.length, 0, "cancel after corrections must not write or regenerate");
    assert.equal(task.resultJson, originalResult);
    await reviewButton.click();
    await dialog.waitFor();
    assert.equal(await writeButton.isDisabled(), true, "cancel must not persist unchecked corrections");
    await chooseVersion(/蓝色工作服/u);
    await dialog.getByRole("combobox", { name: "核对旧信封资产" }).click();
    await page.getByText(/白色信封/u).click();
    await dialog.getByRole("combobox", { name: "核对旧信封资产" }).press("Escape");
    await page.screenshot({ path: join(artifactDir, "version-repair-ready.png") });
    await writeButton.click();
    await page.getByText("分镜写入后已跳转", { exact: true }).waitFor();
    assert.equal(writes.length, 1, "only the approved write is permitted; no new generation task");
    assert.equal(writes[0].body.sourceTaskId, task.id);
    assert.equal(writes[0].body.shots.length, rows.length);
    assert.deepEqual(writes[0].body.shots[0].assetVersionIds, [correctId]);
    assert.deepEqual(writes[0].body.shots[1].assetVersionIds.sort(), ["hero-work-v2", "white-envelope-v1"].sort());
    for (const [index, shot] of writes[0].body.shots.entries()) {
        assert.equal(shot.revision.plotDescription, rows[index].plotDescription);
        assert.ok(shot.revision.videoPrompt.includes(rows[index].videoMotionPrompt));
    }
    assert.equal(task.resultJson, originalResult, "review must not mutate the source result");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenario: "version-repair", writes: writes.length, errors, artifactDir }));
} finally { await browser.close(); }
