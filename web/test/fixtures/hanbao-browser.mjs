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
        const writes = [], errors = [];
        let settings = { account: "", channel: "auto", canvasAttempts: 1, versionCode: "20800", pcVersion: "3.43.2", feihu: { baseUrl: "https://my.feihu2026.com/api/sms", projectId: "1382", apiKey: "", apiSecret: "", hasApiKey: false, hasApiSecret: false } };
        let loggedIn = false, polls = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (entry) => { if (entry.type() === "error" || entry.type() === "warning") errors.push(entry.text()); });
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request: " + target.origin); return route.abort(); }
            if (!path.startsWith("/api/")) return route.continue();
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (path === "/api/beefapi/connection") return ok({ state: "disconnected", hasCredential: false });
            if (path === "/api/hanbao/status") return ok({ available: true, settings });
            const body = request.postDataJSON();
            writes.push({ path, body });
            if (path === "/api/hanbao/settings") {
                settings = { ...body, feihu: { ...body.feihu, apiKey: "", apiSecret: "", hasApiKey: true, hasApiSecret: true } };
                return ok({ saved: true });
            }
            if (path === "/api/hanbao/accounts/login") { assert.equal(body.account, "创作账号1"); loggedIn = true; return ok({ logged_in: true }); }
            if (path === "/api/hanbao/accounts/accounts") return ok({ accounts: loggedIn ? [{ id: "创作账号1", logged_in: true, daily_limit: 10, used_today: 1 }] : [] });
            if (path === "/api/hanbao/accounts/checklogin") return ok({ logged_in: true });
            if (path === "/api/hanbao/sms/orders") return ok([]);
            if (path === "/api/hanbao/sms/connect") return ok({ connected: true });
            if (path === "/api/hanbao/sms/projects") return ok({ list: [{ project_id: 1382, name: "豆包", price: 0.1, status: 2 }] });
            if (path === "/api/hanbao/sms/receive") { assert.equal(body.account, "创作账号1"); return ok({ order_id: "fixture-order", account: body.account, phone: "13800138000", pid: "1382", status: 1 }); }
            if (path === "/api/hanbao/sms/message") { polls++; return ok({ order_id: "fixture-order", account: "创作账号1", phone: "13800138000", pid: "1382", status: 3, code: "4829", message: "【豆包】验证码 4829" }); }
            errors.push("unexpected API: " + path); return route.abort();
        });
        await page.goto(url + "?theme=" + theme);
        assert.equal(await page.title(), "BeefTV Hanbao Offline QA");
        assert.equal(new URL(page.url()).origin, new URL(url).origin);
        await page.getByRole("button", { name: "账号管理", exact: true }).click();
        const dialog = page.getByRole("dialog");
        assert.equal(await page.locator("vite-error-overlay, nextjs-portal").count(), 0);
        await dialog.getByLabel("账号标签", { exact: true }).fill("创作账号1");
        assert.equal(writes.filter((item) => item.path.endsWith("/login")).length, 0, "opening manager never logs in automatically");
        await dialog.getByRole("button", { name: "登录 / 添加账号" }).click();
        await dialog.getByRole("button", { name: "用于生成" }).click();
        await dialog.getByText("生成账号", { exact: true }).waitFor();
        assert.equal(settings.account, "创作账号1");
        await dialog.screenshot({ path: join(artifactDir, `${theme}-${width}-accounts.png`) });
        await dialog.getByRole("tab", { name: "飞狐接码 · 仅憨包" }).click();
        await dialog.getByLabel("飞狐 API Key", { exact: true }).fill("fixture-key");
        await dialog.getByLabel("飞狐 API 密钥", { exact: true }).fill("fixture-secret");
        await dialog.getByRole("button", { name: "保存接码设置" }).click();
        await dialog.getByLabel("飞狐 API 密钥", { exact: true }).getAttribute("placeholder").then((value) => assert.equal(value, "已保存；留空保留"));
        await dialog.getByRole("button", { name: "连接 / 重新认证" }).click();
        await dialog.getByRole("button", { name: "搜索豆包项目" }).click();
        await dialog.getByRole("button", { name: /^取\s*号$/u }).click();
        await dialog.getByText("13800138000", { exact: true }).waitFor();
        await page.clock.install();
        await dialog.getByRole("switch", { name: "自动收码（间隔 ≥ 10 秒）" }).check();
        await page.clock.runFor(11050);
        await dialog.getByText("验证码：4829", { exact: true }).waitFor();
        assert.equal(polls, 1);
        assert.equal(await dialog.getByRole("button", { name: "查询短信" }).isDisabled(), true);
        assert.equal(writes.filter((item) => item.path.endsWith("/receive")).length, 1);
        assert.equal(writes.filter((item) => item.path.includes("/tasks")).length, 0);
        const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
        assert.ok(!storage.includes("fixture-secret") && !storage.includes("fixture-key"));
        await dialog.screenshot({ path: join(artifactDir, `${theme}-${width}-sms.png`) });
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`PASS ${theme}/${width}: model entry, account login/select, encrypted-secret form, SMS receive/poll; no external traffic`);
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
