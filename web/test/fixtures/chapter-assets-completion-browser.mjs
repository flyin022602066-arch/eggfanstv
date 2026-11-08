import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const mode of ["saved", "failed", "already-applied"]) {
        const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
        page.setDefaultTimeout(8000);
        const writes = [], errors = [];
        const character = { name: "三师傅", role: "出场师傅", appearance: "白发白须", clothing: "灰色长袍", physique: "清瘦", personality: "沉稳", voiceLanguage: "中文", voiceAge: "老年", voiceTimbre: "浑厚" };
        const task = { id: "task-assets", projectId: "p", type: "canvas_text", status: "succeeded", attempts: 1, prompt: "", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:01:00Z", clientContext: { chapterId: "u", chapterOperation: "characters" }, inputJson: JSON.stringify({ metadata: { operation: "chapter_character_breakdown", chapterId: "u", promptTemplateVariables: { 章节正文: "三师傅站在窗前。" } } }), resultJson: JSON.stringify({ text: JSON.stringify({ characters: [character], scenes: [], props: [] }) }) };
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request"); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                writes.push({ path, body: request.postDataJSON() });
                if (path === "/api/projects/p/asset-candidates") {
                    if (mode === "failed") return route.fulfill({ status: 409, json: { code: 409, data: null, msg: "离线模拟资产写入失败", reason: "project_revision_conflict" } });
                    return ok({ candidates: [{ id: "candidate-master", name: "三师傅", unitId: "u", category: "character", status: "pending_confirmation", details: character }] });
                }
                errors.push("unexpected write " + path); return route.abort();
            }
            if (path === "/api/tasks") return ok([task]);
            if (path === "/api/tasks/task-assets") return ok(task);
            if (path.endsWith("/chapter-apply-receipts")) return ok({ receipts: mode === "already-applied" ? [{ taskId: task.id, kind: "characters", unitId: "u", applied: true }] : [] });
            if (path.endsWith("/character-versions")) return ok({ revision: 11, versions: [] });
            if (path.endsWith("/workspace")) return ok({ shots: [], shotRevisions: [], shotReferences: [], tasks: [] });
            if (path.endsWith("/assets")) return ok({ assets: [] });
            if (path.includes("/skills")) return ok({ skills: [] });
            if (path.startsWith("/api/")) return ok({});
            return route.continue();
        });
        await page.goto(url);
        if (mode === "saved") {
            await page.getByRole("heading", { name: "资产写入后已跳转?unitId=u", exact: true }).waitFor();
            assert.equal(writes.length, 1);
            assert.equal(writes[0].body.sourceTaskId, "task-assets");
            assert.equal(writes[0].body.candidates[0].name, "三师傅");
            assert.equal(writes[0].body.candidates[0].unitId, "u");
        } else if (mode === "failed") {
            await page.getByText("本章资产提取未完成", { exact: true }).waitFor();
            assert.ok((await page.locator("body").innerText()).includes("离线模拟资产写入失败"));
            assert.equal(await page.getByRole("heading", { name: /资产写入后已跳转/u }).count(), 0);
            assert.equal(writes.length, 1);
        } else {
            await page.getByRole("button", { name: "提取完成 · 查看资产", exact: true }).waitFor();
            assert.equal(writes.length, 0, "an applied receipt must not write or navigate again");
            await page.getByRole("button", { name: "提取完成 · 查看资产", exact: true }).click();
            await page.getByRole("heading", { name: "资产写入后已跳转?unitId=u", exact: true }).waitFor();
        }
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(artifactDir, `assets-${mode}.png`) });
        await page.close();
        console.log(`PASS asset completion ${mode}`);
    }
} finally { await browser.close(); }
