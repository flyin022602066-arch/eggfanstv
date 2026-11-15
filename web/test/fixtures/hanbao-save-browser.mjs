import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) for (const width of [1400, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.setDefaultTimeout(8000);
        await page.clock.install();
        let settings = { account: "", channel: "chat", canvasAttempts: 1, versionCode: "20800", pcVersion: "3.43.2", feihu: { baseUrl: "https://my.feihu2026.com/api/sms", projectId: "", apiKey: "", apiSecret: "" } };
        let saveMode = "hold", refreshMode = "ok", pendingSave, pendingRefresh, saveCount = 0;
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request"); return route.abort(); }
            if (!path.startsWith("/api/")) return route.continue();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (path === "/api/beefapi/connection") return ok({ state: "disconnected", hasCredential: false });
            if (path === "/api/hanbao/status") {
                if (refreshMode === "hold") { pendingRefresh = { route, settings: structuredClone(settings) }; return; }
                if (refreshMode === "fail") return route.fulfill({ status: 503, json: { code: 503, msg: "状态读取暂时不可用" } });
                return ok({ available: true, settings });
            }
            if (path === "/api/hanbao/accounts/accounts") return ok({ accounts: [] });
            if (path === "/api/hanbao/sms/orders") return ok([]);
            if (path === "/api/hanbao/settings") {
                saveCount++;
                const body = request.postDataJSON();
                if (saveMode === "hold") { pendingSave = { route, body }; return; }
                if (saveMode === "fail") return route.fulfill({ status: 400, json: { code: 400, msg: "网页版本参数格式无效" } });
                if (saveMode === "unconfirmed") return ok({ saved: false });
                settings = body;
                return ok({ saved: true });
            }
            errors.push("unexpected API: " + path);
            return route.abort();
        });
        await page.goto(url + "?theme=" + theme);
        await page.getByRole("button", { name: "账号管理", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("tab", { name: "调用参数", exact: true }).click();
        const button = dialog.getByRole("button", { name: "保存调用参数", exact: true });
        const feedback = dialog.getByRole("status");
        const version = dialog.getByLabel("PC 版本号", { exact: true });
        await version.fill("3.43.3");
        const firstSave = page.waitForRequest((request) => request.url().endsWith("/api/hanbao/settings"));
        await button.click();
        await firstSave;
        await feedback.filter({ hasText: "正在保存" }).waitFor();
        await version.fill("3.43.4");
        settings = pendingSave.body;
        refreshMode = "hold";
        const refreshRequested = page.waitForRequest((request) => request.url().endsWith("/api/hanbao/status"));
        await pendingSave.route.fulfill({ json: { code: 0, data: { saved: true }, msg: "" } });
        await refreshRequested;
        await feedback.filter({ hasText: "提交的设置已保存，当前修改尚未保存" }).waitFor();
        assert.equal(await version.inputValue(), "3.43.4", "saving must preserve newer edits");
        assert.equal(await button.isDisabled(), false, "status refresh must not block further saves");
        await pendingRefresh.route.fulfill({ json: { code: 0, data: { available: true, settings: pendingRefresh.settings }, msg: "" } });
        await page.clock.runFor(100);
        assert.equal(await version.inputValue(), "3.43.4", "stale status must not overwrite newer edits");

        saveMode = "ok";
        refreshMode = "fail";
        await button.click();
        await feedback.filter({ hasText: "设置已保存，但状态刷新失败：状态读取暂时不可用" }).waitFor();
        assert.equal(settings.pcVersion, "3.43.4");
        assert.equal(await button.isDisabled(), false);
        assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, "long feedback must wrap within the dialog");
        await dialog.screenshot({ path: join(artifactDir, `save-refresh-warning-${theme}-${width}.png`) });

        saveMode = "fail";
        await version.fill("3.43.5");
        assert.equal(await feedback.count(), 0, "editing clears stale saved confirmation");
        await button.click();
        await feedback.filter({ hasText: "未确认保存成功" }).waitFor();
        await dialog.getByText("网页版本参数格式无效", { exact: true }).waitFor();
        assert.equal(settings.pcVersion, "3.43.4");

        saveMode = "unconfirmed";
        await button.click();
        await dialog.getByText("后端未确认保存成功，请重新打开核对设置", { exact: true }).waitFor();
        assert.equal(settings.pcVersion, "3.43.4");

        saveMode = "ok";
        refreshMode = "ok";
        await button.click();
        await feedback.filter({ hasText: /^已保存$/u }).waitFor();
        await page.clock.runFor(6000);
        assert.equal(await feedback.innerText(), "已保存", "saved confirmation must outlast the toast");
        assert.equal(settings.pcVersion, "3.43.5");
        assert.equal(saveCount, 5, "no automatic resubmission");
        await dialog.screenshot({ path: join(artifactDir, `save-${theme}-${width}.png`) });
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS save ${theme}/${width}: persistent confirmation, failure details, unconfirmed response, refresh failure and edit preservation; no external traffic`);
    }
    console.log(`Save screenshots: ${artifactDir}`);
} finally { await browser.close(); }
