import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        page.setDefaultTimeout(10000);
        const errors = [], writes = [];
        let revision = 1;
        const timestamp = "2026-11-02T00:00:00Z";
        const versions = ["v0", "v1"].map((versionId, index) => ({ assetId: "hero", title: "苏卉", versionId, version: index + 1, updatedAt: timestamp, definition: {}, representations: [{ id: `rep${index}`, resourceId: `img${index}`, mediaType: "image", role: "primary" }], referenceProfile: { lookId: `look${index}`, name: index ? "黑甲战斗" : "日常白衣", enabled: true, preferred: true, default: index === 0 } }));
        const assets = [{ id: "hero", title: "苏卉", category: "character", mediaType: "entity", primaryVersionId: "v0", character: versions[0] }];
        const refs = [{ id: "ref", shotId: "s", assetVersionId: "v0", role: "reference", status: "linked", asset: assets[0], referencedVersion: { ...versions[0], id: "v0" }, selectionStatus: "resolved", selectionSource: "manual", selectionLocked: true }];
        const workspace = () => ({ unit: { id: "u", sourceText: "苏卉穿白衣。" }, shots: [{ id: "s", projectId: "p", unitId: "u", title: "镜头1", currentRevisionId: "sr", position: 0, description: "苏卉穿白衣", durationMs: 30000, status: "active" }], shotRevisions: [{ id: "sr", shotId: "s", version: 1, videoPrompt: "苏卉穿白衣走到窗前。", plotDescription: "苏卉穿白衣", actionBeatsJson: "[]" }], shotReferences: refs, tasks: [], shotArtifacts: [] });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("unexpected remote request"); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                const body = request.postData() ? request.postDataJSON() : {};
                writes.push({ path, body });
                if (request.method() === "DELETE" && path.includes("/shots/s/assets/")) {
                    assert.equal(target.searchParams.get("exclude"), "true");
                    refs.find((ref) => path.endsWith(ref.id)).status = "excluded";
                    revision++;
                    return ok({ deleted: true });
                }
                if (path.endsWith("/character-references")) {
                    assert.equal(body.expectedRevision, revision);
                    const choice = body.choices[0];
                    assert.equal(choice.expectedShotRevisionId, "sr");
                    const selected = versions.find((version) => version.versionId === choice.versionId);
                    const saved = { id: `${choice.assetId}-ref-${revision}`, shotId: "s", assetVersionId: choice.versionId, role: "reference", status: "linked", asset: assets.find((asset) => asset.id === choice.assetId), referencedVersion: { ...selected, id: selected.versionId }, selectionStatus: choice.status, selectionSource: choice.source, selectionLocked: choice.locked };
                    const index = refs.findIndex((ref) => ref.asset.id === choice.assetId);
                    if (index < 0) refs.push(saved); else refs.splice(index, 1, saved);
                    revision++;
                    return ok({ saved: true });
                }
                errors.push(`unexpected write ${path}`);
                return route.abort();
            }
            if (path.endsWith("/character-versions")) return ok({ revision, versions });
            if (path.endsWith("/workspace")) return ok(workspace());
            if (path.endsWith("/assets")) return ok({ assets });
            if (path.includes("/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#888"/></svg>' });
            if (path === "/api/tasks") return ok([]);
            if (path.startsWith("/api/")) return ok({});
            return route.continue();
        });
        await page.goto(`${url}?integrated=1&theme=${theme}`);
        const panel = page.getByRole("region", { name: "角色造型参考" });
        await panel.getByRole("button", { name: "预览 苏卉", exact: true }).waitFor();
        const dialogue = page.getByLabel("对白 / 旁白", { exact: true });
        await dialogue.fill("苏卉：保留尚未保存的台词。");
        assert.equal(await panel.getByRole("button", { name: "识别本镜", exact: true }).isDisabled(), true);
        assert.equal(await panel.getByRole("combobox", { name: "苏卉造型版本" }).isEnabled(), true, "manual binding must remain available without losing unsaved text");
        await panel.locator(".ant-select").click();
        await page.locator(".ant-select-item-option").filter({ hasText: "黑甲战斗" }).click();
        await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"resourceId":"img1"'));
        assert.equal(await dialogue.inputValue(), "苏卉：保留尚未保存的台词。");
        await panel.getByRole("button", { name: "取消引用 苏卉", exact: true }).click();
        await panel.getByRole("button", { name: "预览 苏卉", exact: true }).waitFor({ state: "hidden" });
        await panel.getByRole("button", { name: "手动绑定角色", exact: true }).click();
        await panel.getByRole("combobox", { name: "从项目资产绑定角色" }).click();
        await page.locator(".ant-select-item-option").filter({ hasText: "黑甲战斗" }).click();
        await page.waitForFunction(() => document.querySelector('output[aria-label="当前提交角色参考"]')?.textContent.includes('"resourceId":"img1"'));
        assert.equal(await dialogue.inputValue(), "苏卉：保留尚未保存的台词。");
        assert.equal(refs.length, 1, "restoration replaces the exclusion rather than creating duplicate bindings");
        const missing = [1, 2].map((version) => ({ assetId: "missing", title: "三师傅", versionId: `missing-v${version}`, version, updatedAt: timestamp, definition: {}, representations: [], referenceProfile: { lookId: `missing-look${version}`, name: `待补造型${version}`, enabled: true, preferred: false } }));
        versions.push(...missing);
        assets.push({ id: "missing", title: "三师傅", category: "character", mediaType: "entity", primaryVersionId: "missing-v1", character: missing[0] });
        await page.reload();
        await panel.getByRole("button", { name: "手动绑定角色", exact: true }).click();
        await panel.getByRole("combobox", { name: "从项目资产绑定角色" }).click();
        await page.locator(".ant-select-item-option").filter({ hasText: "待补造型1" }).click();
        const missingCard = panel.locator(".workflow-character-reference-card").filter({ hasText: "三师傅" });
        await missingCard.getByText("缺参考图 · 已手动绑定", { exact: true }).waitFor();
        await missingCard.locator(".ant-select").click();
        await page.locator(".ant-select-item-option").filter({ hasText: "待补造型2" }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="三师傅造型版本"]')?.closest('.ant-select')?.textContent.includes('待补造型2'));
        assert.equal(refs.find((ref) => ref.asset.id === "missing").assetVersionId, "missing-v2");
        assert.equal(refs.find((ref) => ref.asset.id === "missing").selectionStatus, "pending");
        assert.equal(writes.length, 5, "only explicit reference changes are persisted; no script or generation submissions");
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(artifactDir, `${theme}-character-binding-recovery.png`) });
        await page.close();
        console.log(`PASS ${theme}: dirty draft retained, version selection, exclusion restoration, pending look selection, submission snapshots`);
    }
} finally { await browser.close(); }
