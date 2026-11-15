import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
url.searchParams.set("assetCase", "ready");
url.searchParams.set("promptCase", "true");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const errors = [];
    const unexpected = [];
    const submissions = [];
    const assets = [
        { id: "fixture-scene", title: "基地训练区", category: "environment", primaryVersionId: "version-scene", storageKey: "resource:picture-scene" },
        { id: "fixture-prop", title: "训练护具", category: "prop", primaryVersionId: "version-prop", storageKey: "resource:picture-prop" },
    ].map((asset) => ({ ...asset, mediaType: "image", status: "confirmed", usages: [], versionCount: 1 }));
    const shots = ["a", "b"].map((name, index) => ({ id: "shot-" + name, projectId: "preview-project", unitId: "preview-chapter", title: "镜头0" + (index + 1), position: index, durationMs: 30000, status: "active", currentRevisionId: "prompt-revision-" + name, description: "基地训练区中收好训练护具。" }));
    const revisions = shots.map((shot) => ({ id: shot.currentRevisionId, shotId: shot.id, version: 1, durationMs: 30000, plotDescription: shot.description, videoPrompt: "镜头1：起幅：基地训练区中拿着训练护具。过程：收起护具。→ 落幅：抬头。", actionBeatsJson: JSON.stringify([{ type: "asset_context", sceneAssetId: "fixture-scene", propNames: ["训练护具"] }]) }));
    const references = shots.flatMap((shot) => assets.map((asset) => ({ id: shot.id + asset.id, shotId: shot.id, assetVersionId: asset.primaryVersionId, role: "reference", status: "linked", asset })));
    const workspace = () => ({ unit: { id: "preview-chapter" }, shots, shotRevisions: revisions, shotArtifacts: [], shotReferences: references, tasks: [], assets });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin) { unexpected.push(target.origin); return route.abort(); }
        const reply = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (target.pathname.endsWith("/workspace")) return reply(workspace());
        if (target.pathname === "/api/projects/preview-project/assets") return reply({ assets });
        if (request.method() === "POST" && target.pathname === "/api/projects/preview-project/shots") {
            const input = request.postDataJSON();
            const shot = shots.find((item) => item.id === input.id);
            const revision = revisions.find((item) => item.shotId === shot.id);
            Object.assign(revision, input.revision);
            revision.id = "refreshed-" + shot.id + "-" + (++revision.version);
            revision.videoPrompt += "\n自动预览随保存的版本变化。";
            shot.currentRevisionId = revision.id;
            return reply({ shot, revision });
        }
        if (request.method() === "POST" && target.pathname === "/api/tasks") {
            submissions.push(request.postDataJSON());
            return route.fulfill({ status: 400, json: { code: 400, msg: "离线模拟提交失败", reason: "fixture_rejected" } });
        }
        if (target.pathname.startsWith("/api/") && request.method() === "GET") return reply({ assets: [], versions: [], skills: [], tasks: [], total: 0 });
        if (request.method() !== "GET") { unexpected.push(request.method() + " " + target.pathname); return route.abort(); }
        return route.continue();
    });
    await page.goto(url.toString());
    const editor = page.getByRole("textbox", { name: "最终提交提示词全文" });
    await editor.waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="最终提交提示词全文"]')?.readOnly);
    const authored = "  用户手动最终全文\n镜头1：起幅：右手持信。过程：递出信。→ 落幅：左手接稳。\n声音：保持原话与空格。  ";
    await editor.fill(authored);
    await page.getByText("手动稿已保存到本机", { exact: true }).waitFor();
    await page.getByRole("button", { name: "生成镜头视频", exact: true }).click();
    await page.getByText("离线模拟提交失败", { exact: true }).first().waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].prompt, authored, "actual task payload must preserve the clicked manual text byte-for-byte");
    await page.waitForTimeout(500);
    assert.equal(await editor.inputValue(), authored, "revision and preview refresh after failure must not erase edits");
    await page.getByRole("button", { name: "生成镜头视频", exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].prompt, authored, "retry must submit the same edited text");
    await page.getByRole("button", { name: "shot-b", exact: true }).click();
    await page.waitForTimeout(400);
    assert.notEqual(await editor.inputValue(), authored, "drafts cannot leak into another shot");
    await page.getByRole("button", { name: "shot-a", exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await editor.inputValue(), authored);
    await page.reload();
    await page.getByText("手动稿已保存到本机", { exact: true }).waitFor();
    assert.equal(await editor.inputValue(), authored, "persisted manual draft must survive page reload");
    await editor.fill("");
    await page.getByText("手动稿已保存到本机", { exact: true }).waitFor();
    await page.getByRole("button", { name: "生成镜头视频", exact: true }).click();
    await page.getByText("最终提交提示词不能为空，请先填写内容", { exact: true }).first().waitFor();
    assert.equal(submissions.length, 2, "empty manual text must be rejected, never replaced with the automatic text");
    assert.equal(await editor.inputValue(), "");
    await page.getByRole("button", { name: "恢复自动整理", exact: true }).click();
    await page.waitForTimeout(300);
    assert.ok((await editor.inputValue()).includes("镜头1"));
    await page.reload();
    await editor.waitFor();
    await page.waitForTimeout(300);
    assert.ok((await editor.inputValue()).includes("镜头1"));
    assert.equal(await page.getByRole("button", { name: "恢复自动整理", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log("PASS final prompt actual payload, failed submission/refetch/retry, shot isolation, persistent reload, empty edit rejection and explicit restore; no remote/model calls");
} finally {
    await browser.close();
}
