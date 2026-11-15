import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir, scenario] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
const scar = "右眼上额头处有一条清晰的疤痕";
try {
    for (const theme of ["dark", "light"]) {
        const context = await browser.newContext({ viewport: { width: theme === "dark" ? 1280 : 800, height: 1000 }, reducedMotion: "reduce" });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        const errors = [];
        let configRevision = 1;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url());
            if (target.origin !== new URL(url).origin) { errors.push(`unexpected remote ${target.origin}`); return route.abort(); }
            const path = target.pathname;
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (path === "/api/workspace/model-config") {
                if (request.method() === "PUT") {
                    const input = request.postDataJSON();
                    assert.equal(input.expectedRevision, configRevision);
                    return ok({ saved: true, revision: ++configRevision });
                }
                return ok({ config: await page.evaluate(() => window.promptScopeFixture.readConfig()), revision: configRevision, health: "ready", source: "builtin+local" });
            }
            if (path === "/api/projects/prompt-scope-project/core") return ok({ project: await page.evaluate(() => window.promptScopeFixture.project) });
            if (path === "/api/projects/prompt-scope-project/character-versions") return ok({ revision: 1, versions: await page.evaluate(() => window.promptScopeFixture.versions) });
            if (path.startsWith("/api/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#777"/></svg>' });
            if (path.startsWith("/api/")) { errors.push(`${request.method()} ${path}`); return route.abort(); }
            return route.continue();
        });
        await page.goto(`${url}?theme=${theme}${scenario === "legacy" ? "&legacy=1" : scenario === "single-look" ? "&single-look=1" : ""}`);
        const supplement = () => page.getByRole("textbox", { name: /通用生图补充要求|本次资产生图补充要求/ });
        const open = async (name) => { await page.getByRole("button", { name, exact: true }).click(); await supplement().waitFor(); };
        const generate = async () => { await page.getByRole("dialog").getByRole("button", { name: "开始生成", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" }); };
        if (scenario !== "legacy") {
            await open("角色甲");
            await supplement().fill(scar);
            assert.equal(await page.evaluate(() => window.promptScopeFixture.readConfig().projectAssetImagePresets.character.extraPrompt), "", "typing a character supplement must not mutate the shared preset");
            await generate();
            const first = await page.evaluate(() => window.promptScopeFixture.submissions);
            assert.deepEqual(first.map((input) => input.versionId), scenario === "single-look" ? ["a-base"] : ["a-base", "a-winter"]);
            assert.ok(first.every((input) => input.prompt.includes(scar)), "selected looks of this character receive the supplement");
            await open("角色乙");
            assert.equal(await supplement().inputValue(), "");
            await generate();
            assert.equal(await page.evaluate((text) => window.promptScopeFixture.submissions.at(-1).prompt.includes(text), scar), false);
            await open("角色甲");
            assert.equal(await supplement().inputValue(), "");
            await supplement().fill("取消时不保存的角色特征");
            await page.getByRole("dialog").getByRole("button", { name: /取\s*消/ }).click();
            for (const [firstName, secondName, text] of [["场景甲", "场景乙", "屋顶改成蓝色"], ["道具甲", "道具乙", "剑柄增加红色流苏"]]) {
                await open(firstName);
                await supplement().fill(text);
                await generate();
                assert.equal(await page.evaluate((value) => window.promptScopeFixture.submissions.at(-1).prompt.includes(value), text), true);
                await open(secondName);
                assert.equal(await supplement().inputValue(), "");
                await generate();
                assert.equal(await page.evaluate((value) => window.promptScopeFixture.submissions.at(-1).prompt.includes(value), text), false);
            }
            await page.getByRole("button", { name: "统一生图设置", exact: true }).click();
            await supplement().fill("统一纯色背景");
            await page.getByRole("button", { name: "保存设置", exact: true }).click();
            await page.getByRole("dialog").waitFor({ state: "hidden" });
            await open("角色乙");
            assert.equal(await supplement().inputValue(), "", "category requirements stay distinct from the local editor");
            await supplement().fill("短发改为齐耳发");
            await generate();
            const last = await page.evaluate(() => window.promptScopeFixture.submissions.at(-1));
            assert.ok(last.prompt.includes("统一纯色背景") && last.prompt.includes("短发改为齐耳发"));
            const shared = await page.evaluate(() => window.promptScopeFixture.readPresets());
            assert.equal(shared.character.extraPrompt, "统一纯色背景");
            assert.equal(shared.environment.extraPrompt, "");
            assert.equal(shared.prop.extraPrompt, "");
        } else {
            const shared = await page.evaluate(() => window.promptScopeFixture.readPresets());
            assert.ok(Object.values(shared).every((preset) => preset.extraPrompt === ""), "legacy text must be disabled for single and batch generation");
            await open("角色乙");
            assert.equal(await supplement().inputValue(), "");
            await generate();
            assert.equal(await page.evaluate((text) => window.promptScopeFixture.submissions.at(-1).prompt.includes(text), scar), false);
            await page.getByRole("button", { name: "统一生图设置", exact: true }).click();
            await page.getByText("旧版补充要求已暂停通用应用", { exact: true }).waitFor();
            assert.equal(await supplement().inputValue(), "");
            await page.getByRole("dialog").screenshot({ path: join(artifactDir, `${theme}-legacy-disabled.png`), animations: "disabled" });
            await page.getByRole("button", { name: "保存设置", exact: true }).click();
            await page.getByRole("dialog").waitFor({ state: "hidden" });
            assert.ok(Object.values(await page.evaluate(() => window.promptScopeFixture.readPresets())).every((preset) => preset.extraPrompt === ""), "saving model settings must not reactivate legacy text");
        }
        await page.screenshot({ path: join(artifactDir, `${theme}-${scenario}-complete.png`) });
        assert.deepEqual(errors, []);
        await context.close();
    }
    console.log(JSON.stringify({ scenario, artifactDir, realModelCalls: 0 }));
} finally { await browser.close(); }
