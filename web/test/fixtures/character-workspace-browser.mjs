import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const timestamp = "2026-11-05T00:00:00Z";
try {
    for (const theme of ["dark", "light"]) for (const width of [1500, 800, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: "reduce", acceptDownloads: true });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        const errors = [], writes = [], unexpected = [];
        let rejectConfirmation = true;
        let taskRunning = true;
        const version = (id, index, lookId, imageId, confirmed = false, assetId = "hero") => ({ assetId, title: assetId === "hero" ? "苏卉" : "韩枫", versionId: id, version: index, updatedAt: timestamp, definition: { appearance: "同一张清秀的脸", clothing: lookId, voiceTimbre: "温润" }, representations: imageId ? [{ id: `rep-${id}`, resourceId: imageId, mediaType: "image", role: "primary" }] : [], visualStatus: imageId ? "ready" : "missing", voiceStatus: "missing", referenceProfile: { lookId, name: lookId, description: `${lookId}，保持角色原本五官与身份`, enabled: true, preferred: confirmed, default: id === "base", matchHints: "", excludeHints: "" } });
        const versions = [version("base", 1, "基础形象", "face-original", true), version("combat", 2, "战甲", "combat-old", true), version("redraw", 3, "战甲", "combat-new"), version("rain", 4, "雨衣", ""), version("friend", 1, "日常", "friend-image", true, "friend")];
        const assets = ["hero", "friend"].map((id) => ({ id, title: id === "hero" ? "苏卉" : "韩枫", category: "character", mediaType: "entity", status: "confirmed", primaryVersionId: id === "hero" ? "base" : "friend", characterLookCount: id === "hero" ? 3 : 1, versionCount: id === "hero" ? 4 : 1, position: id === "hero" ? 0 : 1, usages: [], unitIds: ["u"], updatedAt: timestamp, character: versions.find((item) => item.versionId === (id === "hero" ? "base" : "friend")) }));
        const resource = (id) => ({ id, userId: "fixture", kind: "image", status: "ready", provider: "local", mimeType: "image/png", size: 200, width: 1600, height: 1200, createdAt: timestamp, updatedAt: timestamp });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { unexpected.push("external " + request.url()); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (!path.startsWith("/api/")) return route.continue();
            if (request.method() !== "GET") {
                if (path === "/api/resources" && request.method() === "POST") return ok({ resource: resource("uploaded-face") });
                const body = request.postData() ? request.postDataJSON() : {};
                writes.push({ path, body: structuredClone(body) });
                if (path.endsWith("/reference-profile")) {
                    if (rejectConfirmation && body.profile.preferred && !body.profile.default) { rejectConfirmation = false; return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "造型已被更新，请刷新后确认", reason: "conflict" } }); }
                    const selected = versions.find((item) => path.includes("/" + item.versionId + "/"));
                    assert.equal(body.expectedUpdatedAt, selected.updatedAt);
                    for (const item of versions.filter((item) => item.assetId === selected.assetId)) {
                        if (body.profile.preferred && item.referenceProfile.lookId === body.profile.lookId) item.referenceProfile.preferred = false;
                        if (body.profile.default) item.referenceProfile.default = false;
                    }
                    selected.referenceProfile = body.profile;
                    return ok({ saved: true });
                }
                if (path.endsWith("/looks")) {
                    assert.equal(body.baseVersionId, "base");
                    assert.equal(body.definition.appearance, "同一张清秀的脸");
                    assert.equal(body.definition.voiceTimbre, "温润");
                    const added = { ...version("new-look", 5, "new-look-id", ""), definition: body.definition, referenceProfile: { ...body.profile, lookId: "new-look-id" } };
                    versions.push(added);
                    return ok({ version: { id: "new-look", version: 5, assetId: "hero" } });
                }
                if (path.endsWith("/representations")) {
                    const base = versions.find((item) => item.versionId === body.baseVersionId);
                    const added = { ...base, versionId: `upload-${versions.length}`, version: versions.length + 1, representations: body.representations.map((item, index) => ({ ...item, id: `uploaded-rep-${versions.length}-${index}`, mediaType: "image" })), referenceProfile: { ...base.referenceProfile, preferred: false, default: false } };
                    versions.push(added);
                    return ok({ character: added });
                }
                unexpected.push(request.method() + " " + path); return route.abort();
            }
            if (path === "/api/projects/p/assets") return ok({ assets, total: assets.length, page: 1, pageSize: 40, hasMore: false, categoryCounts: { character: 2 }, folderCounts: {}, unitCounts: { u: 2 } });
            if (path.endsWith("/asset-folders")) return ok({ folders: [] });
            if (path.endsWith("/asset-candidates")) return ok({ candidates: [], total: 0, page: 1, pageSize: 24, hasMore: false });
            if (path.endsWith("/character-versions")) return ok({ versions, revision: 1 });
            if (path === "/api/projects/p/core") return ok({ project: { id: "p", characterFacePresetsJson: "{}" } });
            if (path === "/api/tasks") return ok(taskRunning ? [{ id: "rain-task", projectId: "p", status: "running", type: "canvas_image", clientContext: { nodeId: "character-turnaround:hero", characterVersionId: "rain" }, createdAt: timestamp, updatedAt: timestamp }] : []);
            if (path === "/api/assets") return ok({ assets: [{ id: "library-image", title: "战甲素材原图", kind: "image", category: "character", status: "confirmed", coverUrl: "", tags: [], createdAt: timestamp, updatedAt: timestamp, data: { storageKey: "resource:library-original", dataUrl: "", width: 1600, height: 1200, bytes: 200, mimeType: "image/png" } }], total: 1, page: 1, pageSize: 40, hasMore: false });
            if (path.startsWith("/api/resources/") && path.endsWith("/file")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#ddd6c8"/><circle cx="800" cy="330" r="140" fill="#ad8b77"/><path d="M400 1150V700Q800 470 1200 700V1150" fill="#455f72"/></svg>' });
            if (path.startsWith("/api/resources/")) return ok({ resource: resource(path.split("/").at(-1)) });
            unexpected.push("GET " + path); return route.fulfill({ status: 500, body: "unexpected API" });
        });
        try {
            await page.goto(`${url}?assets=1&theme=${theme}`);
            const workspace = page.locator(".character-asset-workspace");
            const nav = page.getByRole("navigation", { name: "项目角色列表" });
            const card = (id) => workspace.locator(`.character-look-grid > [data-version-id="${id}"]`);
            await card("base").getByText("已确认选用", { exact: true }).waitFor();
            await card("rain").getByText("正在生成", { exact: true }).waitFor();
            assert.equal(await workspace.locator(".character-look-card").count(), 3);
            assert.equal(await card("base").getByRole("button", { name: "重新生成" }).isEnabled(), true);
            assert.equal(await card("rain").getByRole("button", { name: "生成图片" }).isDisabled(), true);
            assert.equal(await card("base").getByLabel("上传 基础形象 图片").isEnabled(), true);
            await nav.getByRole("button").filter({ hasText: "韩枫" }).click();
            await card("friend").waitFor();
            await page.waitForFunction(() => ![...document.querySelectorAll('[data-version-id="friend"] button')].find((element) => element.textContent.includes("重新生成"))?.disabled);
            assert.equal(await card("friend").getByRole("button", { name: "重新生成" }).isEnabled(), true);
            await nav.getByRole("button").filter({ hasText: "苏卉" }).click();
            await card("base").waitFor();
            assert.equal(await workspace.locator(".character-look-panel").evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
            await workspace.screenshot({ path: join(artifactDir, `${theme}-${width}-workspace.png`) });
            await card("combat").getByRole("button", { name: /查看.*新图/ }).click();
            const history = page.getByRole("dialog").filter({ hasText: "战甲 · 图片历史" });
            const newPicture = history.locator('[data-version-id="redraw"]');
            await newPicture.getByRole("button", { name: "确认选用", exact: true }).click();
            await newPicture.getByText("造型已被更新，请刷新后确认", { exact: true }).waitFor();
            assert.equal(versions.find((item) => item.versionId === "combat").referenceProfile.preferred, true);
            await newPicture.getByRole("button", { name: "确认选用", exact: true }).click();
            await newPicture.getByText("已确认选用", { exact: true }).waitFor();
            await page.keyboard.press("Escape");
            await history.waitFor({ state: "hidden" });
            await card("redraw").waitFor();
            assert.equal(versions.find((item) => item.versionId === "combat").referenceProfile.preferred, false);
            await card("redraw").getByRole("button", { name: "设为默认", exact: true }).click();
            await card("redraw").getByText("默认", { exact: true }).waitFor();
            assert.equal(versions[0].referenceProfile.default, false);
            await page.reload();
            await card("redraw").getByText("已确认选用", { exact: true }).waitFor();
            const baseFace = workspace.getByAltText("苏卉基础人脸参考");
            await baseFace.waitFor();
            await card("redraw").getByRole("button", { name: "重新生成", exact: true }).click();
            const generation = page.getByRole("dialog").filter({ hasText: "生成角色三视图 · 苏卉" });
            await generation.getByText("继承基础版 v1 的人脸 · 通过图片编辑生成新造型，不重新设计人物", { exact: true }).waitFor();
            await generation.getByRole("button", { name: /取\s*消/, exact: true }).click();
            taskRunning = false;
            await workspace.getByRole("button", { name: "刷新造型" }).click();
            await card("rain").getByRole("button", { name: "生成图片" }).waitFor({ state: "visible" });
            await workspace.getByRole("button", { name: "新增造型", exact: true }).click();
            const creator = page.getByRole("dialog").filter({ hasText: "新增造型 · 苏卉" });
            assert.equal(await creator.getByRole("textbox").filter({ visible: true }).count(), 2);
            await creator.getByLabel("新造型名称", { exact: true }).fill("雨夜战甲");
            await creator.getByLabel("与基础形象的差异", { exact: true }).fill("换深色战甲，肩部沾雨，保持原本人脸。");
            await creator.getByRole("button", { name: "创建造型", exact: true }).click();
            await creator.waitFor({ state: "hidden" });
            await card("new-look").waitFor();
            assert.equal(versions.find((item) => item.versionId === "new-look").definition.clothing, "换深色战甲，肩部沾雨，保持原本人脸。");
            if (width === 1500) {
                await card("redraw").getByRole("button", { name: "素材库选图", exact: true }).click();
                const picker = page.getByRole("dialog").filter({ hasText: "直接使用素材库图片" });
                await picker.getByText("战甲素材原图", { exact: true }).click();
                await picker.getByRole("button", { name: "直接用作资产图", exact: true }).click();
                await picker.waitFor({ state: "hidden" });
                const imported = versions.at(-1);
                assert.equal(imported.representations[0].resourceId, "library-original");
                assert.equal(imported.referenceProfile.preferred, false);
                await card(imported.versionId).getByRole("button", { name: "确认选用", exact: true }).click();
                await card(imported.versionId).getByText("已确认选用", { exact: true }).waitFor();
                const preview = card(imported.versionId).getByRole("button", { name: "预览造型 战甲", exact: true });
                await preview.click();
                const imageDialog = page.getByRole("dialog").filter({ hasText: "苏卉 · 战甲" });
                const downloadPromise = page.waitForEvent("download");
                await imageDialog.getByRole("button", { name: "下载原图", exact: true }).click();
                const download = await downloadPromise;
                assert.equal(await download.failure(), null);
                await download.saveAs(join(artifactDir, `${theme}-look-original.png`));
                await page.keyboard.press("Escape");
                await imageDialog.waitFor({ state: "hidden" });
                await card("new-look").getByLabel("上传 雨夜战甲 图片").setInputFiles({ name: "face.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=", "base64") });
                await workspace.locator('[data-version-id="upload-7"]').waitFor();
                assert.equal(versions.at(-1).representations[0].resourceId, "uploaded-face");
                assert.equal(versions.at(-1).referenceProfile.preferred, false);
            }
            assert.ok(!writes.some((write) => write.path === "/api/tasks"), "browser operations must never generate paid media");
            assert.deepEqual(errors, []);
            assert.deepEqual(unexpected, []);
            console.log(`PASS workspace ${theme}/${width}: real asset page, independent tasks, confirmation/reload, history, default/base isolation, new look${width === 1500 ? ", library, download, upload" : ""}`);
        } catch (error) {
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-workspace-failure.png`), fullPage: true });
            console.error(JSON.stringify({ errors, writes, unexpected, artifactDir, body: await page.locator("body").innerText() }));
            throw error;
        } finally { await context.close(); }
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
