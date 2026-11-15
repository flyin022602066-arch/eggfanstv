import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: theme === "dark" ? 1500 : 390, height: 1000 } });
        page.setDefaultTimeout(5000);
        const errors = [], writes = [];
        let revision = 1, rejectWrite = false, shotBusy = false, staleRevision = false;
        let releaseWrite;
        const versions = ["hero", "partner", "locked", "missing", "unbound", "conflict"].flatMap((assetId) => [0, 1].map((index) => ({ assetId, title: assetId, versionId: `${assetId}-v${index}`, version: index + 1, definition: {}, updatedAt: "2026-11-15T00:00:00Z", representations: assetId === "missing" ? [] : [{ id: `${assetId}-rep${index}`, resourceId: `${assetId}-img${index}`, mediaType: "image", role: "primary" }] })));
        const assets = versions.filter((version) => version.version === 1).map((version) => ({ id: version.assetId, title: version.title, category: "character", mediaType: "entity", primaryVersionId: version.versionId, character: version }));
        const reference = (assetId, index = 1, shotId = "s") => ({ id: `${shotId}-${assetId}-${index}`, shotId, assetVersionId: `${assetId}-v${index}`, role: "reference", status: "linked", selectionStatus: assetId === "partner" ? "pending" : "resolved", selectionSource: "manual", selectionLocked: assetId === "locked", selectionRevisionId: "sr", asset: assets.find((asset) => asset.id === assetId), referencedVersion: { ...versions.find((version) => version.versionId === `${assetId}-v${index}`), id: `${assetId}-v${index}` } });
        const refs = [reference("hero"), reference("partner"), reference("locked"), reference("missing"), reference("conflict", 0), reference("conflict", 1), reference("hero", 0, "other")];
        const workspace = () => ({ unit: { id: "u", sourceText: "hero partner locked missing unbound conflict" }, shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: staleRevision ? "changed" : "sr", description: "hero partner locked missing unbound conflict" }, { id: "other", unitId: "u", position: 1, currentRevisionId: "other-sr" }], shotRevisions: [], shotReferences: refs, tasks: shotBusy ? [{ id: "busy-task", status: "running", clientContext: { shotId: "s" } }] : [] });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("unexpected external request"); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                assert.equal(request.method(), "PUT");
                assert.equal(path, "/api/projects/p/units/u/character-references");
                const body = request.postDataJSON();
                writes.push(body);
                assert.equal(body.expectedRevision, revision);
                assert.deepEqual(body.choices.map(({ shotId, assetId, versionId, locked, status, source, expectedShotRevisionId }) => ({ shotId, assetId, versionId, locked, status, source, expectedShotRevisionId })), ["hero", "partner"].map((assetId) => ({ shotId: "s", assetId, versionId: `${assetId}-v1`, locked: true, status: "resolved", source: "manual", expectedShotRevisionId: "sr" })));
                if (rejectWrite) return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "镜头绑定已变化，请刷新后重试", reason: "conflict" } });
                await new Promise((resolve) => { releaseWrite = resolve; });
                for (const choice of body.choices) Object.assign(refs.find((ref) => ref.shotId === choice.shotId && ref.asset.id === choice.assetId), { selectionLocked: choice.locked, selectionStatus: choice.status, selectionSource: choice.source });
                revision++;
                return ok({ saved: true });
            }
            if (path.endsWith("/character-versions")) return ok({ revision, versions });
            if (path.endsWith("/workspace")) return ok(workspace());
            if (path.endsWith("/assets")) return ok({ assets });
            if (path.includes("/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#888"/></svg>' });
            if (path.startsWith("/api/")) { errors.push("unexpected API read: " + path); return route.abort(); }
            return route.continue();
        });
        await page.goto(`${url}?theme=${theme}`);
        const panel = page.getByRole("region", { name: "角色造型参考" });
        await panel.getByRole("button", { name: "预览 hero", exact: true }).waitFor();
        const lockAll = panel.getByRole("button", { name: "一键锁定全部", exact: true });
        await lockAll.waitFor();
        assert.equal(await lockAll.isEnabled(), true);
        rejectWrite = true;
        await lockAll.click();
        await panel.getByRole("alert").getByText("镜头绑定已变化，请刷新后重试", { exact: true }).waitFor();
        assert.equal(refs[0].selectionLocked, false, "a failed save must not optimistically lock a card");
        assert.equal(await lockAll.isEnabled(), true, "failed writes remain retryable");
        rejectWrite = false;
        await page.getByRole("button", { name: "切换脚本未保存" }).click();
        await lockAll.click();
        await page.getByLabel("操作状态").getByText("正在更新", { exact: true }).waitFor();
        const loadingButton = panel.locator("button.ant-btn-loading").filter({ hasText: "一键锁定全部" });
        await loadingButton.waitFor();
        assert.equal(await loadingButton.isDisabled(), true);
        assert.equal(writes.length, 2, "all current selections are saved in one request per click");
        releaseWrite();
        await panel.locator(".workflow-character-reference-card").filter({ has: page.getByRole("combobox", { name: "hero造型版本", exact: true }) }).getByText("已锁定", { exact: true }).waitFor();
        await page.getByText("已锁定当前镜头 2 个角色造型", { exact: false }).waitFor({ state: "attached" });
        assert.equal(refs.find((ref) => ref.shotId === "other").selectionLocked, false);
        assert.equal(refs.find((ref) => ref.asset.id === "missing").selectionLocked, false);
        assert.equal(refs.filter((ref) => ref.asset.id === "conflict").some((ref) => ref.selectionLocked), false);
        assert.equal(await lockAll.isDisabled(), true);
        assert.equal(new URL(page.url()).pathname, "/", "bulk confirmation never navigates away");
        await page.reload();
        await panel.getByRole("button", { name: "预览 hero", exact: true }).waitFor();
        assert.equal(await lockAll.isDisabled(), true, "locks survive reopening without repeated writes");
        await page.screenshot({ path: join(artifactDir, `${theme}-lock-all.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        refs[0].selectionLocked = false;
        refs[1].selectionLocked = false;
        shotBusy = true;
        await page.reload();
        await panel.getByRole("button", { name: "预览 hero", exact: true }).waitFor();
        assert.equal(await lockAll.isDisabled(), true, "active generation protects bindings");
        shotBusy = false;
        await page.reload();
        await panel.getByRole("button", { name: "预览 hero", exact: true }).waitFor();
        staleRevision = true;
        await lockAll.click();
        await panel.getByRole("alert").getByText("项目或镜头已变化，请刷新造型列表后重选", { exact: true }).waitFor();
        assert.equal(writes.length, 2, "stale scripts must be rejected before a write");
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS ${theme}: one atomic write, current versions, conflict skips, retries, persistence and active/stale guards`);
    }
} finally { await browser.close(); }
