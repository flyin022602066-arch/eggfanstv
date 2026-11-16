import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";

const url = process.argv[2];
const artifactDir = await mkdtemp(join(tmpdir(), "eggfans-episode-download-"));
console.log("Artifacts: " + artifactDir);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        page.setDefaultTimeout(6000);
        const errors = [], writes = [], resourceRequests = [];
        let downloads = 0;
        page.on("download", () => { downloads++; });
        let hold, failRead = false;
        page.on("pageerror", (error) => errors.push(error.stack || error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url());
            if (target.origin !== new URL(url).origin) return route.abort();
            if (request.method() !== "GET") { writes.push(request.method() + " " + target.pathname); return route.abort(); }
            if (target.pathname.startsWith("/api/resources/") && target.pathname.endsWith("/file")) {
                if (target.searchParams.has("variant")) return route.fulfill({ status: 404, body: "no preview" });
                resourceRequests.push(target.pathname);
                if (hold) await hold;
                return route.fulfill({ status: failRead ? 404 : 200, contentType: "video/mp4", body: failRead ? "missing" : "original:" + target.pathname.split("/").at(-2) });
            }
            if (target.pathname.endsWith("/workspace")) return route.fulfill({ json: { code: 0, data: { unit: { id: "preview-chapter", title: "第7集" }, shots: [], shotReferences: [], shotRevisions: [], shotArtifacts: [], assets: [], tasks: [], workflows: [], assetCandidates: [] }, msg: "" } });
            if (target.pathname.endsWith("/character-versions")) return route.fulfill({ json: { code: 0, data: { revision: 1, versions: [] }, msg: "" } });
            if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: { assets: [], skills: [], tasks: [], total: 0 }, msg: "" } });
            return route.continue();
        });
        const visit = async (scenario) => {
            await page.goto(url + "?episodeDownload=" + scenario + "&theme=" + theme);
            await page.addStyleTag({ url: url + "episode-download.css" });
            await page.addStyleTag({ content: "html,body,#root,.ant-app {height:100%;min-height:0;margin:0} .ant-app {display:flex;flex-direction:column} .workflow-production-shell {flex:1;min-height:0}" });
        };
        await visit("missing");
        const button = page.getByRole("button", { name: "下载本集视频", exact: true });
        await button.waitFor({ timeout: 5000 }).catch(async (error) => { throw new Error(error.message + "\n" + JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 3000) })); }); assert.ok(await button.isDisabled()); assert.match(await button.getAttribute("title"), /镜头04/);
        await visit("ready");
        let release; hold = new Promise((resolve) => { release = resolve; });
        const downloaded = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
        await button.click();
        await page.getByRole("status").filter({ hasText: "正在打包 0/4" }).waitFor().catch(async (error) => { throw new Error(error.message + "\n" + JSON.stringify({ errors, resourceRequests, body: (await page.locator("body").innerText()).slice(-5000) })); });
        const activeButton = page.getByRole("status").filter({ hasText: "正在打包 0/4" }).locator("xpath=ancestor::button[1]");
        await activeButton.evaluate((element) => { element.click(); element.click(); });
        const bounds = await activeButton.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1440 && bounds.y + bounds.height <= 1000, "download stays visible beside the episode timeline");
        await page.screenshot({ path: join(artifactDir, theme + "-progress.png"), fullPage: true });
        hold = undefined; release();
        const result = await downloaded;
        assert.ok(result, JSON.stringify({ errors, resourceRequests, body: (await page.locator("body").innerText()).slice(-5000) }));
        assert.equal(result.suggestedFilename(), "预览测试_第7集_全部镜头.zip");
        const archive = unzipSync(new Uint8Array(await readFile(await result.path())));
        assert.deepEqual(Object.keys(archive), ["001_镜头1_v2.mp4", "002_镜头2_v2.mp4", "003_镜头3_v2.mp4", "004_镜头4_v1.mp4"]);
        assert.deepEqual(Object.values(archive).map((bytes) => strFromU8(bytes)), ["a", "b", "c", "empty"].map((shot) => `original:resource-shot-${shot}-v${shot === "empty" ? 1 : 2}`));
        await page.getByText("已发起本集视频 ZIP 下载", { exact: true }).waitFor({ state: "attached" });
        assert.equal(downloads, 1, "repeated clicks do not start duplicate archives");
        for (const shot of ["b", "c", "empty"]) assert.equal(resourceRequests.filter((path) => path.includes(`resource-shot-${shot}-v`)).length, 1);
        failRead = true;
        await button.click();
        await page.getByText(/镜头01下载失败/).waitFor({ state: "attached" });
        assert.ok(await button.isEnabled(), "failed export can be retried");
        failRead = false;
        await page.evaluate(() => {
            window.nativeSaveCalls = [];
            window.nativeSaveResult = "cancelled";
            window.go = { main: { DesktopApp: { SaveOwnedArtifact: async (name, data) => {
                window.nativeSaveCalls.push({ name, data });
                if (window.nativeSaveResult === "failed") throw new Error("测试磁盘写入失败");
                return false;
            } } } };
        });
        await button.click();
        await page.waitForFunction(() => window.nativeSaveCalls.length === 1);
        await page.waitForFunction(() => !document.body.textContent.includes("正在打包"));
        assert.equal(await page.getByText("本集视频已打包保存到所选位置", { exact: true }).count(), 0);
        await page.evaluate(() => { window.nativeSaveResult = "failed"; });
        await button.click();
        await page.getByText("测试磁盘写入失败", { exact: true }).waitFor({ state: "attached" });
        await page.getByRole("button", { name: "切换产物类型", exact: true }).click();
        assert.equal(await button.count(), 0, "video export does not appear in the storyboard stage");
        assert.deepEqual(errors, []); assert.deepEqual(writes, [], "download never submits generation or mutates project state");
        console.log("PASS episode-download " + theme);
        await page.close();
    }
    console.log("Artifacts: " + artifactDir);
} finally { await browser.close(); }
