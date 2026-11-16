import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const base = new URL(process.argv[2]);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((value) => value && existsSync(value));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
        page.setDefaultTimeout(7000);
        const errors = [], writes = [];
        let stopped = false;
        const makeTask = (name, version) => ({ id: `shot-${name}-${version}`, projectId: "preview-project", type: "canvas_video", model: name === "a" && version === "latest" ? "nono::video" : "doubao-browser::seedance_v2.0", status: version === "old" ? name === "c" ? "succeeded" : "running" : name === "a" ? "succeeded" : name === "b" ? stopped ? "cancelled" : "failed" : "running", stage: version === "old" ? "提交状态待确认，正在核对原任务" : name === "a" ? "任务完成" : name === "b" ? stopped ? "本地已停止" : "原任务回执缺失" : "上游正在生成", error: name === "b" ? "原任务没有有效回执，无法确认上游状态" : "", prompt: "", attempts: 1, createdAt: version === "old" ? "2026-11-01T00:00:00Z" : "2026-11-01T01:00:00Z", updatedAt: version === "old" ? "2026-11-16T10:00:00Z" : stopped && name === "b" ? "2026-11-16T11:00:00Z" : "2026-11-01T01:00:00Z", clientContext: { shotId: `shot-${name}`, artifactType: "video" } });
        page.on("pageerror", (error) => errors.push(error.stack));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url());
            if (target.origin !== base.origin) return route.abort();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (request.method() !== "GET") {
                writes.push(target.pathname);
                if (target.pathname === "/api/tasks/shot-b-latest/stop-local") { stopped = true; return ok(makeTask("b", "latest")); }
                return route.abort();
            }
            if (target.pathname.endsWith("/workspace")) return ok({ unit: { id: "preview-chapter" }, shots: ["a", "b", "c", "empty"].map((name, position) => ({ id: `shot-${name}`, projectId: "preview-project", unitId: "preview-chapter", position })), shotRevisions: [], shotReferences: [], tasks: ["a", "b", "c"].flatMap((name) => [makeTask(name, "old"), makeTask(name, "latest")]), shotArtifacts: [{ id: "artifact-shot-a-latest", projectId: "preview-project", unitId: "preview-chapter", shotId: "shot-a", taskId: "shot-a-latest", resourceId: "ready-video", type: "video", version: 2, status: "ready", selected: true, metadataJson: "{}", createdAt: "2026-11-01T01:00:00Z", updatedAt: "2026-11-01T01:00:00Z" }] });
            if (target.pathname.endsWith("/character-versions")) return ok({ revision: 1, versions: [] });
            if (target.pathname.startsWith("/api/")) return ok({ assets: [], skills: [], tasks: [], total: 0 });
            return route.continue();
        });
        const url = new URL(base); url.searchParams.set("workflowCase", "reconcile"); url.searchParams.set("theme", theme);
        await page.goto(url.toString());
        const timeline = page.locator(".workflow-shot-track");
        const first = timeline.locator(".workflow-timeline-shot").nth(0);
        await first.getByText("已生成", { exact: true }).waitFor().catch(async (error) => { console.log(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 6000) })); throw error; });
        assert.equal(await timeline.getByText("待确认", { exact: true }).count(), 0);
        await page.locator(".workflow-preview-actions").getByRole("button", { name: "重新生成", exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-preview-actions button").first().isEnabled(), true);
        await page.getByRole("button", { name: "shot-b", exact: true }).click();
        await timeline.getByText("回执缺失", { exact: true }).waitFor();
        await page.getByText("高级任务操作", { exact: true }).click();
        const stop = page.getByRole("button", { name: "仅本地停止此视频", exact: true });
        await stop.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "确认本地停止", exact: true }).click();
        await page.getByText("本地已停止跟进，可以重新生成", { exact: true }).waitFor();
        await page.getByRole("button", { name: "刷新任务状态", exact: true }).click();
        await page.getByText("本地已停止跟进，可以重新生成", { exact: true }).waitFor();
        await page.getByRole("button", { name: "shot-c", exact: true }).click();
        await timeline.getByText("生成中", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-preview-actions button").first().isDisabled(), true);
        await page.getByRole("button", { name: "shot-a", exact: true }).click();
        await first.getByText("已生成", { exact: true }).waitFor();
        assert.deepEqual(writes, ["/api/tasks/shot-b-latest/stop-local"]);
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log("PASS dark/light historical pending isolation, completed video, actual new generation, refresh and local stop");
} finally { await browser.close(); }
