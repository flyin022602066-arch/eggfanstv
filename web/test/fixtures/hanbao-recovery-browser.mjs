import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) for (const width of [1400, 390]) {
        for (const scenario of ["missing", "confirmed", "pending", "failed"]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 } });
            page.setDefaultTimeout(8000);
            const errors = [], queries = [];
            const reason = "憨包text2video：画布连续 1 次生成失败（生成失败，请重试）：这条先跳过，可稍后重试或换个账号";
            let task = {
                id: "hanbao-recovery-fixture", projectId: "canvas-fixture", type: "canvas_video", model: "hanbao::seedance_v2.5",
                status: "failed", stage: scenario === "confirmed" ? "生成失败" : "submission_unknown", prompt: "离线测试",
                providerRequestId: ["pending", "failed"].includes(scenario) ? "hanbao:original-opaque-receipt" : undefined,
                error: scenario === "confirmed" ? reason : "提交结果尚未确认", attempts: 1,
                errorCode: scenario === "confirmed" ? "async_failed" : "submission_uncertain",
                createdAt: "2026-11-08T19:21:32+08:00", updatedAt: "2026-11-08T19:22:32+08:00",
                failureDiagnostics: { source: scenario === "confirmed" ? "upstream_response" : "local_runtime", summary: scenario === "confirmed" ? reason : "组件未返回完整回执", executionResult: scenario === "confirmed" ? "failed" : "pending" },
            };
            page.on("pageerror", (error) => errors.push(error.stack || error.message));
            await page.route("**/*", async (route) => {
                const request = route.request(), target = new URL(request.url());
                if (target.origin !== new URL(url).origin) { errors.push("external request " + target.origin); return route.abort(); }
                const path = target.pathname;
                if (!path.startsWith("/api/")) return route.continue();
                const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
                if (path === `/api/tasks/${task.id}/query-provider` && request.method() === "POST") {
                    queries.push(path);
                    task = { ...task, status: scenario === "pending" ? "running" : "failed", stage: scenario === "pending" ? "上游仍在生成，继续查询原任务" : "生成失败", errorCode: "", error: scenario === "pending" ? "" : "参考素材不符合要求", failureDiagnostics: { source: "upstream_response", summary: "参考素材不符合要求", executionResult: "failed" } };
                    return ok({ task, providerStatus: scenario === "pending" ? "running" : "failed", recovered: false });
                }
                if (path === `/api/tasks/${task.id}` && request.method() === "GET") return ok(task);
                if (path === `/api/tasks/${task.id}/logs` && request.method() === "GET") return ok([]);
                errors.push("unexpected API " + request.method() + " " + path);
                return route.abort();
            });
            await page.goto(url + `?mode=recovery&theme=${theme}&scenario=${scenario}`);
            const dialog = page.getByRole("dialog", { name: "任务详情" });
            try {
                await dialog.waitFor();
            } catch (error) {
                console.log(JSON.stringify({ theme, width, scenario, errors, body: await page.locator("body").innerText() }));
                await page.screenshot({ path: join(artifactDir, `recovery-error-${scenario}-${theme}-${width}.png`), fullPage: true });
                throw error;
            }
            const retrieve = dialog.getByRole("button", { name: "取回结果", exact: true });
            const details = dialog.locator("details.generation-failure-log");
            assert.equal(await details.getAttribute("open"), null);
            if (scenario === "missing") {
                await dialog.locator(".generation-failure-action").filter({ hasText: /未取得完整任务号.*憨包账号管理/ }).waitFor();
                assert.equal(await retrieve.count(), 0);
            } else if (scenario === "confirmed") {
                await dialog.locator(".generation-failure-reason").filter({ hasText: "画布连续 1 次生成失败" }).waitFor();
                assert.equal(await retrieve.count(), 0);
                assert.ok(!(await dialog.innerText()).includes("请先查询原任务状态"));
            } else {
                await retrieve.click();
                if (scenario === "pending") {
                    await page.getByLabel("画布任务状态").filter({ hasText: '"taskStatus":"running"' }).waitFor();
                    await retrieve.waitFor({ state: "hidden" });
                } else {
                    await dialog.getByText("参考素材不符合要求", { exact: true }).waitFor();
                    await page.getByLabel("画布任务状态").filter({ hasText: '"taskStage":"生成失败"' }).waitFor();
                    assert.ok(!(await page.locator(".ant-message").innerText()).includes("仍在处理中"));
                }
                assert.equal(queries.length, 1);
            }
            if (await details.count()) {
                await details.locator("summary").click();
                assert.notEqual(await details.getAttribute("open"), null);
            }
            assert.deepEqual(errors, []);
            await dialog.screenshot({ path: join(artifactDir, `recovery-${scenario}-${theme}-${width}.png`) });
            await page.close();
        }
        console.log(`PASS recovery ${theme}/${width}: missing receipt guidance, confirmed failure, query-only retrieval, canvas status refresh`);
    }
    console.log(`Recovery screenshots: ${artifactDir}`);
    for (const theme of ["dark", "light"]) for (const width of [1400, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        let currentStage = "";
        await page.route("**/*", (route) => {
            const target = new URL(route.request().url());
            if (target.origin !== new URL(url).origin) { errors.push("external request " + target.origin); return route.abort(); }
            if (!target.pathname.startsWith("/api/")) return route.continue();
            const data = target.pathname === "/api/tasks/hanbao-recovery-fixture"
                ? { id: "hanbao-recovery-fixture", type: "canvas_video", model: "hanbao::seedance_v2.5", status: "running", stage: currentStage, progress: 0, prompt: "离线测试", attempts: 1, createdAt: "2026-11-08T19:21:32+08:00" }
                : [];
            return route.fulfill({ json: { code: 0, data, msg: "" } });
        });
        for (const stage of ["已提交，正在查询上游状态（发起于 21:30:00）", "上游排队中（查询于 21:30:00）", "上游生成中（查询于 21:30:00）", "查询暂不可用，稍后继续查询原任务", "本地组件查询等待超时，上游结果未确认", "正在取回生成结果"]) {
            currentStage = stage;
            await page.goto(url + `?mode=recovery&theme=${theme}&stage=${encodeURIComponent(stage)}`);
            await page.getByLabel("视频节点状态").getByText(stage, { exact: true }).waitFor();
            const dialog = page.getByRole("dialog", { name: "任务详情" });
            await dialog.getByText(stage, { exact: true }).waitFor();
            assert.ok(!(await dialog.innerText()).includes("0%"));
            assert.ok(!(await page.getByLabel("视频节点状态").innerText()).includes("0%"));
        }
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(artifactDir, `stages-${theme}-${width}.png`), fullPage: true });
        await page.close();
        console.log(`PASS stages ${theme}/${width}: canvas and task detail show actual Hanbao stages without invented percentages`);
    }
} finally { await browser.close(); }
