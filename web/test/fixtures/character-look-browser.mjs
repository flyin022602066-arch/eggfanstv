import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const timestamp = "2026-11-02T00:00:00Z";
try {
    for (const theme of ["dark", "light"]) for (const width of [1500, 800, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.setDefaultTimeout(8000);
        const errors = [], writes = [], resourceReads = [];
        let revision = 1;
        let rejectRemoval = true;
        let shotBusy = false;
        const extraAssets = [
            { id: "phone-a", title: "云舒的手机", category: "prop", mediaType: "image", primaryVersionId: "phone-a-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
            { id: "phone-b", title: "周行旻的电话设备", category: "prop", mediaType: "image", primaryVersionId: "phone-b-v1", definitionJson: JSON.stringify({ aliases: ["手机"] }) },
        ], extraReferences = [];
        const versions = ["白衣日常", "黑甲战斗"].map((name, index) => ({ assetId: "hero", title: "苏卉", versionId: "v" + index, version: index + 1, updatedAt: timestamp, definition: { clothing: name }, visualStatus: "ready", voiceStatus: "missing", representations: [{ id: "rep" + index, resourceId: "img" + index, mediaType: "image", role: "primary" }], referenceProfile: { lookId: "look" + index, name, description: name, matchHints: name, excludeHints: "", enabled: true, preferred: true, default: index === 0 } }));
        versions[0].representations.push({ id: "front-rep", resourceId: "front-image", mediaType: "image", role: "front" });
        const asset = { id: "hero", title: "苏卉", category: "character", mediaType: "entity", primaryVersionId: "v0", character: versions[0], versionCount: 2, position: 0, usages: [], status: "confirmed" };
        const longName = "总公司总裁办公室造型，商务正装领带与长款外套，保持原著服装人物一致";
        versions.push({ ...versions[0], versionId: "blank-history", version: 3, definition: { clothing: "造型1：黑裙开衫；造型2：粉色兔耳睡衣；造型3：白衣灰裤" }, representations: [], referenceProfile: undefined });
        versions.push({ ...versions[1], versionId: "redraw-history", version: 4, representations: [], referenceProfile: { ...versions[1].referenceProfile, preferred: false, default: false } });
        versions[1].referenceProfile.name = longName;
        versions[1].referenceProfile.preferred = false;
        const ref = { id: "r", shotId: "s", assetVersionId: "v0", role: "reference", status: "linked", selectionStatus: "resolved", selectionSource: "auto", selectionRevisionId: "sr", selectionLocked: false, selectionReason: "原文白衣", asset, referencedVersion: { id: "v0", assetId: "hero", version: 1, representations: versions[0].representations } };
        const workspace = () => ({ unit: { id: "u", sourceText: "苏卉穿白衣" }, shots: [{ id: "s", projectId: "p", unitId: "u", title: "镜头1", currentRevisionId: "sr", position: 0, description: "苏卉穿白衣", durationMs: 30000, status: "active", createdAt: timestamp, updatedAt: timestamp }], shotRevisions: [{ id: "sr", shotId: "s", shotSize: "近景", version: 1, plotDescription: "苏卉穿白衣", videoPrompt: "苏卉穿白衣走到窗前。", actionBeatsJson: "[]" }], shotReferences: [ref, ...extraReferences], shotArtifacts: [], tasks: shotBusy ? [{ id: "busy-shot-task", status: "running", clientContext: { shotId: "s" } }] : [] });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("409 (Conflict)")) errors.push(message.text()); });
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request"); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                const body = request.postData() ? request.postDataJSON() : {};
                writes.push({ path, body });
                if (request.method() === "DELETE" && path === "/api/projects/p/shots/s/assets/r") return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "镜头正在生成，暂时不能取消资产引用", reason: "conflict" } });
                if (request.method() === "DELETE" && path.includes("/versions/")) {
                    if (rejectRemoval) { rejectRemoval = false; return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "该版本仍被镜头03引用，请先更换绑定", reason: "resource_referenced" } }); }
                    const index = versions.findIndex((version) => path.endsWith("/" + version.versionId));
                    assert.ok(index >= 0);
                    versions.splice(index, 1); revision++; return ok({ deleted: true });
                }
                if (path.endsWith("/character-references")) {
                    assert.equal(body.expectedRevision, revision);
                    const choice = body.choices[0];
                    assert.equal(choice.expectedShotRevisionId, "sr");
                    if (choice.assetId !== "hero") {
                        const selected = versions.find((version) => version.versionId === choice.versionId);
                        const saved = { id: choice.assetId + "-ref", shotId: "s", assetVersionId: choice.versionId, role: "reference", status: "linked", selectionStatus: choice.status, selectionSource: choice.source, selectionReason: choice.reason, selectionLocked: choice.locked, selectionRevisionId: "sr", asset: extraAssets.find((item) => item.id === choice.assetId), referencedVersion: { ...selected, id: selected.versionId } };
                        const existing = extraReferences.find((item) => item.id === saved.id);
                        if (existing) Object.assign(existing, saved); else extraReferences.push(saved);
                        revision++;
                        return ok({ saved: true });
                    }
                    Object.assign(ref, { assetVersionId: choice.versionId, selectionLocked: choice.locked, selectionStatus: choice.status, selectionSource: choice.source, selectionReason: choice.reason });
                    const selected = versions.find((version) => version.versionId === choice.versionId);
                    ref.referencedVersion = { ...selected, id: selected.versionId };
                    revision++;
                    return ok({ saved: true });
                }
                if (request.method() === "POST" && path === "/api/projects/p/characters") {
                    assert.equal(body.name, "陈尧");
                    assert.equal(body.definition.appearance, "年轻男子，青色长袍");
                    const character = { ...versions[0], assetId: "new-cast", title: body.name, versionId: "new-cast-v1", version: 1, definition: body.definition, representations: [], referenceProfile: undefined, visualStatus: "missing" };
                    const created = { ...asset, id: character.assetId, title: body.name, primaryVersionId: character.versionId, character, versionCount: 1 };
                    versions.push(character); extraAssets.push(created); revision++;
                    return ok({ asset: created, character });
                }
                if (path.endsWith("/reference-profile")) { versions.find((v) => path.includes("/" + v.versionId + "/")).referenceProfile = body.profile; revision++; return ok({ saved: true }); }
                if (path.endsWith("/looks/extract")) {
                    const looks = ["居家02", "居家01", "前置01"].map((name, index) => ({ ...versions[0], versionId: `split-${index}`, version: index + 3, definition: { appearance: "黑发", clothing: ["黑裙开衫", "粉色兔耳睡衣", "白衣灰裤"][index] }, representations: [], referenceProfile: { lookId: `split-${index}`, name, description: name, matchHints: "", excludeHints: "", enabled: true, preferred: false, default: false } }));
                    versions.push(...looks); revision++;
                    return ok({ versions: looks.map((look) => ({ id: look.versionId })) });
                }
                errors.push("unexpected write: " + path); return route.abort();
            }
            if (path.endsWith("/character-versions")) return ok({ revision, versions });
            if (path.endsWith("/workspace")) {
                const data = workspace();
                data.shotRevisions[0].videoPrompt += "苏卉拿起手机。";
                data.shotRevisions[0].actionBeatsJson = JSON.stringify([{ type: "asset_context", propNames: ["手机"] }]);
                return ok(data);
            }
            if (path.endsWith("/assets")) return ok({ assets: [asset, ...extraAssets] });
            if (path === "/api/projects/p/core") return ok({ project: { id: "p", characterFacePresetsJson: "{}" } });
            if (path === "/api/tasks") return ok([]);
            if (path.includes("/resources/")) { resourceReads.push(path); return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#555"/><circle cx="120" cy="80" r="35" fill="#ddd"/><path d="M55 230V150Q120 100 185 150V230" fill="#aaa"/></svg>' }); }
            if (path.startsWith("/api/")) return ok({});
            return route.continue();
        });
        await page.goto(url + "?theme=" + theme);
        assert.equal(await page.title(), "Eggfans TV character look test");
        const panel = page.getByRole("region", { name: "角色造型参考" });
        await panel.getByText("自动选择", { exact: true }).waitFor();
        await panel.locator(".workflow-character-reference-preview img").waitFor();
        assert.ok(resourceReads.some((path) => path.includes("front-image")), "closeup card must preview the same front representation used for generation");
        assert.equal(await page.locator("vite-error-overlay").count(), 0);
        await page.getByRole("button", { name: "切换脚本未保存" }).click();
        assert.equal(await panel.getByRole("button", { name: "识别本镜", exact: true }).isDisabled(), true);
        assert.equal(await panel.getByRole("combobox").isDisabled(), true);
        assert.equal(await panel.getByRole("button", { name: "锁定", exact: true }).isDisabled(), true);
        await page.getByRole("button", { name: "切换脚本未保存" }).click();
        await panel.locator(".ant-select").click();
        const selectedImageLoaded = page.waitForResponse((response) => new URL(response.url()).pathname.includes("img1"));
        await page.locator(".ant-select-item-option").filter({ hasText: longName }).click();
        await selectedImageLoaded;
        await panel.getByText("已锁定", { exact: true }).waitFor();
        assert.equal(writes[0].body.choices[0].versionId, "v1");
        assert.ok(resourceReads.some((path) => path.includes("img1")), "selecting an unfinalized version must preview its image, not the primary image");
        await panel.getByRole("button", { name: "解锁", exact: true }).click();
        await panel.getByText("手动确认", { exact: true }).waitFor();
        assert.equal(writes[1].body.choices[0].locked, false);
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-sidebar.png`) });
        ref.selectionStatus = "pending";
        await page.reload();
        await panel.getByText("待确认", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "确认并锁定", exact: true }).click();
        await panel.getByText("已锁定", { exact: true }).waitFor();
        assert.equal(writes[2].body.choices[0].status, "resolved");
        await panel.getByRole("button", { name: "管理造型" }).click();
        const dialog = page.getByRole("dialog").filter({ hasText: "造型与版本 · 苏卉" });
        await dialog.getByText("造型与版本 · 苏卉", { exact: true }).waitFor();
        await dialog.locator('[data-version-id="v1"]').waitFor();
        assert.equal(await dialog.getByRole("button", { name: "当前镜头正在使用此版本" }).isDisabled(), true);
        assert.equal(await dialog.locator(".character-look-card").count(), 2, "blank and superseded history must not occupy default slots");
        const layout = await dialog.locator(".character-look-grid").evaluate((element) => ({ overflow: element.scrollWidth > element.clientWidth + 1, columns: getComputedStyle(element).gridTemplateColumns.split(" ").length }));
        assert.equal(layout.overflow, false);
        if (width >= 800) assert.ok(layout.columns >= 2, "wide modal must display cards in multiple columns");
        await dialog.locator('[data-version-id="v0"]').getByRole("button", { name: "编辑设定", exact: true }).click();
        const settings = page.getByRole("dialog").filter({ hasText: "编辑造型设置" });
        await settings.getByLabel("造型名称", { exact: true }).fill("日常白衣定稿");
        await settings.getByRole("button", { name: "保存造型设置" }).click();
        await settings.waitFor({ state: "hidden" });
        await dialog.getByText("日常白衣定稿", { exact: true }).waitFor();
        assert.equal(writes[3].body.profile.name, "日常白衣定稿");
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-manager.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        assert.deepEqual(errors, []);
        assert.equal(writes.length, 4, "no media or model tasks submitted");
        await dialog.getByRole("button", { name: "拆分已有造型设定" }).click();
        await dialog.getByRole("heading", { name: "居家02", exact: true }).waitFor();
        await dialog.getByRole("heading", { name: "居家01", exact: true }).waitFor();
        await dialog.getByRole("heading", { name: "前置01", exact: true }).waitFor();
        assert.equal(writes[4].path, "/api/projects/p/characters/hero/looks/extract");
        assert.equal(writes[4].body.expectedUpdatedAt, timestamp);
        await dialog.getByRole("button", { name: "补齐 3 套缺图" }).click();
        const preview = page.getByRole("dialog").filter({ hasText: "本次将提交 3 套造型，每套一个独立图片任务" });
        await preview.getByText("本次将提交 3 套造型，每套一个独立图片任务", { exact: true }).waitFor();
        await preview.getByText("继承基础版 v1 的人脸 · 通过图片编辑生成新造型，不重新设计人物", { exact: true }).waitFor();
        await preview.getByAltText("本次生成的人脸参考").waitFor();
        assert.ok(resourceReads.some((path) => path.includes("img0")), "variant generation must preview the original base face, not the variant's image");
        await preview.getByRole("button", { name: /取\s*消/u, exact: true }).waitFor();
        await page.screenshot({ path: join(artifactDir, `${theme}-${width}-three-look-preview.png`) });
        await preview.getByRole("button", { name: /取\s*消/u, exact: true }).click();
        assert.equal(writes.length, 5, "opening batch parameters must not submit generation");
        await dialog.getByRole("button", { name: "全部历史", exact: true }).click();
        const history = page.getByRole("dialog").filter({ hasText: "全部图片与设定历史" });
        const blank = history.locator('[data-version-id="blank-history"]');
        await blank.getByRole("button", { name: /删除.*此版本/u }).click();
        await page.locator(".ant-modal-confirm").getByRole("button", { name: "删除此版本", exact: true }).click();
        await history.getByText("该版本仍被镜头03引用，请先更换绑定", { exact: true }).waitFor();
        await page.locator(".ant-modal-confirm").waitFor({ state: "hidden" });
        await blank.getByRole("button", { name: /删除.*此版本/u }).click();
        await page.locator(".ant-modal-confirm").getByRole("button", { name: "删除此版本", exact: true }).click();
        await blank.waitFor({ state: "hidden" });
        assert.equal(writes.length, 7, "only profile, reference, extract and explicit version removal writes allowed");
        assert.deepEqual(errors, []);
        await history.locator(".ant-modal-close").click();
        await history.waitFor({ state: "hidden" });
        const redraw = versions.find((version) => version.versionId === "redraw-history");
        redraw.representations = [{ id: "redraw-image", resourceId: "redraw-image", mediaType: "image", role: "primary" }];
        await dialog.getByRole("button", { name: "刷新造型", exact: true }).click();
        await dialog.locator('[data-version-id="v1"]').getByRole("button", { name: /查看.*新图/u }).click();
        const redrawHistory = page.getByRole("dialog").filter({ hasText: `${longName} · 图片历史` });
        await redrawHistory.locator('[data-version-id="redraw-history"]').getByRole("button", { name: "返回卡片查看" }).click();
        await dialog.locator('[data-version-id="redraw-history"]').waitFor();
        assert.equal(await dialog.locator(".character-look-card").count(), 5, "reviewing a redraw replaces the group representative instead of adding empty slots");
        assert.equal(writes.length, 7, "reviewing a completed image must not submit a task or change bindings");
        if (width === 1500) {
            await page.goto(url + "?theme=" + theme + "&integrated=1");
            await page.locator(".workflow-bound-assets").getByRole("region", { name: "角色造型参考" }).getByRole("combobox").waitFor();
            assert.equal(await page.locator(".workflow-bound-assets").getByRole("combobox").isEnabled(), true, "opening a saved shot must allow choosing another pictured character version");
            assert.equal(await page.locator(".workflow-preview-panel").getByRole("region", { name: "角色造型参考" }).count(), 0, "no duplicate long character sidebar");
            assert.equal(await page.locator(".workflow-bound-asset-chip").filter({ hasText: "苏卉" }).count(), 0, "one character card instead of duplicate bound thumbnails");
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-bound-assets-integrated.png`) });
            assert.deepEqual(errors, []);
            assert.equal(writes.length, 7);
            await page.locator(".workflow-bound-assets").getByRole("button", { name: "取消引用 苏卉", exact: true }).click();
            await page.locator(".workflow-bound-assets").getByText("镜头正在生成，暂时不能取消资产引用", { exact: true }).waitFor();
            assert.equal(writes.length, 8, "failed removal must remain visible beside the bound assets");
            const integrated = page.locator(".workflow-bound-assets").getByRole("region", { name: "角色造型参考" });
            await integrated.locator(".ant-select").click();
            await page.locator(".ant-select-item-option").filter({ hasText: "日常白衣定稿" }).click();
            await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"versionId":"v0"'));
            let snapshot = JSON.parse(await page.getByLabel("当前提交角色参考").textContent());
            assert.equal(snapshot[0].resourceId, "front-image");
            assert.equal(snapshot[0].locked, true);
            assert.equal(writes[8].body.choices[0].versionId, "v0");
            await page.reload();
            await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"versionId":"v0"'));
            assert.equal(await integrated.getByRole("combobox").isEnabled(), true, "the stored version must remain selectable after reopening");
            await integrated.getByRole("button", { name: "管理造型" }).click();
            const manager = page.getByRole("dialog").filter({ hasText: "造型与版本 · 苏卉" });
            await manager.locator('[data-version-id="v0"]').getByRole("button", { name: "当前镜头正在使用此版本" }).waitFor();
            await manager.locator('[data-version-id="redraw-history"]').getByRole("button", { name: "图片历史", exact: true }).click();
            await page.getByRole("dialog").filter({ hasText: "黑甲战斗 · 图片历史" }).locator('[data-version-id="v1"]').getByRole("button", { name: "用于当前镜头并锁定" }).click();
            await manager.waitFor({ state: "hidden" });
            await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"versionId":"v1"'));
            snapshot = JSON.parse(await page.getByLabel("当前提交角色参考").textContent());
            assert.equal(snapshot[0].resourceId, "img1", "submission must resolve the manually applied version instead of the primary");
            assert.equal(snapshot[0].locked, true);
            assert.equal(asset.primaryVersionId, "v0", "manual selection must not change the project default");
            assert.equal(writes[9].body.choices[0].versionId, "v1");
            await integrated.getByRole("button", { name: "管理造型" }).click();
            await manager.locator('[data-version-id="v1"]').waitFor();
            assert.equal(await manager.getByRole("button", { name: "当前镜头正在使用此版本" }).isDisabled(), true, "reopening must focus the pinned historical version, not the newer redraw in its group");
            await page.keyboard.press("Escape");
            await manager.waitFor({ state: "hidden" });
            await page.getByLabel("对白 / 旁白", { exact: true }).fill("苏卉：保留这句未保存的修改。");
            assert.equal(await integrated.getByRole("combobox").isDisabled(), true, "genuine script edits still require saving before switching");
            assert.equal(writes.length, 10, "only explicit bindings are saved; no model tasks or script autosaves");
            assert.deepEqual(errors, []);
            shotBusy = true;
            await page.goto(url + "?theme=" + theme);
            await panel.getByText("已锁定", { exact: true }).waitFor();
            assert.equal(await panel.getByRole("combobox").isDisabled(), true, "active generation still protects the binding");
            await panel.getByRole("button", { name: "管理造型" }).click();
            assert.equal(await dialog.locator('[data-version-id="v0"]').getByRole("button", { name: "用于当前镜头并锁定" }).isDisabled(), true);
            assert.equal(writes.length, 10);
            shotBusy = false;
            const groupVersion = { ...versions[0], assetId: "masters", title: "其余六位师傅", versionId: "masters-v2", version: 2, representations: [{ id: "masters-rep", resourceId: "masters-image", mediaType: "image", role: "primary" }], referenceProfile: { ...versions[0].referenceProfile, name: "六位师傅群像" } };
            versions.push(groupVersion);
            extraAssets.push({ ...asset, id: "masters", title: "其余六位师傅", primaryVersionId: "masters-v2", character: groupVersion });
            await page.goto(url + "?theme=" + theme + "&integrated=1");
            await integrated.getByRole("button", { name: "手动绑定角色", exact: true }).click();
            await integrated.getByRole("combobox", { name: "从项目资产绑定角色" }).click();
            await page.locator(".ant-select-item-option").filter({ hasText: "其余六位师傅" }).click();
            await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"versionId":"masters-v2"'));
            const groupReference = JSON.parse(await page.getByLabel("当前提交角色参考").textContent()).find((item) => item.assetId === "masters");
            assert.equal(groupReference.resourceId, "masters-image");
            assert.equal(groupReference.locked, true);
            assert.equal(writes[10].body.choices[0].source, "manual");
            assert.equal(writes[10].body.choices[0].versionId, "masters-v2");
            await page.reload();
            await integrated.getByRole("button", { name: "预览 其余六位师傅", exact: true }).waitFor();
            assert.equal(await integrated.getByRole("button", { name: "手动绑定角色", exact: true }).isDisabled(), true, "a bound group cannot be added twice");
            assert.equal(writes.length, 11, "manual group binding only writes a choice and never submits a model task");
            assert.deepEqual(errors, []);
            const missingVersion = { ...versions[0], assetId: "missing-cast", title: "三师傅", versionId: "missing-cast-v1", version: 1, representations: [], referenceProfile: undefined, visualStatus: "missing" };
            versions.push(missingVersion);
            extraAssets.push({ ...asset, id: missingVersion.assetId, title: missingVersion.title, primaryVersionId: missingVersion.versionId, character: missingVersion, versionCount: 1 });
            await page.reload();
            await integrated.getByRole("button", { name: "手动绑定角色", exact: true }).click();
            await integrated.getByRole("combobox", { name: "从项目资产绑定角色" }).click();
            await page.locator(".ant-select-item-option").filter({ hasText: "三师傅" }).click();
            const missingCard = integrated.locator(".workflow-character-reference-card").filter({ hasText: "三师傅" });
            await missingCard.getByText("缺参考图 · 已手动绑定", { exact: true }).waitFor();
            assert.deepEqual(writes[11].body.choices.map(({ assetId, status, source, locked }) => ({ assetId, status, source, locked })), [{ assetId: "missing-cast", status: "pending", source: "manual", locked: true }]);
            await page.reload();
            await missingCard.getByRole("button", { name: "补参考图", exact: true }).waitFor();
            await integrated.getByRole("button", { name: "新增角色", exact: true }).click();
            const create = page.getByRole("dialog").filter({ hasText: "新增出镜角色" });
            await create.getByLabel("角色名称", { exact: true }).fill("陈尧");
            await create.getByLabel("外貌与服装", { exact: true }).fill("年轻男子，青色长袍");
            await create.getByRole("button", { name: "新增并绑定本镜", exact: true }).click();
            await create.waitFor({ state: "hidden" });
            await integrated.locator(".workflow-character-reference-card").filter({ hasText: "陈尧" }).getByText("缺参考图 · 已手动绑定", { exact: true }).waitFor();
            assert.equal(writes[12].path, "/api/projects/p/characters");
            assert.deepEqual(writes[13].body.choices.map(({ assetId, status, source, locked }) => ({ assetId, status, source, locked })), [{ assetId: "new-cast", status: "pending", source: "manual", locked: true }]);
            assert.equal(writes.length, 14, "creating and binding a missing character never calls a generation endpoint");
            assert.deepEqual(errors, []);
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-manual-missing-cast.png`) });
        }
        await page.close();
        console.log(`PASS ${theme}/${width}: selection, lock/unlock, unsaved guard, metadata save, split three looks, batch parameters, no generation`);
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
