import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=", "base64");
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const key = (scope = "mv-layout-offline-test") => `infinite-canvas:suno-mv-split-ratio:user:${scope}`;
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const widths = (page) => page.evaluate(() => {
    const controls = document.querySelector(".suno-studio-mv-controls");
    const output = document.querySelector(".suno-studio-mv-output");
    const rect = controls.getBoundingClientRect();
    return { controls: rect.width, output: output.getBoundingClientRect().width, available: document.querySelector(".suno-studio-mv-layout").clientWidth - 10, overflow: controls.scrollWidth - controls.clientWidth };
});
const drag = async (page, delta) => {
    const box = await page.getByRole("separator").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + 80, { steps: 12 });
    await page.mouse.up();
    await frame(page);
};

try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    let resourceUploads = 0;
    const routeFixture = (route) => {
        const request = new URL(route.request().url());
        if (request.origin !== new URL(url).origin) { requests.push(request.href); return route.abort(); }
        if (request.pathname === "/api/resources" && route.request().method() === "POST") {
            resourceUploads += 1;
            return route.fulfill({ json: { code: 0, data: { resource: { id: `face-fixture-${resourceUploads}`, kind: "image", status: "ready", mimeType: "image/png", size: imageBytes.length, width: 1, height: 1 } }, msg: "" } });
        }
        if (/^\/api\/resources\/face-fixture-\d+\/file$/.test(request.pathname)) return route.fulfill({ contentType: "image/png", body: imageBytes });
        if (request.pathname.startsWith("/api/")) { requests.push(request.pathname); return route.abort(); }
        return route.continue();
    };
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", (route) => {
        const request = new URL(route.request().url());
        if (request.origin !== new URL(url).origin || request.pathname.startsWith("/api/")) { requests.push(request.pathname); return route.abort(); }
        return route.continue();
    });
    await page.goto(url);
    await page.getByRole("separator").waitFor();
    assert.equal(await page.title(), "Eggfans TV MV layout test");
    assert.ok((await page.locator("body").innerText()).includes("统一视觉与资产"));
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    await frame(page);
    const original = await widths(page);
    await drag(page, -200);
    const narrow = await widths(page);
    await drag(page, 400);
    const wide = await widths(page);
    assert.ok(narrow.controls < original.controls - 190 && wide.controls > original.controls + 190, "drag must resize both panes");
    assert.ok(wide.output < narrow.output - 390);
    for (const selector of [".suno-studio-mv-assets", ".suno-studio-mv-segments"]) {
        const boxes = await page.locator(selector + " > article").evaluateAll((cards) => cards.map((card) => { const { x, y, width, height } = card.getBoundingClientRect(); return { x, y, width, height }; }));
        assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1, selector + " must reflow into multiple columns");
        assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x && Math.abs(boxes[0].height - boxes[1].height) < 1, "cards must align without overlaps");
    }
    assert.ok(wide.overflow <= 1);
    const saved = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key());
    await page.reload();
    await page.getByRole("separator").waitFor();
    await frame(page);
    assert.ok(Math.abs((await widths(page)).controls - wide.controls) < 2, "split width must survive reload");
    await page.evaluate(() => window.mvFixture.setScope("other-user"));
    await frame(page);
    assert.ok(Math.abs((await widths(page)).controls / wide.available - 0.56) < 0.01, "scope must not inherit another user's width");
    await page.evaluate(() => window.mvFixture.setScope("mv-layout-offline-test"));
    await frame(page);
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key()), saved);
    const divider = page.getByRole("separator");
    await divider.focus();
    await page.keyboard.press("Home");
    assert.ok(Math.abs((await widths(page)).controls - 360) < 1);
    await page.keyboard.press("End");
    assert.ok(Math.abs((await widths(page)).output - 320) < 1);
    await page.keyboard.press("Shift+ArrowLeft");
    assert.ok(Math.abs((await widths(page)).output - 384) < 1);
    await divider.dblclick();
    assert.ok(Math.abs((await widths(page)).controls / wide.available - 0.56) < 0.01);
    const beforeCancel = await widths(page);
    let box = await divider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 80);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.ok(Math.abs((await widths(page)).controls - beforeCancel.controls) < 1, "Escape must cancel drag");
    await page.evaluate(() => {
        const layout = document.querySelector(".suno-studio-mv-layout");
        const originalMeasure = layout.getBoundingClientRect.bind(layout);
        const originalSetItem = Storage.prototype.setItem;
        window.mvMetrics = { paints: 0, reads: 0, writes: 0, renders: window.mvFixture.renders() };
        layout.getBoundingClientRect = () => { window.mvMetrics.reads += 1; return originalMeasure(); };
        Storage.prototype.setItem = function (...args) { window.mvMetrics.writes += 1; return originalSetItem.apply(this, args); };
        new MutationObserver((records) => { window.mvMetrics.paints += records.filter((record) => record.attributeName === "style").length; }).observe(layout, { attributes: true });
    });
    box = await divider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 80);
    await page.mouse.down();
    const metrics = await page.evaluate(async ({ startX, pointerY }) => {
        const separator = document.querySelector('[role="separator"]');
        const readsAtStart = window.mvMetrics.reads;
        for (let index = 0; index < 240; index += 1) separator.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, isPrimary: true, clientX: startX + index, clientY: pointerY, buttons: 1 }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { ...window.mvMetrics, movementReads: window.mvMetrics.reads - readsAtStart, currentRenders: window.mvFixture.renders() };
    }, { startX: box.x + 5, pointerY: box.y + 80 });
    assert.equal(metrics.movementReads, 0, "pointer moves must not force layout reads");
    assert.equal(metrics.writes, 0, "drag must not write storage until release");
    assert.equal(metrics.currentRenders, metrics.renders, "drag must not rerender card panels");
    assert.ok(metrics.paints <= 1, "240 move events must coalesce into one CSS update");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.mvMetrics.writes), 1);
    console.log(`PASS drag/reflow/persistence/scopes/keyboard/reset/cancel: ${JSON.stringify(metrics)}`);
    await divider.focus();
    await page.keyboard.press("Home");
    assert.ok((await widths(page)).overflow <= 1);
    await drag(page, -1000);
    assert.ok((await widths(page)).controls >= 359);
    await drag(page, 2000);
    assert.ok((await widths(page)).output >= 319);
    await divider.dblclick();
    box = await divider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 80);
    await divider.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await page.locator("[data-resizing]").count(), 0);
    box = await divider.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 80);
    await page.mouse.down();
    await page.evaluate(() => window.mvFixture.setMounted(false));
    await frame(page);
    await page.mouse.up();
    await page.evaluate(() => window.mvFixture.setMounted(true));
    await divider.waitFor();
    await context.close();

    for (const theme of ["dark", "light"]) {
        for (const width of [1600, 1024, 768, 390]) {
            const visualContext = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
            const visual = await visualContext.newPage();
            visual.on("pageerror", (error) => errors.push(error.message));
            await visual.route("**/*", routeFixture);
            await visual.goto(url + `?real=1&theme=${theme}`);
            try { await visual.locator(".suno-studio-mv-asset").nth(7).waitFor({ timeout: 10000 }); }
            catch (error) { await visual.screenshot({ path: join(artifactDir, "failure.png") }); console.error(JSON.stringify({ errors, body: await visual.locator("body").innerText(), artifactDir })); throw error; }
            await frame(visual);
            const mobile = width < 1024;
            assert.equal(await visual.getByRole("separator").isVisible(), !mobile);
            if (!mobile) await drag(visual, 180);
            const geometry = await visual.evaluate(() => {
                const root = document.querySelector(".suno-studio-mv-layout");
                const controls = document.querySelector(".suno-studio-mv-controls");
                const output = document.querySelector(".suno-studio-mv-output");
                const cards = [...document.querySelectorAll(".suno-studio-mv-asset")].map((card) => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y }));
                return { width: root.clientWidth, scrollWidth: root.scrollWidth, height: root.clientHeight, scrollHeight: root.scrollHeight, outputTop: output.getBoundingClientRect().top, controlsBottom: controls.getBoundingClientRect().bottom, cards };
            });
            assert.ok(geometry.scrollWidth <= geometry.width + 1, `${theme}/${width}: horizontal overflow`);
            if (width === 1600 && theme === "dark") {
                await visual.evaluate(() => {
                    window.mvFrames = [];
                    window.mvSampling = true;
                    let previous = performance.now();
                    const sample = (now) => { window.mvFrames.push(now - previous); previous = now; if (window.mvSampling) requestAnimationFrame(sample); };
                    requestAnimationFrame(sample);
                });
                const handle = await visual.getByRole("separator").boundingBox();
                await visual.mouse.move(handle.x + 5, handle.y + 80);
                await visual.mouse.down();
                await visual.mouse.move(handle.x - 360, handle.y + 80, { steps: 60 });
                await visual.mouse.move(handle.x + 5, handle.y + 80, { steps: 60 });
                await visual.mouse.up();
                const samples = await visual.evaluate(() => { window.mvSampling = false; return window.mvFrames; });
                const ordered = samples.slice(2).sort((first, second) => first - second);
                const p95 = ordered[Math.floor(ordered.length * 0.95)];
                assert.ok(ordered.length > 30 && p95 < 50, `real MV resize frame interval p95 too high: ${p95}ms`);
                console.log(`PASS real MV continuous drag: ${ordered.length} frames, p95=${p95.toFixed(1)}ms`);
            }
            if (mobile) {
                assert.ok(geometry.outputTop >= geometry.controlsBottom - 1, "stacked panes must not overlap");
                assert.ok(geometry.scrollHeight > geometry.height, "stacked content must scroll");
                await visual.locator(".suno-studio-mv-output").scrollIntoViewIfNeeded();
                await visual.getByRole("heading", { name: "MV 预览与任务" }).waitFor({ state: "visible" });
                await visual.locator(".suno-studio-mv-layout").evaluate((element) => { element.scrollTop = 0; });
            } else if (width >= 1600) assert.ok(Math.abs(geometry.cards[0].y - geometry.cards[1].y) < 1);
            await visual.screenshot({ path: join(artifactDir, `${theme}-${width}.png`) });
            if ((width === 1600 && theme === "dark") || (width === 390 && theme === "light")) {
                const watermark = visual.getByRole("switch", { name: "MV 添加水印" });
                await watermark.click();
                assert.equal(await watermark.getAttribute("aria-checked"), "true", "watermark choice must update the actual generation config");
                const faceMask = visual.getByRole("switch", { name: "自动人脸遮罩" });
                await faceMask.click();
                assert.equal(await faceMask.getAttribute("aria-checked"), "true");
                await visual.getByRole("group", { name: "网格密度" }).waitFor();
                await visual.getByRole("button", { name: "设置男女主角" }).click();
                const dialog = visual.getByRole("dialog", { name: "MV 主角人脸预设" });
                await dialog.waitFor();
                for (const role of ["男主", "女主"]) {
                    assert.equal(await dialog.getByRole("combobox", { name: `${role}绑定角色` }).isEnabled(), false);
                    await dialog.getByLabel(`上传${role}人脸参考图`, { exact: true }).setInputFiles({ name: `${role}.png`, mimeType: "image/png", buffer: imageBytes });
                    await dialog.getByAltText(`${role}人脸参考图`).waitFor();
                }
                const male = dialog.getByRole("combobox", { name: "男主绑定角色" });
                await male.click();
                const malePopup = visual.locator(".ant-select-dropdown").filter({ has: visual.locator(`[id="${await male.getAttribute("aria-controls")}"]`) });
                await malePopup.locator(".ant-select-item-option").filter({ hasText: /^MV 资产 1$/ }).click();
                await male.press("Escape");
                await malePopup.waitFor({ state: "hidden" });
                const female = dialog.getByRole("combobox", { name: "女主绑定角色" });
                await female.click();
                const femalePopup = visual.locator(".ant-select-dropdown").filter({ has: visual.locator(`[id="${await female.getAttribute("aria-controls")}"]`) });
                assert.equal(await femalePopup.locator(".ant-select-item-option").filter({ hasText: /^MV 资产 1$/ }).getAttribute("aria-disabled"), "true", "one character cannot inherit both faces");
                await femalePopup.locator(".ant-select-item-option").filter({ hasText: /^MV 资产 3$/ }).click();
                await female.press("Escape");
                await femalePopup.waitFor({ state: "hidden" });
                await visual.screenshot({ path: join(artifactDir, `${theme}-${width}-faces.png`) });
                const bounds = await dialog.boundingBox();
                assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "face preset dialog must fit the viewport");
                await dialog.getByRole("button", { name: /^完\s*成$/ }).click();
                await visual.locator(".suno-studio-mv-asset").nth(0).getByText("已绑定男主人脸", { exact: false }).waitFor();
                await visual.locator(".suno-studio-mv-asset").nth(2).getByText("已绑定女主人脸", { exact: false }).waitFor();
                await visual.reload();
                await visual.getByRole("button", { name: "设置男女主角" }).click();
                await dialog.getByText("MV 资产 1", { exact: true }).waitFor();
                await dialog.getByText("MV 资产 3", { exact: true }).waitFor();
                await dialog.getByRole("button", { name: /^完\s*成$/ }).click();
                console.log(`PASS MV ${theme}/${width}: face upload/binding/isolation/reload, watermark and channel face parameters`);
            }
            if (width === 1600) {
                await visual.locator(".fixture-shell").evaluate((element) => element.style.setProperty("--fixture-width", "650px"));
                await frame(visual);
                assert.equal(await visual.getByRole("separator").isVisible(), false, "narrow embedded panel must stack independently of viewport");
            }
            console.log(`PASS real MV ${theme}/${width}: cards, scrolling, container sizing`);
            await visualContext.close();
        }
    }
    assert.deepEqual(requests, [], "layout testing must not contact model APIs");
    assert.deepEqual(errors, [], "no browser runtime errors");
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
