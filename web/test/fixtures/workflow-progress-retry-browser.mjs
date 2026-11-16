import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const base = new URL(process.argv[2]);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((value) => value && existsSync(value));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
        page.setDefaultTimeout(6000);
        const errors = [], writes = [];
        let workspace, releaseRetry;
        const holdRetry = new Promise((resolve) => { releaseRetry = resolve; });
        const timestamp = "2026-11-01T00:00:00Z";
        const makeTask = (name, status = "failed") => ({ id: `shot-${name}-latest`, projectId: "preview-project", type: "canvas_video", status, model: "doubao-browser::seedance_v2.0", prompt: `人工修改的最终提示词-shot-${name}-latest`, attempts: 1, createdAt: "2026-11-01T01:00:00Z", updatedAt: timestamp, stage: name === "b" ? "submission_unknown" : "生成提交前", error: name === "b" ? "提交结果未确认" : "参考图片无法读取", clientContext: { shotId: `shot-${name}`, artifactType: "video" } });
        workspace = { unit: { id: "preview-chapter" }, shots: ["a", "b", "c", "empty"].map((name, position) => ({ id: `shot-${name}`, unitId: "preview-chapter", position })), tasks: ["a", "b", "c"].map((name) => makeTask(name)), shotArtifacts: [], shotRevisions: [], shotReferences: [] };
        page.on("pageerror", (error) => errors.push(error.stack));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url());
            if (target.origin !== base.origin) return route.abort();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                writes.push({ path: target.pathname, body: request.postData() });
                if (target.pathname === "/api/tasks/shot-a-latest/retry") {
                    await holdRetry;
                    const task = makeTask("a", "queued"); workspace.tasks[0] = task; return ok(task);
                }
                if (target.pathname === "/api/tasks/shot-b-latest/query-provider") {
                    const task = makeTask("b", "running"); workspace.tasks[1] = task; return ok({ task, recovered: false, providerStatus: "running" });
                }
                if (target.pathname === "/api/tasks/shot-c-latest/retry") return route.fulfill({ status: 400, json: { code: 400, msg: "测试上游凭据不可用" } });
                return route.abort();
            }
            if (target.pathname.endsWith("/workspace")) return ok(workspace);
            const matched = target.pathname.match(new RegExp("^/api/tasks/shot-([abc])-latest$"));
            if (matched) return ok(workspace.tasks.find((task) => task.id === `shot-${matched[1]}-latest`));
            if (target.pathname.endsWith("/character-versions")) return ok({ revision: 1, versions: [] });
            if (target.pathname.startsWith("/api/")) return ok({ assets: [], skills: [], tasks: [], total: 0 });
            return route.continue();
        });
        const visit = async (scenario) => {
            const url = new URL(base); url.searchParams.set("workflowCase", scenario); url.searchParams.set("theme", theme);
            await page.goto(url.toString());
            await page.addStyleTag({ url: new URL("episode-download.css", base).toString() });
            await page.addStyleTag({ content: "html,body,#root,.ant-app{height:100%;min-height:0;margin:0}.ant-app{display:flex;flex-direction:column}.workflow-production-shell{flex:1;min-height:0}" });
        };
        await visit("progress");
        const timeline = page.locator(".workflow-shot-track");
        await timeline.getByText("准备中", { exact: true }).waitFor();
        await timeline.getByText("待确认", { exact: true }).waitFor();
        await timeline.getByText("取回中", { exact: true }).waitFor();
        await page.locator(".workflow-preview-panel").getByText("豆包浏览器", { exact: true }).waitFor();
        await page.locator(".workflow-preview-panel").getByText("浏览器正在准备画布和参考图，尚未提交生成", { exact: true }).waitFor();
        const episode = page.locator(".workflow-simple-list a").filter({ hasText: "第8集" });
        await episode.getByText("已成功 2 / 分镜 3", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-episode-complete").count(), 0);
        await page.getByRole("button", { name: "模拟其他集完成", exact: true }).click();
        await episode.locator(".workflow-episode-complete").getByText("已成功 3 / 分镜 3", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-simple-list a").filter({ hasText: "第9集" }).locator(".workflow-episode-complete").count(), 0);
        await visit("retry");
        for (let index = 0; index < 8; index++) {
            await page.getByRole("button", { name: "切换重试测试章节", exact: true }).click();
            assert.equal(await page.getByRole("button", { name: /^一键重试失败视频/u }).count(), 1, "episode changes must never accumulate batch retry buttons");
        }
        const retry = page.getByRole("button", { name: "一键重试失败视频（3）", exact: true });
        await retry.click();
        const busy = page.getByRole("status").filter({ hasText: new RegExp("正在重新提交 [0-2]/3") });
        await busy.waitFor();
        await busy.locator("xpath=ancestor::button[1]").evaluate((button) => { button.click(); button.click(); });
        await page.waitForFunction(() => document.body.innerText.includes("正在重新提交 2/3"));
        releaseRetry();
        await page.getByRole("dialog").getByText("测试上游凭据不可用", { exact: false }).waitFor();
        assert.deepEqual(writes.map((entry) => entry.path), ["/api/tasks/shot-a-latest/retry", "/api/tasks/shot-b-latest/query-provider", "/api/tasks/shot-c-latest/retry"]);
        assert.ok(writes.every((entry) => !entry.body), "retry uses original stored parameters, never rebuilds model or prompt");
        assert.equal(workspace.tasks[0].prompt, "人工修改的最终提示词-shot-a-latest");
        await page.getByRole("button", { name: "知道了", exact: true }).click();
        assert.equal(await timeline.getByText("生成失败", { exact: true }).count(), 1);
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log("PASS dark/light episode counts, completion refresh, browser stages, duplicate-click protection, original-task recovery and partial retry failures");
} finally { await browser.close(); }
