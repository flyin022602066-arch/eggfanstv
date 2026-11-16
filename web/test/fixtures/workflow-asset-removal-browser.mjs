import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("assetCase", "removal");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const errors = [];
    const unexpected = [];
    const submissions = [];
    const links = [];
    const assets = [
        { id: "fixture-scene", title: "基地训练区", category: "environment", primaryVersionId: "version-scene", storageKey: "resource:picture-scene" },
        { id: "fixture-prop", title: "训练护具", category: "prop", primaryVersionId: "version-prop", storageKey: "resource:picture-prop" },
        { id: "duplicate-prop", title: "备用护具", category: "prop", primaryVersionId: "version-duplicate", storageKey: "resource:picture-duplicate" },
        { id: "sealed-prop", title: "封存护具", category: "prop", primaryVersionId: "version-sealed", storageKey: "resource:picture-sealed", definitionJson: JSON.stringify({ aliases: ["备用护具"] }) },
        { id: "tray-prop", title: "护具与托盘", category: "prop", primaryVersionId: "version-tray", storageKey: "resource:picture-tray", definitionJson: JSON.stringify({ aliases: ["备用护具"] }) },
    ].map((asset) => ({ ...asset, mediaType: "image", status: "confirmed", usages: [], versionCount: 1 }));
    const shot = { id: "shot-a", projectId: "preview-project", unitId: "preview-chapter", title: "镜头01", position: 0, durationMs: 30000, status: "active", currentRevisionId: "asset-case-revision", description: "训练结束，收好护具。备用护具放在训练区门口。" };
    const revision = { id: shot.currentRevisionId, shotId: shot.id, version: 1, durationMs: 30000, plotDescription: shot.description, videoPrompt: "镜头1：固定机位。起幅：纪星站在训练区。→ 落幅：纪星收起护具。\n【场景与道具参考】\n基地训练区：@[asset:fixture-scene]\n训练护具：@[asset:fixture-prop]\n备用护具：@[asset:duplicate-prop]", actionBeatsJson: JSON.stringify([{ type: "asset_context", sceneAssetId: "fixture-scene", propNames: ["训练护具", "备用护具"] }]) };
    let references = assets.slice(0, 2).map((asset) => ({ id: "ref-" + asset.id, shotId: shot.id, assetVersionId: asset.primaryVersionId, role: "reference", status: "linked", asset }));
    const workspace = () => ({ unit: { id: "preview-chapter" }, shots: [shot], shotRevisions: [revision], shotArtifacts: [], shotReferences: references, tasks: [], assets });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin) { unexpected.push(request.url()); return route.abort(); }
        const reply = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (request.method() === "POST" && target.pathname.endsWith("/assets/merge-same-name-props")) return reply({ merged: 0, deferred: 0 });
        if (target.pathname.endsWith("/workspace")) return reply(workspace());
        if (target.pathname === "/api/projects/preview-project/assets") return reply({ assets });
        if (request.method() === "DELETE" && target.pathname.includes("/shots/shot-a/assets/")) {
            assert.equal(target.searchParams.get("exclude"), "true", "user removal must be persisted as an exclusion");
            const reference = references.find((item) => item.id === target.pathname.split("/").at(-1));
            assert.ok(reference);
            reference.status = "excluded";
            return reply({ unlinked: true });
        }
        if (request.method() === "POST" && target.pathname.endsWith("/shots/shot-a/assets")) {
            const input = request.postDataJSON();
            const asset = assets.find((item) => item.primaryVersionId === input.assetVersionId);
            assert.ok(asset);
            links.push(input);
            references = references.filter((item) => item.asset.id !== asset.id);
            const reference = { id: "ref-" + asset.id, shotId: shot.id, ...input, status: "linked", asset };
            references.push(reference);
            return reply({ reference });
        }
        if (request.method() === "POST" && target.pathname === "/api/projects/preview-project/shots") {
            const input = request.postDataJSON();
            Object.assign(revision, input.revision);
            return reply({ shot, revision });
        }
        if (request.method() === "POST" && target.pathname === "/api/tasks") {
            submissions.push(request.postDataJSON());
            return reply({ id: "offline-submission", type: "canvas_video", status: "queued", createdAt: "2026-11-11T00:00:00Z" });
        }
        if (target.pathname.startsWith("/api/") && request.method() === "GET") return reply({ assets: [], versions: [], skills: [], tasks: [], total: 0 });
        if (request.method() !== "GET") { unexpected.push(request.method() + " " + target.pathname); return route.abort(); }
        return route.continue();
    });
    await page.goto(url.toString());
    const bound = page.locator(".workflow-bound-assets");
    const remove = bound.getByRole("button", { name: "取消引用 备用护具", exact: true });
    await bound.getByRole("button", { name: "补齐本章资产", exact: true }).click();
    await remove.waitFor();
    await remove.click();
    await remove.waitFor({ state: "detached" });
    await page.reload();
    const excluded = bound.getByLabel("已手动移除的镜头资产");
    await excluded.waitFor();
    const automaticLinks = links.length;
    await bound.getByRole("button", { name: "补齐本章资产", exact: true }).click();
    await page.getByText("本章资产已检查，补齐 0 个绑定；未提交生成任务", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "生成镜头视频", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("镜头视频任务已提交"), undefined, { timeout: 8000 }).catch(async () => {
        if (!submissions.length) throw new Error((await page.locator("body").innerText()).slice(-9000));
    });
    assert.equal(submissions.length, 1);
    assert.equal(links.length, automaticLinks, "repair and submission cannot automatically restore deleted references");
    assert.equal(submissions[0].input.referenceImages.length, 2);
    assert.ok(!JSON.stringify(submissions[0].input.referenceImages).includes("picture-duplicate"));
    assert.ok(!JSON.stringify(submissions[0]).includes("picture-sealed"));
    assert.ok(!JSON.stringify(submissions[0]).includes("picture-tray"));
    assert.ok(!links.some((input) => ["version-sealed", "version-tray"].includes(input.assetVersionId)), "shared aliases must not replace the removed exact prop");
    assert.ok(!submissions[0].prompt.includes("@[asset:duplicate-prop]"));
    assert.ok(!submissions[0].prompt.includes("图片3"));
    await excluded.locator(":scope > summary").click();
    await excluded.getByRole("button", { name: "恢复引用 备用护具", exact: true }).click();
    await remove.waitFor();
    assert.equal(links.at(-1).selectionSource, undefined, "explicit restore uses manual binding");
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log("PASS supplementary binding, manual removal, reload, supplementary retry, real submission payload and explicit restore; all APIs mocked, no model calls");
} finally {
    await browser.close();
}
