import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const theme = process.argv[2] === 'dark' ? 'dark' : 'light';
const outputDir = resolve(webDir, '../.local/cache/canvas-video-failure-retry', theme);
mkdirSync(outputDir, { recursive: true });
const server = await createServer({ configFile: resolve(webDir, 'vite.config.ts'), appType: 'custom', root: webDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
server.middlewares.use('/video-retry-test', async (_request, response) => {
  const html = await server.transformIndexHtml('/video-retry-test', '<!doctype html><html class="' + theme + '"><head><title>Offline video retry</title></head><body style="margin:0"><div id="root"></div><script type="module">import "/src/styles/globals.css";import {mountVideoEditHarness} from "/test/fixtures/canvas-video-edit-harness.tsx";mountVideoEditHarness(document.getElementById("root"));</script></body></html>');
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
let browser;
let page;
const errors = [];
const submissions = [];
const tasks = new Map();
let releaseFirst;
const firstResponseGate = new Promise(resolveGate => { releaseFirst = resolveGate; });
let markFirstSubmitted;
const firstSubmitted = new Promise(resolveSubmitted => { markFirstSubmitted = resolveSubmitted; });
try {
  await server.listen();
  const baseURL = 'http://127.0.0.1:' + server.httpServer.address().port;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 1320, height: 880 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem('video-edit-fixture')) return;
    localStorage.setItem('video-edit-fixture', JSON.stringify([{ id: 'generated-video', type: 'video', title: 'Failed video', position: { x: 70, y: 70 }, width: 480, height: 270, metadata: { nodeRole: 'result', resultOrigin: 'generated', status: 'error', taskId: 'original-failed', taskStatus: 'failed', taskStage: '任务失败', errorDetails: '豆包浏览器：上游画布任务生成失败（业务码 2）', prompt: '雨夜街道，镜头缓慢推进', composerContent: '雨夜街道，镜头缓慢推进', model: 'jiasu-video::dola-sd-2.5', seconds: '15', size: '9:16', vquality: '720p' } }]));
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname === '/fixture.mp4') return route.fulfill({ contentType: 'video/mp4', body: Buffer.from([]) });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/tasks' && request.method() === 'POST') {
      const input = request.postDataJSON();
      submissions.push(input);
      if (submissions.length === 1) {
        markFirstSubmitted();
        await firstResponseGate;
      }
      const now = new Date().toISOString();
      const task = { id: 'retry-task-' + submissions.length, status: submissions.length === 1 ? 'failed' : 'succeeded', type: 'canvas_video', prompt: input.prompt, model: input.model, attempts: 1, createdAt: now, updatedAt: now, ...(submissions.length === 1 ? { errorCode: 'moderation_input', error: '审核不通过,请修改后重试' } : { resultJson: JSON.stringify({ mode: 'video', video: { url: '/fixture.mp4', dataUrl: '/fixture.mp4' } }) }) };
      tasks.set(task.id, task);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: task, msg: 'ok' }) });
    }
    const task = tasks.get(url.pathname.replace('/api/tasks/', ''));
    if (task && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: task, msg: 'ok' }) });
    errors.push(request.method() + ' ' + url.pathname);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 500, msg: 'Unexpected mock request' }) });
  });
  await page.goto(baseURL + '/video-retry-test?channel=doubao-browser');
  await page.waitForFunction(() => window.videoEditHarness);
  await page.locator('[data-node-id="generated-video"]').click({ position: { x: 25, y: 30 } });
  const editor = page.getByRole('textbox', { name: '视频提示词', exact: true });
  await editor.waitFor();
  await page.getByRole('button', { name: '生成', exact: true }).click();
  const confirmation = page.getByRole('button', { name: '仍然生成', exact: true });
  await confirmation.waitFor();
  assert.equal(submissions.length, 0);
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await confirmation.click();
  await firstSubmitted;
  assert.equal(await page.getByRole('button', { name: '生成中', exact: true }).isDisabled(), true);
  assert.equal(submissions.length, 1);
  releaseFirst();
  await page.waitForFunction(() => window.videoEditHarness.nodes()[0].metadata.taskId === 'retry-task-1' && window.videoEditHarness.nodes()[0].metadata.status === 'error');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await confirmation.waitFor();
  assert.equal(submissions.length, 1);
  await confirmation.click();
  await page.waitForFunction(() => window.videoEditHarness.nodes()[0].metadata.taskId === 'retry-task-2' && window.videoEditHarness.nodes()[0].metadata.status === 'success');
  assert.equal(submissions.length, 2);
  assert.deepEqual(errors, []);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.screenshot({ path: resolve(outputDir, 'retry-success.png') });
  console.log('PASS ' + theme + ': terminal video failure, explicit confirmation, cancellation, active-submit lock and retry success; no real generation');
} catch (error) {
  console.error(JSON.stringify({ errors, submissions: submissions.length, snapshot: await page?.locator('body').ariaSnapshot() }));
  await page?.screenshot({ path: resolve(outputDir, 'failure.png') });
  throw error;
} finally {
  releaseFirst();
  await browser?.close();
  await server.close();
}
