import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir, scenario] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["dark", "light"]) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1050 }, reducedMotion: "reduce", acceptDownloads: true });
        const page = await context.newPage();
        const errors = [];
        const unexpected = [];
        const removals = [];
        const resourceRequests = [];
        const confirmations = [];
        const imageBindings = [];
        let rejectRemoval = true;
        let removed = false;
        const character = { id: "character", title: "下载角色", category: "character", mediaType: "entity", status: "confirmed", storageKey: "resource:wrong-entity-storage", primaryVersionId: "selected-version", versionCount: 2, position: 0, usages: [], updatedAt: "2026-11-03T00:00:00Z", character: { versionId: "selected-version", version: 2, definition: {}, visualStatus: "ready", voiceStatus: "missing", representations: scenario === "missing-image" ? [] : [{ id: "selected-image", resourceId: "selected-original", mediaType: "image", role: "turnaround_sheet" }] } };
        const media = { id: "media", title: "移除道具", category: "prop", mediaType: "image", status: "confirmed", storageKey: "resource:prop-original", primaryVersionId: "prop-version", versionCount: 1, position: 1, usages: [], updatedAt: character.updatedAt };
        if (scenario === "library-bind") { media.mediaType = "text"; media.storageKey = ""; media.definitionJson = '{"description":"道具造型"}'; }
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request();
            const parsed = new URL(request.url());
            if (parsed.origin !== new URL(url).origin) { unexpected.push(request.url()); return route.abort(); }
            const path = parsed.pathname;
            if (!path.startsWith("/api/")) return route.continue();
            const json = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (path === "/api/assets") return json({ assets: [{ id: "library-image", kind: "image", title: "素材库原图", coverUrl: "", category: "prop", status: "confirmed", source: "upload", tags: [], createdAt: character.updatedAt, updatedAt: character.updatedAt, data: { dataUrl: "", storageKey: "resource:library-original", width: 4096, height: 2048, bytes: 16000000, mimeType: "image/png" } }], total: 1, page: 1, pageSize: 40, hasMore: false });
            if (path === "/api/projects/actions-project/assets/media/replace-image" && request.method() === "POST") { imageBindings.push(request.postDataJSON()); return json({asset:media}); }
            if (path === "/api/projects/actions-project/assets") {
                const assets = removed ? [character] : [character, media];
                return json({ assets, categoryCounts: { character: 1, prop: removed ? 0 : 1 }, folderCounts: {}, unitCounts: {}, total: assets.length, page: 1, pageSize: 40, hasMore: false });
            }
            if (path === "/api/projects/actions-project/asset-folders") return json({ folders: [] });
            if (path === "/api/projects/actions-project/asset-candidates") {
                const candidates = scenario === "candidate-look" && !confirmations.length ? [{id:"look-candidate", projectId:"actions-project", name:"纪昼", category:"character", status:"pending_confirmation", detailsJson:JSON.stringify({_characterMatch:{assetId:"original-character", title:"纪昼", mode:"new_look", description:"寒潮围巾：沿用原有训练服；差异：新增围巾；原文：程野给她围上围巾"}}), createdAt:character.updatedAt, updatedAt:character.updatedAt}] : [];
                return json({ candidates, total:candidates.length, page:1, pageSize:24, hasMore:false });
            }
            if (path === "/api/projects/actions-project/character-versions") return json({revision:1, versions:[{assetId:"original-character", title:"纪昼", versionId:"original-look", version:1, definition:{}, representations:[], visualStatus:"missing", voiceStatus:"missing", updatedAt:character.updatedAt}]});
            if (path === "/api/projects/actions-project/asset-candidates/look-candidate/confirm") { confirmations.push(request.postDataJSON()); return json({asset:character}); }
            if (path === "/api/tasks") return json({ tasks: [] });
            if (request.method() === "DELETE" && path.startsWith("/api/projects/actions-project/assets/")) {
                removals.push(path);
                if (rejectRemoval) return route.fulfill({ status: 400, json: { code: 400, data: null, msg: path.endsWith("/character") ? "角色仍被项目画布引用，请先删除对应角色卡节点" : "素材仍被分镜引用，请先解除对应镜头绑定", reason: "asset_still_referenced" } });
                removed = true;
                return json({ unlinked: true });
            }
            if (path.startsWith("/api/resources/") && path.endsWith("/file")) {
                resourceRequests.push({ path, headers: request.headers(), query: parsed.search });
                if (request.headers()["x-desktop-token"] !== "offline-asset-actions-token") return route.fulfill({ status: 401, body: "desktop token required" });
                if (scenario === "download-error" && path.includes("selected-original")) return route.fulfill({ status: 404, body: "missing image" });
                return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=", "base64") });
            }
            unexpected.push(`${request.method()} ${path}`);
            return route.fulfill({ status: 500, body: "unexpected offline API" });
        });
        try {
            await page.goto(`${url}?theme=${theme}&scenario=${scenario}`);
            await page.getByRole("button", { name: "查看角色卡：下载角色", exact: true }).waitFor({ timeout: 10000 });
            if (scenario === "library-bind") {
                await page.getByRole("button", {name:"生成道具图", exact:true}).click();
                await page.getByRole("button", {name:"直接使用素材库图片", exact:true}).click();
                await page.getByText("素材库原图", {exact:true}).click();
                await page.getByRole("button", {name:"直接用作资产图", exact:true}).click();
                await page.getByRole("dialog").filter({hasText:"生成道具图 · 移除道具"}).waitFor({state:"hidden"});
                assert.deepEqual(imageBindings, [{resourceId:"library-original"}]);
            } else if (scenario === "candidate-look") {
                await page.getByText("差异：新增围巾", {exact:false}).waitFor({state:"visible", timeout:5000});
                assert.equal(await page.getByRole("button", {name:"确认新角色", exact:true}).count(), 0);
                await page.screenshot({path:join(artifactDir, `${theme}-candidate-look-before-confirm.png`)});
                await page.getByRole("button", {name:"归入纪昼的新造型", exact:true}).click();
                await page.getByRole("button", {name:"归入纪昼的新造型", exact:true}).waitFor({state:"hidden"});
                assert.equal(confirmations.length, 1);
                assert.ok(!confirmations[0].assetId, "default confirmation must let backend revalidate identity instead of trusting client metadata");
            } else if (scenario === "remove") {
                await page.getByRole("button", { name: "移出 下载角色", exact: true }).click();
                await page.locator(".ant-popconfirm").getByRole("button", { name: /取\s*消/ }).click();
                await page.locator(".ant-popconfirm:visible").waitFor({ state: "hidden" });
                assert.equal(removals.length, 0, "cancel must not unlink an asset");
                for (const [title, expected] of [["下载角色", "角色仍被项目画布引用，请先删除对应角色卡节点"], ["移除道具", "素材仍被分镜引用，请先解除对应镜头绑定"]]) {
                    await page.getByRole("button", { name: `移出 ${title}`, exact: true }).click();
                    await page.locator(".ant-popconfirm").getByRole("button", { name: /移\s*出/ }).click();
                    await page.getByRole("alert").filter({ hasText: expected }).waitFor({ state: "visible", timeout: 3000 });
                    await page.locator(".ant-popconfirm:visible").waitFor({ state: "hidden" });
                    assert.equal(await page.getByRole("button", { name: `移出 ${title}`, exact: true }).count(), 1, "rejected removal must retain its card");
                }
                assert.equal(removals.length, 2);
                rejectRemoval = false;
                await page.getByRole("button", { name: "移出 移除道具", exact: true }).click();
                await page.locator(".ant-popconfirm").getByRole("button", { name: /移\s*出/ }).click();
                await page.getByRole("button", { name: "移出 移除道具", exact: true }).waitFor({ state: "hidden" });
                await page.getByRole("alert").filter({ hasText: "素材仍被分镜引用" }).waitFor({ state: "hidden" });
            } else {
                await page.getByRole("button", { name: "查看角色卡：下载角色", exact: true }).click();
                const dialog = page.getByRole("dialog").filter({ hasText: "角色卡预览" });
                if (scenario === "missing-image") {
                    assert.equal(await dialog.getByRole("button", { name: "下载", exact: true }).count(), 0, "a character without an image must not export entity storage");
                } else if (scenario === "download-error") {
                    await dialog.getByRole("button", { name: "下载", exact: true }).click();
                    await dialog.getByRole("alert").waitFor({ state: "visible", timeout: 3000 });
                    assert.match(await dialog.getByRole("alert").innerText(), /下载|读取|资源/);
                } else {
                    const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
                    await dialog.getByRole("button", { name: "下载", exact: true }).click();
                    const download = await downloadPromise;
                    assert.equal(await download.failure(), null);
                    assert.equal(download.suggestedFilename(), "下载角色.png");
                    await download.saveAs(join(artifactDir, `${theme}-selected-original.png`));
                    assert.ok(resourceRequests.some((request) => request.path.includes("/selected-original/")));
                    assert.ok(resourceRequests.every((request) => request.headers["x-desktop-token"] === "offline-asset-actions-token"));
                    assert.ok(resourceRequests.every((request) => !request.path.includes("wrong-entity-storage")), "download must use the displayed original representation");
                }
            }
            await page.screenshot({ path: join(artifactDir, `${theme}-${scenario}.png`) });
            assert.deepEqual(unexpected, []);
            assert.deepEqual(errors, []);
            console.log(`${theme}/${scenario}: PASS`);
        } catch (error) {
            await page.screenshot({ path: join(artifactDir, `${theme}-${scenario}-failure.png`) });
            console.error(JSON.stringify({ scenario, errors, unexpected, removals, resourceRequests, body: await page.locator("body").innerText(), artifactDir }));
            throw error;
        } finally {
            await context.close();
        }
    }
    console.log(JSON.stringify({ scenario, artifactDir }));
} finally {
    await browser.close();
}
