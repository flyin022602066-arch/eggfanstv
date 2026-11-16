import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
const base = new URL(process.argv[2]), artifacts = process.argv[3];
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], calls = []; let enabled = false, rejectClear = false, cleaned = false, expanded = false;
    page.on('pageerror', error => errors.push(error.message));
    const status = () => ({ enabled, target: 300, reserve: 2, total: expanded ? 304 : 300, active: 298, used: cleaned ? 1 : 2, cold: enabled ? 296 : 298, attention: 0, warming: enabled, idle: enabled ? 2 : 0, busy: 1, pending: 1, succeeded: 23, failed: 75, cleaned: cleaned ? 298 : 0, cleaning: false, quotaResetConfirmed: false,
      profiles: Array.from({ length: expanded ? 304 : 300 }, (_, index) => { const id = '550e8400-e29b-41d4-a716-' + String(index).padStart(12, '0'); return { id, label: 'eggfansTV-' + id, state: index === 2 ? 'busy' : index === 3 ? 'pending' : index === 4 && !cleaned ? 'used' : enabled && index < 2 ? 'idle' : 'cold', quota: 'unknown' }; }) });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base.origin) { errors.push('external request blocked'); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const ok = data => route.fulfill({ json: { code: 0, data, msg: '' } });
      if (url.pathname === '/api/beefapi/connection') return ok({ state: 'disconnected', hasCredential: false });
      if (url.pathname === '/api/doubao-browser/status') return ok(status());
      if (url.pathname === '/api/doubao-browser/settings') { enabled = request.postDataJSON().enabled; calls.push('configure'); return ok(status()); }
      if (url.pathname === '/api/doubao-browser/open') { calls.push('open'); expanded = true; return ok({ opened: true }); }
      if (url.pathname === '/api/doubao-browser/clear') {
        calls.push('clear');
        if (rejectClear) return route.fulfill({ status: 400, json: { code: 400, data: null, msg: 'fixture 网站数据清理失败', reason: 'invalid_request' } });
        cleaned = true;
        return ok({ cleared: 97, skipped: 2, failed: ['fixture-99'], quotaResetConfirmed: false });
      }
      errors.push('unexpected API: ' + url.pathname); return route.abort();
    });
    const url = new URL(base); url.searchParams.set('mode', 'doubao-browser'); url.searchParams.set('theme', theme);
    await page.goto(url.href);
    await page.getByRole('button', { name: '账号管理', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'eggfansTV · 豆包浏览器账号池', exact: true });
    await dialog.getByText('环境储备 300（基础 300）', { exact: true }).waitFor();
    await dialog.getByText('待预热 298', { exact: true }).waitFor();
    await dialog.getByText('成功任务 23', { exact: true }).waitFor();
    await dialog.getByText('失败任务 75（不占用）', { exact: true }).waitFor();
    await dialog.getByText('成功待清理 1', { exact: true }).waitFor();
    await dialog.getByText('eggfansTV-550e8400-e29b-41d4-a716-000000000000', { exact: true }).waitFor();
    await dialog.getByRole('switch').click();
    await dialog.getByText('空闲 2（后台补充，不限提交）', { exact: true }).waitFor();
    await dialog.getByText('后台预热中 · 不阻塞提交', { exact: true }).waitFor();
    await dialog.getByText('待预热 296', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '打开环境', exact: true }).first().click();
    await page.waitForFunction(() => !document.querySelector('.ant-btn-loading'));
    await dialog.getByRole('button', { name: '一键清理缓存 / 网站数据', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '清理可释放环境的网站数据？', exact: true });
    for (const category of ['历史记录', '缓存文件', 'Cookie 与认证信息', '网站存储', '不保留登录状态', '不动本地视频和素材']) assert.ok((await confirmation.textContent()).includes(category), category);
    await page.getByRole('button', { name: '确认清理', exact: true }).click();
    await dialog.getByText('网站数据已清理 97 个并恢复可调度，跳过占用 / 待取回 2 个，清理失败 1 个。', { exact: false }).waitFor();
    await dialog.getByText('成功待清理 0', { exact: true }).waitFor();
    await dialog.getByText('环境储备 304（基础 300）', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('cell', { name: '成功待清理', exact: true }).count(), 0);
    await dialog.getByRole('cell', { name: '任务占用', exact: true }).waitFor();
    await dialog.getByRole('cell', { name: '成功待取回', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.ant-btn-loading'));
    rejectClear = true;
    await dialog.getByRole('button', { name: /刷.*新/ }).click();
    await page.waitForFunction(() => !document.querySelector('.ant-btn-loading'));
    await page.getByRole('button', { name: '确认清理', exact: true }).waitFor({ state: 'hidden' });
    await dialog.getByRole('button', { name: '一键清理缓存 / 网站数据', exact: true }).click();
    await page.getByRole('button', { name: '确认清理', exact: true }).click();
    await dialog.getByText('fixture 网站数据清理失败', { exact: true }).waitFor();
    assert.deepEqual(calls, ['configure', 'open', 'clear', 'clear']);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'long unique names overflow the viewport');
    await page.screenshot({ path: join(artifacts, 'doubao-browser-' + width + '-' + theme + '.png'), fullPage: true });
    await page.close();
  }
  console.log('Doubao browser manager passed in light/dark at desktop/mobile widths; all APIs mocked.');
} finally { await browser.close(); }
