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
        const writes = [], errors = [];
        let settings = { account: "", channel: "auto", canvasAttempts: 1, versionCode: "20800", pcVersion: "3.43.2", feihu: { baseUrl: "https://my.feihu2026.com/api/sms", projectId: "1382", apiKey: "", apiSecret: "", hasApiKey: false, hasApiSecret: false } };
        let loggedIn = false, polls = 0;
        let pendingLogin;
        page.on("pageerror", (error) => errors.push(error.stack || error.message));
        page.on("console", (entry) => { if ((entry.type() === "error" || entry.type() === "warning") && entry.text() !== "Failed to load resource: the server responded with a status of 400 (Bad Request)") errors.push(entry.text()); });
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
            if (path === "/api/hanbao/accounts/login") {
                assert.equal(body.account, "创作账号1");
                const attempt = writes.filter((item) => item.path.endsWith("/login")).length;
                if (attempt === 1) { pendingLogin = route; return; }
                if (attempt === 2) return ok({});
                if (attempt === 3) return route.fulfill({ status: 400, json: { code: 400, msg: "憨包login：登录窗口已关闭或与浏览器连接中断", reason: "invalid_request", data: null } });
                loggedIn = true;
                return ok({ logged_in: true, account: "创作账号1" });
            }
            if (path === "/api/hanbao/accounts/accounts") return ok({ accounts: loggedIn ? [{ id: "创作账号1", logged_in: true, daily_limit: 10, used_today: 1 }] : [] });
            if (path === "/api/hanbao/accounts/checklogin") return ok({ logged_in: true });
            if (path === "/api/hanbao/sms/orders") return ok([]);
            if (path === "/api/hanbao/sms/connect") return ok({ connected: true });
            if (path === "/api/hanbao/sms/info") return ok({ money: 10, max_num: 50, available_num: 49 });
            if (path === "/api/hanbao/sms/projects") {
                assert.ok(["豆包三次", "不存在的平台"].includes(body.name));
                return ok({ list: body.name === "不存在的平台" ? [] : [{ project_id: 17868, name: "豆包三次", price: 0.2, status: 2 }] });
            }
            if (path === "/api/hanbao/sms/receive") {
                assert.equal(body.account, "创作账号1");
                assert.equal(body.filters.mode, "1", "platform mode must be explicit");
                assert.equal(settings.feihu.projectId, "17868", "selected project must be saved before purchasing");
                if (writes.filter((item) => item.path.endsWith("/receive")).length === 1) return route.fulfill({ status: 400, json: { code: 400, msg: "飞狐接码取号失败（HTTP=200，code=107001）：上游测试拒绝", reason: "invalid_request", data: null } });
                return ok({ order_id: "fixture-order", account: body.account, phone: "13800138000", pid: "17868", status: 1 });
            }
            if (path === "/api/hanbao/sms/message") { polls++; return ok({ order_id: "fixture-order", account: "创作账号1", phone: "13800138000", pid: "1382", status: 3, code: "4829", message: "【豆包】验证码 4829" }); }
            if (path === "/api/hanbao/sms/blacklist") {
                assert.equal(body.orderId, "fixture-order");
                return ok({ order_id: "fixture-order", account: "创作账号1", phone: "13800138000", pid: "17868", status: 3, code: "4829", message: "【豆包】验证码 4829" });
            }
            errors.push("unexpected API: " + path); return route.abort();
        });
        await page.goto(url + "?theme=" + theme);
        assert.equal(await page.title(), "BeefTV Hanbao Offline QA");
        assert.equal(new URL(page.url()).origin, new URL(url).origin);
        await page.getByRole("button", { name: "账号管理", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("自动轮换可用账号", { exact: true }).first().waitFor();
        assert.equal(await page.locator("vite-error-overlay, nextjs-portal").count(), 0);
        await dialog.getByLabel("账号标签", { exact: true }).fill("创作账号1");
        assert.equal(writes.filter((item) => item.path.endsWith("/login")).length, 0, "opening manager never logs in automatically");
        try {
            await Promise.all([
                page.waitForRequest((request) => request.url().endsWith("/api/hanbao/accounts/login")),
                dialog.getByRole("button", { name: "登录 / 添加账号" }).click(),
            ]);
        } catch (error) {
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-login-failed.png`), fullPage: true });
            console.log(JSON.stringify({ writes, errors, text: await dialog.innerText() }));
            throw error;
        }
        await page.clock.runFor(300);
        await dialog.getByRole("tab", { name: "飞狐接码 · 仅憨包" }).click();
        const saveButton = dialog.getByRole("button", { name: "保存接码设置", exact: true });
        assert.equal(await saveButton.evaluate(button => button.classList.contains("ant-btn-loading")), false, "a pending browser login must not make save settings spin");
        assert.equal(await saveButton.isDisabled(), true, "saving must explain the login lock instead of silently ignoring clicks");
        await dialog.getByRole("button", { name: "结束登录等待", exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('保存接码设置'))?.disabled === false);
        await dialog.getByText(/已结束登录等待.*未确认登录完成/u).waitFor();
        await pendingLogin.abort().catch(() => {});
        await dialog.getByRole("tab", { name: "账号", exact: true }).click();
        await dialog.getByRole("button", { name: "登录 / 添加账号" }).click();
        await dialog.getByText(/未确认登录完成.*检查登录/u).waitFor();
        assert.equal(await dialog.getByRole("button", { name: "用于生成" }).count(), 0);
        await dialog.getByRole("button", { name: "登录 / 添加账号" }).click();
        await dialog.getByText(/登录未完成.*登录窗口已关闭/u).waitFor();
        await page.clock.runFor(4500);
        await dialog.getByRole("tab", { name: "飞狐接码 · 仅憨包" }).click();
        assert.equal(await dialog.getByText(/登录未完成.*登录窗口已关闭/u).isVisible(), true, "login outcome stays visible after switching tabs and toast expiration");
        await dialog.getByRole("tab", { name: "账号", exact: true }).click();
        await dialog.getByRole("button", { name: "登录 / 添加账号" }).click();
        await dialog.getByText(/登录已完成.*登录态已保存.*窗口已自动关闭/u).waitFor();
        await page.clock.runFor(4500);
        assert.equal(await dialog.getByText(/登录已完成.*窗口已自动关闭/u).isVisible(), true);
        await dialog.getByRole("button", { name: "用于生成" }).click();
        await dialog.getByText("优先账号", { exact: true }).waitFor();
        assert.equal(settings.account, "创作账号1");
        await dialog.getByRole("button", { name: "恢复自动匹配", exact: true }).click();
        await dialog.getByRole("button", { name: "恢复自动匹配", exact: true }).waitFor({ state: "hidden" });
        assert.equal(settings.account, "", "automatic mode must persist without resetting the login label");
        assert.equal(await dialog.getByLabel("账号标签", { exact: true }).inputValue(), "创作账号1");
        await dialog.screenshot({ path: join(artifactDir, `${theme}-${width}-accounts.png`) });
        await dialog.getByRole("tab", { name: "飞狐接码 · 仅憨包" }).click();
        await dialog.getByLabel("飞狐 API账号", { exact: true }).fill("fixture-key");
        await dialog.getByLabel("飞狐 API密钥", { exact: true }).fill("fixture-secret");
        await dialog.getByRole("button", { name: "保存接码设置" }).click();
        await dialog.getByRole("status").filter({ hasText: /^已保存$/u }).waitFor();
        await dialog.getByLabel("飞狐 API密钥", { exact: true }).getAttribute("placeholder").then((value) => assert.equal(value, "已保存密钥；留空保留"));
        await dialog.getByRole("button", { name: "连接 / 重新认证" }).click();
        await dialog.getByRole("button", { name: "查询余额", exact: true }).click();
        await dialog.getByText(/可用取号配额：49 \/ 50/u).waitFor();
        assert.equal(writes.filter((item) => item.path.endsWith("/receive")).length, 0, "balance check must not purchase a phone");
        await dialog.getByLabel("平台名称", { exact: true }).fill("不存在的平台");
        await dialog.getByRole("button", { name: "查询项目 ID", exact: true }).click();
        await dialog.getByText("未找到“不存在的平台”对应的项目", { exact: true }).waitFor();
        await dialog.getByLabel("平台名称", { exact: true }).fill("豆包三次");
        await dialog.getByLabel("平台名称", { exact: true }).press("Enter");
        await dialog.getByRole("combobox", { name: "接码项目搜索结果" }).click();
        await page.getByText("豆包三次 · ID 17868 · 0.2 元", { exact: true }).click();
        await page.waitForFunction(() => document.querySelector('input[aria-label="接码项目 ID"]')?.value === "17868").catch(async (error) => {
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-project-selection-failed.png`), fullPage: true });
            console.log(JSON.stringify({ writes, alerts: await page.getByRole("alert").allTextContents() }));
            throw error;
        });
        await dialog.getByLabel("接码项目 ID", { exact: true }).inputValue().then((value) => assert.equal(value, "17868"));
        assert.equal(await dialog.getByRole("combobox", { name: "取号模式" }).isVisible(), true, "phone source mode must be visible without opening advanced filters");
        await dialog.getByRole("button", { name: /^取\s*号$/u }).click();
        await dialog.getByText(/飞狐接码取号失败.*107001.*上游测试拒绝/u).waitFor();
        await dialog.getByRole("tab", { name: "账号", exact: true }).click();
        assert.equal(await dialog.getByText(/107001/u).count(), 0, "SMS errors must not appear in the account tab");
        await dialog.getByRole("tab", { name: "飞狐接码 · 仅憨包" }).click();
        await dialog.getByRole("button", { name: /^取\s*号$/u }).click();
        await dialog.getByText("13800138000", { exact: true }).waitFor();
        await dialog.getByRole("switch", { name: "自动收码（间隔 ≥ 10 秒）" }).check();
        await page.clock.runFor(11050);
        await dialog.getByText("验证码：4829", { exact: true }).waitFor();
        assert.equal(polls, 1);
        assert.equal(await dialog.getByRole("button", { name: "查询短信" }).isDisabled(), true);
        await dialog.getByRole("button", { name: "拉黑号码", exact: true }).click();
        await page.locator(".ant-popconfirm .ant-btn-primary").click();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('拉黑号码'))?.disabled === false);
        assert.equal(writes.filter((item) => item.path.endsWith("/blacklist")).length, 1);
        await dialog.getByText("已完成", { exact: true }).waitFor();
        assert.equal(await dialog.getByRole("button", { name: "释放号码", exact: true }).isDisabled(), true);
        await dialog.getByText("更多取号筛选", { exact: true }).click();
        await page.clock.runFor(300);
        await dialog.getByText(/号码作者填写对方的网页登录用户名/u).waitFor();
        await dialog.getByText("更多取号筛选", { exact: true }).click();
        await page.clock.runFor(300);
        assert.equal(writes.filter((item) => item.path.endsWith("/receive")).length, 2, "one failed click and one manual retry, never automatic retries");
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
