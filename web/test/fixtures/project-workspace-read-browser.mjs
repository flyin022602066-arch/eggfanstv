import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2];
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15_000 });
const timestamp = "2026-11-02T00:00:00Z";
const project = { id: "read-project", userId: "local", name: "分镜读取测试", type: "short-drama", aspectRatio: "16:9", sourceType: "blank", description: "", stylePresetId: "", status: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp };
const units = ["a", "b"].map((name, position) => ({ id: `chapter-${name}`, projectId: project.id, kind: "chapter", title: `章节${name}`, sourceText: "", wordCount: 0, status: "ready", position, createdAt: timestamp, updatedAt: timestamp }));
const makeWorkspace = (unit) => {
    const shots = [1, 2].map((number) => ({ id: `${unit.id}-shot-${number}`, projectId: project.id, unitId: unit.id, title: `分镜测试${number}`, description: "", position: number, durationMs: 30_000, status: "ready", createdAt: timestamp, updatedAt: timestamp }));
    return { unit, assets: [], workflows: [], shots, shotArtifacts: [], shotReferences: [], assetCandidates: [], tasks: [], shotRevisions: shots.map((shot) => ({ id: `revision-${shot.id}`, shotId: shot.id, version: 1, durationMs: 30_000, videoPrompt: "", imagePrompt: "", plotDescription: "", dialogue: "", actionBeatsJson: "[]", createdAt: timestamp, updatedAt: timestamp })) };
};
const writes = [];
const errors = [];

async function scenario({ initialFailures = [], delays = [], waitForShots = true } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const failures = new Map(initialFailures);
    const responseDelays = new Map(delays);
    const counts = new Map();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== new URL(url).origin) return route.abort();
        if (request.method() !== "GET") { writes.push(request.method() + " " + target.pathname); return route.abort(); }
        if (!target.pathname.startsWith("/api/")) return route.continue();
        counts.set(target.pathname, (counts.get(target.pathname) || 0) + 1);
        const delay = responseDelays.get(target.pathname);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const failure = failures.get(target.pathname);
        if (failure) {
            const status = typeof failure === "number" ? failure : failure.status;
            if (typeof failure === "object" && --failure.remaining === 0) failures.delete(target.pathname);
            return route.fulfill({ status, json: { code: status, reason: status === 403 ? "forbidden" : status === 404 ? "not_found" : "unavailable", msg: "测试读取失败", data: null } });
        }
        let data = { assets: [], skills: [], tasks: [], total: 0 };
        if (target.pathname.endsWith("/core")) data = { project };
        if (target.pathname.endsWith("/units")) data = { units, canvasCounts: {} };
        if (target.pathname.endsWith("/workspace")) data = makeWorkspace(units.find((unit) => target.pathname.includes(unit.id)));
        return route.fulfill({ json: { code: 0, data, msg: "" } });
    });
    await page.goto(url);
    if (waitForShots) await page.locator(".workflow-timeline-shot").nth(1).waitFor();
    return { context, page, failures, counts, refresh: () => page.evaluate(() => window.refreshProjectReads()) };
}

try {
    for (const endpoint of ["/api/projects/read-project/core", "/api/projects/read-project/units", "/api/projects/read-project/units/chapter-a/workspace"]) {
        const { context, page, failures, refresh } = await scenario();
        failures.set(endpoint, 503);
        await refresh();
        assert.equal(await page.getByText("项目不可用", { exact: true }).count(), 0, "transient refresh must not label an existing project unavailable");
        await page.getByText("项目数据刷新失败", { exact: true }).waitFor();
        await page.locator(".workflow-timeline-shot").nth(1).click();
        assert.match(await page.locator(".workflow-timeline-shot.is-active").innerText(), /镜头\s*02/);
        failures.clear();
        await page.getByRole("button", { name: "重试读取", exact: true }).click();
        await page.getByText("项目数据刷新失败", { exact: true }).waitFor({ state: "hidden" });
        assert.match(await page.locator(".workflow-timeline-shot.is-active").innerText(), /镜头\s*02/);
        await context.close();
    }
    for (const [endpoint, status] of [["core", 403], ["core", 404], ["units", 403], ["units", 404]]) {
        const { context, page, failures, refresh } = await scenario();
        failures.set(`/api/projects/read-project/${endpoint}`, status);
        await refresh();
        await page.getByText("项目不可用", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-timeline-shot").count(), 0, "real access denial must not keep cached content visible");
        await context.close();
    }
    {
        const { context, page, failures } = await scenario({ initialFailures: [["/api/projects/read-project/core", 503]], waitForShots: false });
        await page.getByText("项目读取失败", { exact: true }).waitFor();
        assert.equal(await page.getByText("项目不可用", { exact: true }).count(), 0);
        failures.clear();
        await page.getByRole("button", { name: "重试读取", exact: true }).click();
        await page.locator(".workflow-timeline-shot").nth(1).waitFor();
        await context.close();
    }
    {
        const { context, page, counts } = await scenario({ delays: [["/api/projects/read-project/core", 4_500], ["/api/projects/read-project/units/chapter-a/workspace", 4_500]] });
        assert.equal(counts.get("/api/projects/read-project/core"), 1, "a slow read must not timeout and retry at four seconds");
        assert.equal(counts.get("/api/projects/read-project/units/chapter-a/workspace"), 1);
        assert.equal(await page.getByText("项目不可用", { exact: true }).count(), 0);
        await context.close();
    }
    {
        const { context, page, failures, counts, refresh } = await scenario();
        const endpoint = "/api/projects/read-project/core";
        const before = counts.get(endpoint);
        failures.set(endpoint, { status: 503, remaining: 1 });
        await refresh();
        assert.equal(counts.get(endpoint), before + 2, "one transient failure should recover automatically after one retry");
        assert.equal(await page.getByText("项目数据刷新失败", { exact: true }).count(), 0);
        await page.locator(".workflow-timeline-shot").nth(1).click();
        assert.match(await page.locator(".workflow-timeline-shot.is-active").innerText(), /镜头\s*02/);
        await context.close();
    }
    {
        const { context, page, failures, refresh } = await scenario();
        failures.set("/api/projects/read-project/units/chapter-a/workspace", 403);
        await refresh();
        await page.getByText("分镜工作区读取失败", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-timeline-shot").count(), 0);
        await context.close();
    }
    {
        const { context, page, failures } = await scenario();
        failures.set("/api/projects/read-project/units/chapter-b/workspace", 503);
        await page.getByRole("button", { name: "下一章", exact: true }).click();
        await page.getByText("分镜工作区读取失败", { exact: true }).waitFor();
        assert.equal(await page.locator(".workflow-timeline-shot").count(), 0, "a new chapter must never display the previous chapter's cached shots on failure");
        failures.clear();
        await page.getByRole("button", { name: "重试读取", exact: true }).click();
        await page.locator(".workflow-timeline-shot").nth(1).waitFor();
        await page.getByRole("button", { name: "定位章节，当前第 2 章", exact: true }).waitFor();
        await context.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], "switching shots and recovering reads must never submit or modify tasks");
    console.log("PASS project read recovery: cached/initial/slow reads, automatic/manual retry, shot/chapter switching, 403/404 boundaries; no writes");
} finally { await browser.close(); }
