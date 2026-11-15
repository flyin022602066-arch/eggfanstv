import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const url = new URL(process.argv[2]);
const artifactDir = process.argv[3];
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.setDefaultTimeout(5000);
        const errors = [];
        const changes = [];
        let rejectSave = false;
        const accounts = [31, 13, 7, 18, 19, 28, 16, 17, 3, 2].map((number) => ({ id: "account-" + number, label: "账号 " + number, logged_in: true, plan: "normal", daily_limit: 0, daily_seconds_limit: 30, used_today: number === 31 ? 3 : 0, used_seconds_today: number === 31 ? 23 : 0 }));
        const settings = { account: "", channel: "auto", canvasAttempts: 1, versionCode: "20800", pcVersion: "3.43.2", feihu: { baseUrl: "https://my.feihu2026.com/api/sms", projectId: "", apiKey: "", apiSecret: "" } };
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request();
            const target = new URL(request.url());
            if (target.origin !== url.origin) { errors.push("external request"); return route.abort(); }
            if (!target.pathname.startsWith("/api/")) return route.continue();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (target.pathname === "/api/beefapi/connection") return ok({ state: "disconnected", hasCredential: false });
            if (target.pathname === "/api/hanbao/status") return ok({ available: true, settings });
            if (target.pathname === "/api/hanbao/accounts/accounts") return ok({ accounts });
            if (target.pathname === "/api/hanbao/sms/orders") return ok([]);
            if (target.pathname === "/api/hanbao/accounts/set-plan") {
                const body = request.postDataJSON();
                changes.push(body);
                if (rejectSave) return route.fulfill({ status: 400, json: { code: 400, data: null, msg: "fixture 保存失败", reason: "invalid_request" } });
                const account = accounts.find((item) => item.id === body.account);
                assert.ok(account);
                Object.assign(account, { plan: body.plan, daily_limit: body.dailyLimit, daily_seconds_limit: body.dailySeconds });
                return ok(account);
            }
            errors.push("unexpected API: " + target.pathname);
            return route.abort();
        });
        await page.goto(url.toString());
        await page.getByRole("button", { name: "账号管理", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const card = (number) => dialog.locator("section").filter({ has: page.getByText("账号 " + number, { exact: true }) });
        await card(31).getByText("用户名：account-31", { exact: true }).waitFor();
        await card(13).getByText("用户名：account-13", { exact: true }).waitFor();
        await card(31).getByRole("button", { name: "选择管理", exact: true }).click();
        let editor = dialog.getByRole("region", { name: "账号 31的本地额度设置", exact: true });
        await editor.waitFor();
        await editor.getByText("用户名：account-31", { exact: true }).waitFor();
        assert.equal(changes.length, 0, "selecting management must not modify account settings");
        await editor.getByRole("spinbutton", { name: "每日条数", exact: true }).fill("120");
        await editor.getByRole("spinbutton", { name: "每日秒数", exact: true }).fill("3600");
        await editor.getByRole("button", { name: "保存本地阈值", exact: true }).click();
        await editor.getByRole("status").filter({ hasText: /已保存/u }).waitFor();
        assert.deepEqual(changes[0], { account: "account-31", plan: "normal", dailyLimit: 120, dailySeconds: 3600 });
        assert.equal(accounts[0].used_seconds_today, 23, "changing limits must not reset consumption");
        assert.equal(accounts[1].daily_seconds_limit, 30, "other accounts retain their limits");
        await card(13).getByRole("button", { name: "选择管理", exact: true }).click();
        editor = dialog.getByRole("region", { name: "账号 13的本地额度设置", exact: true });
        await editor.waitFor();
        assert.equal(await editor.getByRole("spinbutton", { name: "每日秒数", exact: true }).inputValue(), "30");
        await editor.getByRole("spinbutton", { name: "每日秒数", exact: true }).fill("90");
        rejectSave = true;
        await editor.getByRole("button", { name: "保存本地阈值", exact: true }).click();
        await editor.getByRole("status").filter({ hasText: /未保存/u }).waitFor();
        assert.equal(accounts[1].daily_seconds_limit, 30);
        assert.equal(await editor.getByRole("spinbutton", { name: "每日秒数", exact: true }).inputValue(), "90");
        rejectSave = false;
        await editor.getByRole("button", { name: "保存本地阈值", exact: true }).click();
        await editor.getByRole("status").filter({ hasText: /已保存/u }).waitFor();
        assert.equal(accounts[1].daily_seconds_limit, 90);
        assert.equal(settings.account, "", "managing an account must not change generation preference");
        await card(31).getByRole("button", { name: "选择管理", exact: true }).click();
        editor = dialog.getByRole("region", { name: "账号 31的本地额度设置", exact: true });
        assert.equal(await editor.getByRole("spinbutton", { name: "每日秒数", exact: true }).inputValue(), "3600");
        await dialog.screenshot({ path: join(artifactDir, "quota-" + width + ".png") });
        await page.reload();
        await page.getByRole("button", { name: "账号管理", exact: true }).click();
        await card(31).getByRole("button", { name: "选择管理", exact: true }).click();
        await dialog.getByRole("region", { name: "账号 31的本地额度设置", exact: true }).getByRole("spinbutton", { name: "每日秒数", exact: true }).inputValue().then((value) => assert.equal(value, "3600"));
        assert.deepEqual(errors, []);
        await page.close();
        console.log("PASS quota editor " + width + ": visible selection, independent account saves, retained consumption, errors/retry, reload; zero upstream calls");
    }
} finally {
    await browser.close();
}
