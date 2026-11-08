import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
const overlaps = (first, second) => Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1;
try {
    for (const theme of ["dark", "light"]) {
        for (const width of [1920, 1440, 1280, 768, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
            await page.goto(url + "?theme=" + theme);
            try {
                await page.locator(".asset-library-card").nth(17).waitFor({ timeout: 15000 });
            } catch (error) {
                await page.screenshot({ path: join(artifactDir, "failure.png") });
                console.error(JSON.stringify({ errors, body: await page.locator("body").innerText(), artifactDir }));
                throw error;
            }
            const assertLayout = async (mode) => {
                await page.locator(".assets-library-page").evaluate((element) => { element.scrollTop = 0; });
                const geometry = await page.evaluate(() => {
                    const box = (element) => { const { left, top, right, bottom, width, height } = element.getBoundingClientRect(); return { left, top, right, bottom, width, height }; };
                    const root = document.querySelector(".assets-library-page");
                    const header = root.querySelector(".app-page-header");
                    const controls = root.querySelector(".assets-secondary-controls");
                    const cards = [...root.querySelectorAll(".asset-library-card")];
                    const actionControls = [...root.querySelectorAll(".assets-header-actions button, .assets-header-actions input, .assets-kind-actions .assets-view-toggle, .assets-kind-actions .assets-sort-control")].filter((element) => element.getClientRects().length);
                    return { header: box(header), controls: box(controls), grid: box(root.querySelector(".assets-library-grid")), cards: cards.map(box), media: box(cards[0].querySelector(".library-card-media")), title: box(cards[0].querySelector("h2")), cardDisplay: getComputedStyle(cards[0]).display, actionControls: actionControls.map(box), rootWidth: root.clientWidth, rootScroll: root.scrollWidth };
                });
                assert.ok(geometry.header.bottom <= geometry.controls.top + 1, `${theme}/${width}/${mode}: header overlaps filters`);
                assert.ok(geometry.rootScroll <= geometry.rootWidth + 1, `${theme}/${width}/${mode}: horizontal overflow`);
                for (const [index, first] of geometry.actionControls.entries()) for (const second of geometry.actionControls.slice(index + 1)) assert.ok(!overlaps(first, second), `${theme}/${width}/${mode}: toolbar controls overlap`);
                if (mode === "list") {
                    assert.equal(geometry.cardDisplay, "grid");
                    assert.ok(geometry.cards.every((card) => card.height <= 118), `${theme}/${width}: list row too tall ${JSON.stringify(geometry.cards)}`);
                    assert.ok(geometry.title.left >= geometry.media.right && geometry.title.left - geometry.media.right <= 20, `${theme}/${width}: title detached from thumbnail`);
                    if (width >= 1440) {
                        assert.ok(geometry.cards.every((card) => card.width < 600), `${theme}/${width}: list wastes a full-width row`);
                        assert.ok(Math.abs(geometry.cards[0].top - geometry.cards[1].top) < 1, `${theme}/${width}: compact list did not use multiple columns`);
                    } else if (width <= 768) {
                        assert.ok(geometry.cards[1].top >= geometry.cards[0].bottom, `${theme}/${width}: narrow list needs a single column`);
                    }
                } else if (width >= 1280) {
                    assert.ok(geometry.cards[0].width < 320, `${theme}/${width}: grid cards too wide`);
                    assert.ok(Math.abs(geometry.cards[0].top - geometry.cards[1].top) < 1, `${theme}/${width}: grid collapsed to long rows`);
                }
            };
            await assertLayout("grid");
            await page.getByRole("button", { name: "搜索资产", exact: true }).click();
            await page.getByRole("textbox", { name: "搜索资产", exact: true }).waitFor();
            await assertLayout("grid");
            await page.getByRole("button", { name: "筛选资产", exact: true }).click();
            await page.locator(".assets-collection-layout.is-filters-open").waitFor();
            await assertLayout("grid");
            await page.getByRole("button", { name: "筛选资产", exact: true }).click();
            await page.locator(".assets-collection-layout:not(.is-filters-open)").waitFor();
            await page.getByRole("button", { name: "列表视图", exact: true }).click();
            await page.locator(".assets-library-grid.is-list-view").waitFor();
            await assertLayout("list");
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-list.png`) });
            await page.reload();
            await page.locator(".assets-library-grid.is-list-view").waitFor();
            await assertLayout("list");
            await page.getByRole("button", { name: "网格视图", exact: true }).click();
            await page.locator(".assets-library-grid:not(.is-list-view)").waitFor();
            await assertLayout("grid");
            await page.screenshot({ path: join(artifactDir, `${theme}-${width}-grid.png`) });
            await page.getByRole("button", { name: "更多资产操作", exact: true }).click();
            await page.getByRole("menuitem", { name: "导出当前筛选资产", exact: true }).waitFor();
            await page.keyboard.press("Escape");
            assert.deepEqual(errors, [], `${theme}/${width}: browser errors`);
            console.log(`PASS ${theme} ${width}px grid/list/search/filter/menu/persistence`);
            await context.close();
        }
    }
    console.log(`Screenshots: ${artifactDir}`);
} finally { await browser.close(); }
