import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=", "base64");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const remoteRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== new URL(url).origin) { remoteRequests.push(target.href); return route.abort(); }
    if (target.pathname.startsWith("/api/resources/") && target.pathname.endsWith("/content")) return route.fulfill({ body: imageBytes, contentType: "image/png" });
    if (target.pathname.startsWith("/api/resources/")) return route.fulfill({ json: { code: 0, data: { resource: { id: target.pathname.split("/")[3], status: "ready", mimeType: "image/png", kind: "image" } }, msg: "" } });
    if (target.pathname.startsWith("/api/")) return route.fulfill({ json: { code: 0, data: [], msg: "" } });
    return route.continue();
});
const card = (index) => page.locator(".suno-studio-mv-asset").nth(index);
const generate = (index) => card(index).getByRole("button", { name: /生成图片|重新生成/ });
const count = async (expected) => page.waitForFunction((value) => window.mvAssetService.requests.length === value, expected);
const finish = (id, error) => page.evaluate(({ id, error }) => window.mvAssetService.finish(id, error), { id, error });
try {
    await page.goto(url + "?real=1&scope=mv-assets-offline-test");
    await card(7).waitFor();
    await generate(0).click();
    await count(1);
    assert.equal(await generate(0).isEnabled(), false);
    assert.equal(await generate(1).isEnabled(), true);
    await generate(0).dispatchEvent("click");
    await generate(1).click();
    await count(2);
    assert.equal(await generate(2).isEnabled(), true);
    assert.equal(await card(2).getByRole("textbox").isEnabled(), true);
    await finish("asset-1");
    await page.waitForFunction(() => window.mvAssetFixture.draft().plan.assets[1].reference?.storageKey === "resource:generated-asset-1");
    assert.equal(await generate(0).isEnabled(), false, "a different asset completing must not unlock an active request");
    await finish("asset-0", "离线模拟：仅当前资产失败");
    await card(0).getByText("离线模拟：仅当前资产失败").waitFor();
    assert.equal(await card(1).getByRole("alert").count(), 0);
    assert.equal(await generate(0).isEnabled(), true);
    console.log("PASS independent simultaneous requests, duplicate prevention, isolated errors and retry");

    await page.evaluate(() => window.mvAssetFixture.patch({ characterFacePresets: { male: { resourceId: "face-fixture", assetIds: [] } } }));
    await generate(0).click();
    await card(0).getByText(/已上传主角人脸但未绑定角色/).waitFor();
    assert.equal(await page.evaluate(() => window.mvAssetService.requests.length), 2);
    await card(0).getByRole("combobox", { name: "MV 资产 1人脸参考" }).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^男主人脸 · 图片编辑$/ }).click();
    await card(0).getByText("已绑定男主人脸", { exact: false }).waitFor();

    const settings = page.locator("details").filter({ has: page.locator("summary", { hasText: /^资产图片生成设置$/ }) });
    await settings.getByRole("button", { name: "高", exact: true }).click();
    await settings.locator(".image-size-ratios").getByRole("button", { name: "3:2", exact: true }).click();
    await generate(0).click();
    await count(3);
    const submitted = await page.evaluate(() => window.mvAssetService.requests.at(-1).input);
    assert.deepEqual(submitted.referenceImages.map((image) => image.storageKey), ["resource:face-fixture"]);
    assert.equal(submitted.config.quality, "high");
    assert.notEqual(submitted.config.size, "1024x1024");
    assert.ok(submitted.metadata.promptTemplateVariables.角色设定.includes("面孔身份依据"));
    await finish("asset-0");
    await page.waitForFunction(() => Boolean(window.mvAssetFixture.draft().plan.assets[0].reference));
    await page.getByRole("group", { name: "MV 资产图片设置分类" }).getByRole("button", { name: /场\s*景/ }).click();
    await settings.locator(".image-size-ratios").getByRole("button", { name: "9:16", exact: true }).click();
    await generate(1).click();
    await count(4);
    const scene = await page.evaluate(() => window.mvAssetService.requests.at(-1).input);
    assert.deepEqual(scene.referenceImages, []);
    assert.notEqual(scene.config.size, submitted.config.size);
    await finish("asset-1");
    await page.evaluate(() => window.mvAssetFixture.flush());
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.mvAssetFixture.draft().assetImagePresets)));
    await page.reload();
    await card(7).waitFor();
    assert.deepEqual(await page.evaluate(() => window.mvAssetFixture.draft().assetImagePresets), saved);
    await card(0).getByText("已绑定男主人脸", { exact: false }).waitFor();
    console.log("PASS card face binding, final image-edit references, category dimensions/quality and reload persistence");

    await generate(2).click();
    await count(1);
    await page.evaluate(() => {
        const draft = window.mvAssetFixture.draft();
        window.mvAssetFixture.patch({ plan: { ...draft.plan, createdAt: "new-plan" } });
    });
    await finish("asset-2");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.mvAssetFixture.draft().plan.assets[2].reference), undefined);
    console.log("PASS old plan results cannot overwrite a new breakdown");

    await page.getByRole("button", { name: "继续补齐资产参考图" }).click();
    await count(4);
    await finish("asset-2", "批量中的独立失败");
    await count(5);
    await finish("asset-3");
    await count(6);
    await finish("asset-4");
    await count(7);
    await finish("asset-5");
    await finish("asset-6");
    await finish("asset-7");
    await card(7).getByLabel("已生成").waitFor();
    await card(2).getByText("批量中的独立失败").waitFor();
    assert.deepEqual(remoteRequests, [], "no model gateway may be contacted");
    assert.deepEqual(errors, [], "no browser runtime errors");
    await page.screenshot({ path: join(artifactDir, "mv-assets-desktop.png"), fullPage: true });
    console.log("PASS batch continues after one failure with at most three batch requests at a time");
    console.log(`Screenshots: ${artifactDir}`);
} catch (error) {
    await page.screenshot({ path: join(artifactDir, "failure.png"), fullPage: true });
    console.error(JSON.stringify({ errors, body: await page.locator("body").innerText(), artifactDir }));
    throw error;
} finally { await browser.close(); }
