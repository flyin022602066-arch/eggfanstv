import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, reducedMotion: "reduce" });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        const timestamp = "2026-11-12T00:00:00Z";
        const errors = [], unexpected = [], saves = [];
        let definition = { characterType: "group", role: "【群体演员】工人与食客在凉粉摊前", appearance: "成年男子，不同面孔", clothing: "蓝灰工装与日常衣服", physique: "高矮不同" };
        const character = () => ({ assetId: "extras", title: "买凉粉的工人与食客群像", versionId: "group-base", version: 1, updatedAt: timestamp, definition, representations: [], visualStatus: "missing", voiceStatus: "missing", referenceProfile: { lookId: "group-look", name: "群体基础设定", description: "工人和食客，各自不同面孔", enabled: true, preferred: false, default: false, matchHints: "", excludeHints: "" } });
        const asset = () => ({ id: "extras", title: "买凉粉的工人与食客群像", category: "character", mediaType: "entity", status: "confirmed", primaryVersionId: "group-base", versionCount: 1, characterLookCount: 1, position: 0, usages: [], unitIds: [], updatedAt: timestamp, character: character() });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { unexpected.push("external " + target.origin); return route.abort(); }
            if (!path.startsWith("/api/")) return route.continue();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() === "PATCH" && path === "/api/projects/p/characters/extras") {
                const body = request.postDataJSON();
                saves.push(body);
                definition = { ...body.definition };
                return ok({ asset: asset(), character: character() });
            }
            if (request.method() !== "GET") { unexpected.push(request.method() + " " + path); return route.abort(); }
            if (path === "/api/projects/p/assets") return ok({ assets: [asset()], total: 1, page: 1, pageSize: 40, hasMore: false, categoryCounts: { character: 1 }, folderCounts: {}, unitCounts: {} });
            if (path.endsWith("/asset-folders")) return ok({ folders: [] });
            if (path.endsWith("/asset-candidates")) return ok({ candidates: [{ id: "group-candidate", projectId: "p", name: "工人与食客群像", category: "character", status: "pending_confirmation", detailsJson: JSON.stringify({ characterType: "group" }), createdAt: timestamp, updatedAt: timestamp }], total: 1, page: 1, pageSize: 24, hasMore: false });
            if (path.endsWith("/character-versions")) return ok({ versions: [character()], revision: 1 });
            if (path === "/api/projects/p/core") return ok({ project: { id: "p", characterFacePresetsJson: JSON.stringify({ male: { resourceId: "hero-face", assetIds: ["extras"], useAsIdentity: true } }) } });
            if (path === "/api/tasks") return ok([]);
            if (path === "/api/assets") return ok({ assets: [], total: 0, page: 1, pageSize: 40, hasMore: false });
            if (path === "/api/asset-folders") return ok({ folders: [] });
            unexpected.push(request.method() + " " + path);
            return route.abort();
        });
        await page.goto(url + "?assets=1&theme=" + theme);
        await page.getByText("待确认群体演员", { exact: false }).waitFor();
        const workspace = page.locator(".character-asset-workspace");
        await workspace.getByText("群体演员参考", { exact: true }).waitFor();
        assert.equal(await workspace.getByText("基础身份参考", { exact: true }).count(), 0);
        await workspace.getByRole("button", { name: "编辑角色", exact: true }).click();
        let dialog = page.getByRole("dialog");
        await dialog.getByText("群体演员（不同面孔）", { exact: true }).waitFor();
        await dialog.getByLabel("角色类型", { exact: true }).click();
        await page.getByText("单人角色", { exact: true }).last().click();
        await dialog.getByRole("button", { name: "保存角色设定" }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(saves.at(-1).definition.characterType, "individual");
        await workspace.getByRole("button", { name: "编辑角色", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("角色类型", { exact: true }).click();
        await page.getByText("群体演员（不同面孔）", { exact: true }).last().click();
        await dialog.getByRole("button", { name: "保存角色设定" }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(saves.at(-1).definition.characterType, "group");
        await page.reload();
        await workspace.getByText("群体演员参考", { exact: true }).waitFor();
        await workspace.getByRole("button", { name: "生成图片", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByText("生成群体演员设定图 · 买凉粉的工人与食客群像", { exact: true }).waitFor();
        await dialog.getByText("群体演员：分别设计不同面孔，不使用单人基础版锁脸或男女主人脸预设。", { exact: true }).waitFor();
        assert.equal(await dialog.getByText(/已启用男主/).count(), 0);
        assert.equal(await dialog.getByText("角色设定图固定包含：", { exact: false }).count(), 0);
        await dialog.getByText("当前群体的人数、服饰与同框构图补充要求（仅本次）", { exact: true }).waitFor();
        assert.equal(await dialog.getByText("当前角色的头部特写与三视图补充要求（仅本次）", { exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
        await page.screenshot({ path: join(artifactDir, "group-" + theme + ".png"), fullPage: true });
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        assert.equal(saves.length, 2);
        await context.close();
    }
    console.log(JSON.stringify({ passed: true, themes: ["light", "dark"], assertions: "group selector persistence, group image dialog, no face preset, no single-person layout, no network generation", artifactDir }));
} finally { await browser.close(); }
