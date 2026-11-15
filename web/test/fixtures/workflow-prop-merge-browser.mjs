import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("assetCase", "prop-merge");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const errors = [];
    const unexpected = [];
    const submissions = [];
    const savedScripts = [];
    const links = [];
    const assets = [
        { id: "fixture-scene", title: "基地训练区", category: "environment", primaryVersionId: "version-scene", storageKey: "resource:picture-scene" },
        { id: "fixture-prop", title: "训练护具", category: "prop", primaryVersionId: "version-prop", storageKey: "resource:picture-prop" },
        { id: "duplicate-prop", title: "备用护具", category: "prop", primaryVersionId: "version-duplicate", storageKey: "resource:picture-duplicate" },
    ].map((asset) => ({ ...asset, mediaType: "image", status: "confirmed", usages: [], versionCount: 1 }));
    const shot = { id: "shot-a", projectId: "preview-project", unitId: "preview-chapter", title: "镜头01", position: 0, durationMs: 30000, status: "active", currentRevisionId: "asset-case-revision", description: "训练结束，收好护具。备用护具放在训练区门口。" };
    let revision = { id: shot.currentRevisionId, shotId: shot.id, version: 1, durationMs: 30000, plotDescription: shot.description, videoPrompt: "镜头1：固定机位。起幅：纪星站在训练区。→ 落幅：纪星收起护具。\n【场景与道具参考】\n基地训练区：@[asset:fixture-scene]\n训练护具：@[asset:fixture-prop]\n备用护具：@[asset:duplicate-prop]", actionBeatsJson: JSON.stringify([{ type: "asset_context", sceneAssetId: "fixture-scene", propNames: ["训练护具", "备用护具"] }]) };
    const references = assets.map((asset) => ({ id: "ref-" + asset.id, shotId: shot.id, assetVersionId: asset.primaryVersionId, role: "reference", status: "linked", asset }));
    let merged = false;
    const currentAssets = () => merged ? assets.slice(0, 2).map((asset) => asset.category === "prop" ? { ...asset, definitionJson: JSON.stringify({ aliases: ["备用护具"] }) } : asset) : assets;
    const workspace = () => ({ unit: { id: "preview-chapter" }, shots: [shot], shotRevisions: [revision], shotArtifacts: [], shotReferences: merged ? references.slice(0, 2) : references, tasks: [], assets: currentAssets() });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin) { unexpected.push(request.url()); return route.abort(); }
        const reply = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (target.pathname.endsWith("/workspace")) return reply(workspace());
        if (target.pathname === "/api/projects/preview-project/assets") return reply({ assets: currentAssets() });
        if (target.pathname === "/api/projects/preview-project/core") return reply({ project: { id: "preview-project", revision: merged ? 2 : 1 } });
        if (request.method() === "POST" && target.pathname.endsWith("/assets/duplicate-prop/merge-prop")) {
            assert.deepEqual(request.postDataJSON(), { targetAssetId: "fixture-prop", expectedRevision: 1 });
            merged = true;
            shot.currentRevisionId = "merged-revision";
            revision = { ...revision, id: shot.currentRevisionId, version: 2, videoPrompt: revision.videoPrompt.replaceAll("@[asset:duplicate-prop]", "@[asset:fixture-prop]") };
            return reply({ asset: currentAssets()[1], mergedShots: 1 });
        }
        if (request.method() === "POST" && target.pathname.endsWith("/shots/shot-a/assets")) {
            links.push(request.postDataJSON());
            return route.abort();
        }
        if (request.method() === "POST" && target.pathname === "/api/projects/preview-project/shots") {
            const input = request.postDataJSON();
            savedScripts.push(input);
            shot.currentRevisionId = "saved-merged-revision";
            revision = { ...revision, ...input.revision, id: shot.currentRevisionId, version: 3 };
            return reply({ shot, revision });
        }
        if (request.method() === "POST" && target.pathname === "/api/tasks") {
            submissions.push(request.postDataJSON());
            return reply({ id: "offline-merged-submission", type: "canvas_video", status: "queued", createdAt: "2026-11-11T00:00:00Z" });
        }
        if (target.pathname.startsWith("/api/") && request.method() === "GET") return reply({ assets: [], versions: [], skills: [], tasks: [], total: 0 });
        if (request.method() !== "GET") { unexpected.push(request.method() + " " + target.pathname); return route.abort(); }
        return route.continue();
    });
    await page.goto(url.toString());
    const bound = page.locator(".workflow-bound-assets");
    await bound.getByRole("button", { name: "取消引用 备用护具", exact: true }).waitFor();
    const finalPrompt = page.getByRole("textbox", { name: "最终提交提示词全文", exact: true });
    await finalPrompt.waitFor();
    assert.ok((await finalPrompt.inputValue()).includes("图片3"));
    const beforeMergeDraft = (await finalPrompt.inputValue()) + "\n合并前的旧提示词草稿";
    await finalPrompt.fill(beforeMergeDraft);
    await page.getByRole("button", { name: "合并重复道具", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "合并道具资产" });
    const selector = dialog.getByRole("combobox", { name: "保留的道具" });
    await selector.click();
    await selector.press("ArrowDown");
    await selector.press("Enter");
    await dialog.getByRole("button", { name: "确认合并", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await bound.getByRole("button", { name: "取消引用 备用护具", exact: true }).waitFor({ state: "detached" });
    assert.equal(await finalPrompt.inputValue(), beforeMergeDraft, "merging assets must not silently discard the user's final prompt");
    await page.getByRole("button", { name: "恢复自动整理", exact: true }).click();
    await page.waitForFunction(() => {
        const field = document.querySelector('textarea[aria-label="最终提交提示词全文"]');
        return field && !field.value.includes("图片3") && !field.value.includes("旧提示词草稿");
    });
    await bound.getByRole("button", { name: "补齐本章资产", exact: true }).click();
    await page.getByText("本章资产已检查，补齐 0 个绑定；未提交生成任务", { exact: true }).waitFor();
    const editedPrompt = (await finalPrompt.inputValue()) + "\n合并后的用户编辑：保留护具的金属纹理。";
    await finalPrompt.fill(editedPrompt);
    await page.getByRole("button", { name: "生成镜头视频", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("镜头视频任务已提交"), undefined, { timeout: 8000 }).catch(async () => {
        if (!submissions.length) throw new Error((await page.locator("body").innerText()).slice(-9000));
    });
    assert.equal(submissions.length, 1);
    assert.equal(links.length, 0, "repair must not recreate the merged prop");
    assert.equal(savedScripts.length, 1);
    assert.ok(!JSON.stringify(savedScripts).includes("@[asset:duplicate-prop]"), "saving a shot must not restore the old prop ID");
    assert.deepEqual(submissions[0].input.referenceImages.map((image) => image.storageKey), ["resource:picture-scene", "resource:picture-prop"]);
    assert.equal(submissions[0].prompt, editedPrompt, "the edited final prompt must be submitted unchanged");
    assert.ok(submissions[0].prompt.includes("训练护具：道具参考：图片2"));
    assert.ok(!submissions[0].prompt.includes("图片3"));
    assert.ok(!JSON.stringify(submissions[0]).includes("duplicate-prop"));
    assert.ok(!JSON.stringify(submissions[0]).includes("picture-duplicate"));
    assert.equal(submissions[0].input.metadata.shotRevisionId, "saved-merged-revision");
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log("PASS merge dialog, workspace refresh, manual draft preservation and explicit reset, chapter repair and actual video submission with the retained image and edited prompt; all APIs mocked");
} finally {
    await browser.close();
}
