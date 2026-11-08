import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ['dark', 'light']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = []; let writes = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            if (!route.request().url().startsWith(url) && !route.request().url().startsWith('data:')) return route.abort();
            if (route.request().method() !== 'GET') { writes++; return route.abort(); }
            return route.continue();
        });
        await page.goto(url + '?theme=' + theme);
        const toolbar = page.getByRole('toolbar', { name: '节点快捷工具' });
        await toolbar.waitFor({ timeout: 5000 }).catch(async error => { throw new Error(JSON.stringify({ errors, body: await page.locator('body').innerText(), toolbars: await page.locator('.canvas-node-toolbar').count() }) + error.message); });
        await toolbar.getByRole('button', { name: '图片信息', exact: true }).click();
        assert.equal(await page.getByLabel('最近操作').textContent(), 'onInfo:image-a');
        await toolbar.getByRole('button', { name: '图片工具', exact: true }).click();
        await page.getByRole('menuitem').filter({ hasText: '裁切' }).first().click();
        assert.equal(await page.getByLabel('最近操作').textContent(), 'onCrop:image-a');
        await page.getByRole('button', { name: '切换图片', exact: true }).click();
        await toolbar.getByRole('button', { name: '图片信息', exact: true }).click();
        assert.equal(await page.getByLabel('最近操作').textContent(), 'onInfo:image-b');
        await page.getByRole('button', { name: '切换 Agent', exact: true }).click();
        await toolbar.getByRole('button', { name: '图片信息', exact: true }).click();
        await page.getByRole('button', { name: /^高级设置：/ }).click();
        await page.locator('.canvas-image-settings-popover').waitFor();
        assert.equal(await page.getByLabel('设置状态').textContent(), 'open');
        await page.getByRole('button', { name: '切换设置挂载', exact: true }).evaluate(button => button.click());
        await page.waitForFunction(() => document.querySelector('[aria-label="设置状态"]')?.textContent === 'closed', null, { timeout: 2000 });
        await toolbar.waitFor();
        await page.getByRole('button', { name: '切换设置挂载', exact: true }).click();
        await page.getByRole('button', { name: /^高级设置：/ }).click();
        await page.getByRole('button', { name: '切换图片', exact: true }).evaluate(button => button.click());
        await toolbar.waitFor();
        assert.equal(await page.getByLabel('设置状态').textContent(), 'closed');
        await page.setViewportSize({ width: 1000, height: 850 });
        await toolbar.getByRole('button', { name: '图片信息', exact: true }).click();
        const bounds = await toolbar.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1000, 'Toolbar must stay inside viewport');
        const evidence = 'S:/project/eggfans beeftv/.local/cache/canvas-image-toolbar-qa';
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: evidence + '/' + theme + '.png' });
        assert.deepEqual(errors, []); assert.equal(writes, 0);
        await page.close();
    }
    process.stdout.write('Image toolbar lifecycle passed in dark and light themes; zero generation or upload requests.\n');
} finally { await browser.close(); }
