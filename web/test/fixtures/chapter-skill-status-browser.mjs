import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2];
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const report = [{ skillId: "camera", skillName: "大师级摄影机位与镜头设计", version: "1.2.0", status: "loaded", files: ["SKILL.md", "references/camera.md"], truncated: false }];
const base = { id: "saved-task", projectId: "offline-project", type: "canvas_text", status: "succeeded", prompt: "", attempts: 1, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", clientContext: { chapterId: "chapter-1", chapterOperation: "storyboard" } };
const regionName = { name: "拆解技能调用状态" };
async function expand(region) {
    const details = region.locator("details");
    if (!(await details.evaluate((element) => element.open))) await region.locator("summary").click();
}

try {
    for (const theme of ["dark", "light"]) for (const width of [1440, 768, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 780 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
        await page.goto(url + "?static&theme=" + theme);
        const region = page.getByRole("region", { name: "拆解技能调用状态" });
        await region.waitFor();
        assert.equal(await region.locator("details").evaluate((element) => element.open), false, "skill details must start collapsed");
        assert.ok((await region.boundingBox()).height < 120, "collapsed skill status must be compact");
        assert.ok((await region.innerText()).includes("失败 1 项"), "failures must remain visible when collapsed");
        assert.equal(await region.getByText("读取文件：SKILL.md、references/camera.md", { exact: true }).isVisible(), false);
        await region.locator("summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await region.locator("details").evaluate((element) => element.open), true, "keyboard must expand skill details");
        const text = await region.innerText();
        for (const label of ["大师级摄影机位与镜头设计", "电影光影设计与精细布光", "已加入拆解请求", "加载失败", "文件读取失败", "拆解失败", "不代表模型已逐条执行"]) {
            assert.ok(text.includes(label), width + "px should show " + label);
        }
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        assert.ok(dimensions.scroll <= dimensions.client + 1, width + "px must not overflow horizontally: " + JSON.stringify(dimensions));
        assert.deepEqual(errors, []);
        await page.goto(url + "?shortscript&theme=" + theme);
        await region.getByText("脚本待修订", { exact: true }).waitFor();
        assert.equal(await region.locator("details").evaluate((element) => element.open), false);
        await expand(region);
        for (const label of ["只有 2 个内部镜头", "至少需要 8 个", "镜头与表演正文", "已加入拆解请求"]) assert.ok((await region.innerText()).includes(label));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        await page.close();
    }
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let failed = false;
    let detailReads = 0;
    let taskStatus = "running";
    let legacy = false;
    await page.route("**/*", async (route) => {
        const request = new URL(route.request().url());
        assert.equal(route.request().method(), "GET", "status UI must never submit a generation");
        if (request.origin !== new URL(url).origin) return route.abort();
        if (request.pathname === "/api/tasks") return route.fulfill({ json: { code: 0, data: [base], msg: "" } });
        if (request.pathname === "/api/tasks/saved-task") {
            detailReads += 1;
            if (failed) return route.fulfill({ status: 503, json: { code: 503, msg: "offline fixture unavailable" } });
            return route.fulfill({ json: { code: 0, data: { ...base, status: taskStatus, inputJson: JSON.stringify({ metadata: legacy ? {} : { skillLoadReport: report } }) }, msg: "" } });
        }
        return route.continue();
    });
    await page.goto(url + "?theme=dark");
    const region = page.getByRole("region", regionName);
    await region.getByText("已加载 1 项", { exact: true }).waitFor();
    await expand(region);
    await region.getByText("已加入拆解请求", { exact: true }).waitFor();
    assert.ok((await region.innerText()).includes("拆解中"));
    taskStatus = "succeeded";
    await region.getByText("拆解完成", { exact: true }).waitFor();
    assert.ok(detailReads >= 2, "task status must update without reload");
    await page.reload();
    await region.getByText("已加载 1 项", { exact: true }).waitFor();
    await expand(region);
    await region.getByText("已加入拆解请求", { exact: true }).waitFor();
    assert.ok((await region.innerText()).includes("大师级摄影机位与镜头设计"), "saved report must survive reload");
    await page.getByRole("button", { name: "切换章节" }).click();
    await expand(region);
    await region.getByText("此任务未记录技能调用明细，无法确认各项技能是否成功。").waitFor();
    assert.ok(!(await region.innerText()).includes("大师级摄影机位与镜头设计"), "other chapter must not inherit report");
    await page.getByRole("button", { name: "切换章节" }).click();
    await region.getByText("已加载 1 项", { exact: true }).waitFor();
    await expand(region);
    await region.getByText("已加入拆解请求", { exact: true }).waitFor();
    failed = true;
    await page.reload();
    await region.getByText("调用记录读取失败", { exact: true }).waitFor();
    await expand(region);
    await region.getByRole("button", { name: "重新读取" }).waitFor();
    failed = false;
    await region.getByRole("button", { name: "重新读取" }).click();
    await region.getByText("已加入拆解请求", { exact: true }).waitFor();
    legacy = true;
    await page.reload();
    await region.getByText("拆解完成", { exact: true }).waitFor();
    await expand(region);
    await region.getByText("此任务未记录技能调用明细，无法确认各项技能是否成功。").waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    const handoff = await browser.newPage();
    let newerTaskAvailable = false;
    let localReads = 0;
    await handoff.route("**/*", async (route) => {
        const request = new URL(route.request().url());
        assert.equal(route.request().method(), "GET", "local handoff must never submit a generation");
        if (request.origin !== new URL(url).origin) return route.abort();
        const newerTask = { ...base, id: "newer-task", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" };
        if (request.pathname === "/api/tasks") return route.fulfill({ json: { code: 0, data: newerTaskAvailable ? [newerTask] : [], msg: "" } });
        if (request.pathname === "/api/tasks/local-task") {
            localReads += 1;
            return route.fulfill({ json: { code: 0, data: { ...base, id: "local-task", status: localReads > 1 ? "succeeded" : "running", createdAt: "2026-11-01T11:00:00Z", updatedAt: localReads > 1 ? "2026-11-01T11:01:00Z" : "2026-11-01T11:00:00Z", inputJson: JSON.stringify({ metadata: { skillLoadReport: [{ ...report[0], skillName: "本次机位设计" }] } }) }, msg: "" } });
        }
        if (request.pathname === "/api/tasks/newer-task") return route.fulfill({ json: { code: 0, data: { ...newerTask, inputJson: JSON.stringify({ metadata: { skillLoadReport: [{ ...report[0], skillId: "new-lighting", skillName: "服务器新一轮光影" }] } }) }, msg: "" } });
        return route.continue();
    });
    await handoff.goto(url + "?attempt&empty");
    await handoff.getByRole("button", { name: "开始本次准备" }).click();
    const handoffRegion = handoff.getByRole("region", regionName);
    await handoffRegion.getByText("本次拆解准备中", { exact: true }).waitFor();
    assert.ok(!(await handoffRegion.innerText()).includes("本次未选择技能"));
    await handoff.getByRole("button", { name: "提交本次请求" }).click();
    await handoffRegion.getByText("已加载 1 项", { exact: true }).waitFor();
    await expand(handoffRegion);
    await handoffRegion.getByText("本次机位设计", { exact: true }).waitFor({ timeout: 5000 });
    await handoffRegion.getByText("拆解完成", { exact: true }).waitFor({ timeout: 7000 });
    assert.ok(localReads >= 2, "submitted local task must keep polling before task list catches up");
    newerTaskAvailable = true;
    await handoff.getByRole("button", { name: "刷新任务记录" }).click();
    await handoffRegion.getByText("服务器新一轮光影", { exact: true }).waitFor({ state: "attached", timeout: 5000 });
    await expand(handoffRegion);
    await handoffRegion.getByText("服务器新一轮光影", { exact: true }).waitFor({ timeout: 5000 });
    assert.ok(!(await handoffRegion.innerText()).includes("本次机位设计"), "new task must not inherit an older local skill report");
    await handoff.close();
    console.log("PASS skill status: themes, 3 widths, saved-task reload, polling, chapter isolation, read failure and retry, legacy unknown; no model submissions");
} finally {
    await browser.close();
}
