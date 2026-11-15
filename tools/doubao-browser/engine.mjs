import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, lstat, realpath } from 'node:fs/promises';
import { randomUUID, randomInt } from 'node:crypto';
import path from 'node:path';
const HOME = 'https://www.doubao.com/chat/';
const BASE = '/creativity/canvas_workspace/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function browserArgs(directory, visible) {
  return ['--user-data-dir=' + directory, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', ...(visible ? ['--new-window'] : ['--headless=new']), 'about:blank'];
}
function executable() {
  const choices = [process.env.EGGFANSTV_CHROMIUM, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const result = choices.find(value => value && existsSync(value));
  if (!result) throw Error('未找到 Chrome/Edge，请安装浏览器或配置 EGGFANSTV_CHROMIUM');
  return result;
}
class Pipe {
  constructor(child) {
    this.child = child; this.next = 1; this.pending = new Map(); this.buffer = Buffer.alloc(0);
    child.stdio[4].on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 300 * 1024 * 1024) return this.fail();
      let end;
      while ((end = this.buffer.indexOf(0)) >= 0) {
        const line = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        const waiting = this.pending.get(value.id); if (!waiting) continue;
        this.pending.delete(value.id); clearTimeout(waiting.timer);
        if (value.error) waiting.reject(Error('浏览器操作失败：' + String(value.error.code))); else waiting.resolve(value.result);
      }
    });
    child.on('exit', () => this.fail()); child.on('error', () => this.fail());
    child.stdio[3].on('error', () => this.fail());
  }
  fail() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('浏览器连接已断开')); } this.pending.clear(); }
  call(method, params = {}, sessionId, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.next++, timer = setTimeout(() => { this.pending.delete(id); reject(Error('浏览器操作超时')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(Error('浏览器写入失败')); } });
    });
  }
}

// Executed in the originating account page. Only fixed same-origin API paths.
export async function pageRequest(input) {
  if (location.origin !== 'https://www.doubao.com') throw Error('账号页面来源不匹配');
  const allow = ['/creativity/canvas_workspace/doc/create', '/creativity/canvas_workspace/doc/get', '/creativity/canvas_workspace/doc/actions', '/creativity/canvas_workspace/tool/exec', '/alice/resource/register'];
  if (!allow.includes(input.api)) throw Error('接口路径无效');
  const tab = input.requestContext?.webTabId || crypto.randomUUID();
  const contexts = window.__eggfansCanvasContexts ||= Object.create(null);
  const cached = contexts[tab];
  const params = new URLSearchParams(cached || input.requestContext?.params || '');
  const keys = ['aid', 'real_aid', 'device_id', 'device_platform', 'doubao_device_platform', 'doubao_pc_version', 'language', 'pc_version', 'pkg_type', 'region', 'sys_region', 'samantha_web', 'tea_uuid', 'tz_name', 'use-olympus-account', 'version_code', 'web_id', 'web_platform'];
  if (!params.get('aid') || !params.get('device_id')) for (const entry of performance.getEntriesByType('resource')) {
    let url; try { url = new URL(entry.name); } catch { continue; }
    if (url.origin !== location.origin || !/^\/(samantha|alice|chat|im|creativity)\//.test(url.pathname)) continue;
    for (const key of keys) if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key));
  }
  if (!params.get('aid') || !params.get('device_id')) throw Error('网页请求参数尚未就绪');
  for (const key of [...params.keys()]) if (!keys.includes(key) && key !== 'web_tab_id') params.delete(key);
  params.set('web_tab_id', tab);
  contexts[tab] = params.toString();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'agw-js-conv': 'str' };
  const csrf = document.cookie.match(/(?:^|;\s*)passport_csrf_token=([^;]+)/);
  if (csrf) headers['x-tt-passport-csrf-token'] = csrf[1];
  const response = await fetch(input.api + '?' + params, { method: 'POST', credentials: 'include', redirect: 'error', headers, body: JSON.stringify(input.body), signal: AbortSignal.timeout(30000) });
  const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw Error('网页响应过大');
  let packet; try { packet = JSON.parse(text); } catch { throw Error('上游响应格式无效'); }
  if (!response.ok || Number(packet.code) !== 0 || !packet.data) {
    const code = String(packet.code ?? response.status).slice(0, 40);
    const quotaText = [code, packet.message, packet.msg].filter(value => typeof value === 'string').join(' ').slice(0, 8192);
    const quotaRejected = /(?:额度|积分|次数|余额).{0,8}(?:不足|耗尽|用完)|(?:insufficient|exhausted)[ _-]*(?:credits?|quota)|quota[ _-]*(?:empty|exceeded|exhausted)/i.test(quotaText);
    return { rejected: true, code, ...(quotaRejected ? { quotaRejected: true } : {}) };
  }
  return { data: packet.data, requestContext: { webTabId: tab, params: params.toString() } };
}
export async function uploadImage(input) {
  if (location.origin !== 'https://www.doubao.com' || !/^\/chat\/?$/.test(location.pathname)) throw Error('参考图页面来源不匹配');
  let runtime;
  for (let attempt = 0; attempt < 60 && !runtime?.m; attempt++) {
    for (const chunks of [window.rspackChunkapp_flow_chat, window.__LOADABLE_LOADED_CHUNKS__]) {
      if (Array.isArray(chunks)) chunks.push([['eggfans-upload-' + crypto.randomUUID()], {}, value => { runtime = value; }]);
      if (runtime?.m) break;
    }
    if (!runtime?.m) await new Promise(resolve => setTimeout(resolve, 250));
  }
  const matches = Object.keys(runtime?.m || {}).filter(key => ['serviceContainer', 'resourceStore', 'chat-ioc-manager: cannot bind empty service'].every(marker => String(runtime.m[key]).includes(marker)));
  if (matches.length !== 1) throw Error('当前网页上传服务未能唯一定位');
  const service = await runtime(matches[0]).a('attachmentUploadStoreService');
  const uploader = await service.getUploader('image');
  const [header, base64] = input.split(','), mime = header.slice(5, header.indexOf(';'));
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const file = new File([bytes], 'reference.' + mime.split('/')[1], { type: mime });
  const bitmap = await createImageBitmap(file), width = bitmap.width, height = bitmap.height; bitmap.close();
  return new Promise((resolve, reject) => {
    let key;
    const timer = setTimeout(() => { try { uploader.getInstance().cancel(key); } catch {} reject(Error('参考图上传超时')); }, 120000);
    Promise.resolve(uploader.upload(file, {
      complete: event => { clearTimeout(timer); const value = event?.uploadResult; if (typeof value?.ImageUri !== 'string' || value.ImageWidth !== width || value.ImageHeight !== height) return reject(Error('参考图上传回执不匹配')); resolve({ uri: value.ImageUri, width, height, format: mime.split('/')[1] }); },
      error: () => { clearTimeout(timer); reject(Error('参考图上传失败')); },
    })).then(value => { key = value; }, () => { clearTimeout(timer); reject(Error('参考图上传失败')); });
  });
}
// Native canvas supports an anonymous browser session. Account login is informational.
export function pageState() {
  const account = window._ROUTER_DATA?.loaderData?.chat_layout?.chat_layout?.accountInfo?.data;
  const rawID = account?.user_id_str || account?.user_id;
  const hasUser = /^[1-9]\d{0,127}$/.test(String(rawID || ''));
  const hasError = account?.error_code != null && Number(account.error_code) !== 0;
  const visitor = account?.is_visitor_account === true || account?.is_visitor_account === 1 || account?.is_visitor_account === 'true';
  let params = false;
  for (const entry of performance.getEntriesByType('resource')) {
    try { const url = new URL(entry.name); if (url.origin === location.origin && /^\/(samantha|alice|chat|im|creativity)\//.test(url.pathname) && url.searchParams.get('aid') && url.searchParams.get('device_id')) params = true; } catch {}
  }
  const authenticated = hasUser && !hasError;
  return { ready: location.origin === 'https://www.doubao.com' && /^\/chat\/?$/.test(location.pathname) && params, visitor: visitor || !authenticated, authenticated };
}
export function operation(input, images) {
  const prompt = input.prompt.replace(/\{\{ref\s+(\d+)\}\}/g, (_, number) => '{{ref:' + Number(number) + '}}');
  for (const match of prompt.matchAll(/\{\{ref:(\d+)\}\}/g)) if (Number(match[1]) < 1 || Number(match[1]) > images.length) throw Error('提示词引用没有对应参考图');
  const value = { canvas_type: 50, generate_type: 1, prompt, use_model: input.model, video_param: { duration: input.duration, ratio: input.ratio } };
  if (images.length) value.attachments = images.map((image, index) => {
    if (!/^tos-[\w-]+\/[\w./-]{1,1900}$/.test(image.uri || '') || image.uri.includes('..') || !Number.isSafeInteger(image.width) || image.width <= 0 || !Number.isSafeInteger(image.height) || image.height <= 0) throw Error('参考图资源回执无效');
    const placeholder = '{{ref:' + (index + 1) + '}}';
    return { attachment_type: 1, image: { uri: image.uri, width: image.width, height: image.height }, ...(prompt.includes(placeholder) ? { prompt_placeholder: placeholder } : {}) };
  });
  return value;
}
export function canvasNodeID(session) {
  if (!/^[A-Za-z0-9]{10}$/.test(session || '')) throw Error('画布节点会话格式改变');
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('') + '-' + session + '-0202';
}
export function executionBody(checkpoint, node, item, input, images, version) {
  return { req: { canvas_workspace_id: checkpoint.workspaceId, biding_item: { ...node, ...item, transform: { ...node.transform, ...item.transform }, asset: item.asset || node.asset, ext: item.ext || {} }, execute_request: { request_id: checkpoint.requestId, operation: operation(input, images), canvas_context: { conversation_id: checkpoint.conversationId, trigger_scene: 'infinite_canvas_video_generator' } }, callback_args: randomUUID(), workspace_version: String(version) } };
}
export function trustedMedia(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['doubao.com', 'douyinvod.com', 'volcvideo.com', 'doubaocdn.com', 'bytecdn.com', 'bytecdn.cn', 'ibytedtos.com', 'byteoversea.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : ''; } catch { return ''; }
}
export function collectResult(item, checkpoint) {
  if (!item) return { status: 'running' };
  if (item.id !== checkpoint.itemId) throw Error('原任务节点身份不匹配');
  const asset = item.asset || {}, task = asset.gen_task_info || {};
  for (const key of ['canvas_id', 'canvas_sub_id']) if (checkpoint.taskIds?.[key]) {
    if (!task.extras?.[key]) return { status: 'running' };
    if (checkpoint.taskIds[key] !== task.extras[key]) throw Error('原生成任务身份改变，停止接收');
  }
  if (asset.status === 3 || task.code != null && Number(task.code) !== 0) {
    const message = typeof task.message === 'string' ? task.message.slice(0, 8192)
      .replace(/https?:[/][/][^\s<>"']+/gi, '[链接已隐藏]')
      .replace(/\bBearer\s+[^\s;,]+/gi, 'Bearer [已隐藏]')
      .replace(/\b(api[_-]?key|access[_-]?token|session[_-]?key|cookie|authorization)\s*[:=]\s*[^\r\n;,]+/gi, '$1=[已隐藏]')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    const reason = '上游画布任务生成失败（业务码 ' + (/^-?\d{1,12}$/.test(String(task.code)) ? task.code : 'unknown') + '）';
    const quotaRejected = /(?:额度|积分|次数|余额).{0,8}(?:不足|耗尽|用完)|(?:insufficient|exhausted)[ _-]*(?:credits?|quota)|quota[ _-]*(?:empty|exceeded|exhausted)/i.test(message);
    return { status: 'failed', reason: reason + (message ? '：' + message : ''), ...(quotaRejected ? { quotaRejected: true } : {}) };
  }
  if (asset.status !== 2) return { status: 'running' };
  let model = asset.video_info?.video_model;
  try { if (typeof model === 'string') model = JSON.parse(model); } catch { return { status: 'running' }; }
  const candidates = [asset.video_info?.video_url, asset.video_info?.play_url, asset.video_info?.download_url];
  for (const value of Object.values(model?.video_list || {})) if (value && !value.encryption_method) candidates.push(value.main_url, value.backup_url, value.backup_url_1, value.backup_url_2);
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const url = trustedMedia(raw) || trustedMedia(Buffer.from(raw, 'base64').toString('utf8'));
    if (url) { const parsed = new URL(url); if (parsed.searchParams.get('lr') === 'unwatermarked' || parsed.searchParams.get('logo_type') === 'unwatermarked') return { status: 'success', videoUrl: url }; }
  }
  return { status: 'running' };
}
export class Engine {
  constructor(directory, options = {}) { this.directory = directory; this.browsers = new Map(); this.starting = new Map(); this.home = options.home || HOME; this.offline = options.offline === true; this.closed = false; }
  profile(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('环境编号无效'); return path.join(this.directory, 'profiles', id); }
  healthy(id) { const value = this.browsers.get(id); return Boolean(value?.sessionId && value.child.exitCode === null && !value.child.killed); }
  manuallyOpened(id) { return this.healthy(id) && this.browsers.get(id).visible === true; }
  async browser(id, visible = false) {
    if (this.closed) throw Error('浏览器运行层已关闭');
    if (this.starting.has(id)) return this.starting.get(id);
    const current = this.browsers.get(id); if (current && current.child.exitCode === null) return current;
    const pending = this.startBrowser(id, visible);
    this.starting.set(id, pending);
    try { return await pending; } finally { this.starting.delete(id); }
  }
  async startBrowser(id, visible) {
    const directory = this.profile(id); await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw Error('环境目录不得是链接');
    const args = browserArgs(directory, visible);
    if (this.offline) args.unshift('--host-resolver-rules=MAP * ~NOTFOUND');
    const child = spawn(executable(), args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: !visible });
    const pipe = new Pipe(child);
    const browser = { child, pipe, id, directory, sessionId: '', visible };
    this.browsers.set(id, browser); child.once('exit', () => { if (this.browsers.get(id) === browser) this.browsers.delete(id); });
    try {
    const { targetId } = await pipe.call('Target.createTarget', { url: 'about:blank' });
    browser.targetId = targetId;
    browser.sessionId = (await pipe.call('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await pipe.call('Page.enable', {}, browser.sessionId);
    await pipe.call('Page.navigate', { url: this.home }, browser.sessionId);
    return browser;
    } catch (error) {
      child.kill(); if (this.browsers.get(id) === browser) this.browsers.delete(id); throw error;
    }
  }
  async evaluate(id, fn, value, timeout = 60000) {
    const browser = await this.browser(id);
    const result = await browser.pipe.call('Runtime.evaluate', { expression: '(' + fn.toString() + ')(' + JSON.stringify(value ?? null) + ')', awaitPromise: true, returnByValue: true }, browser.sessionId, timeout);
    if (result.exceptionDetails) throw Error('账号网页执行失败，请打开环境检查');
    return result.result?.value;
  }
  async probe(id) {
    const deadline = Date.now() + 45000;
    do {
      try {
        const state = await this.evaluate(id, pageState);
        if (state?.ready) return state;
      } catch { if (!this.browsers.get(id)) throw Error('浏览器启动失败'); }
      await pause(500);
    } while (Date.now() < deadline);
    return { ready: false };
  }
  async api(id, api, body, checkpoint) {
    const reply = await this.evaluate(id, pageRequest, { api, body, requestContext: checkpoint?.requestContext });
    if (!reply?.data) { const code = /^[A-Za-z0-9_-]{1,40}$/.test(reply?.code || '') ? reply.code : 'unknown'; const error = Error('上游拒绝请求（业务码 ' + code + '）'); error.upstreamRejected = reply?.rejected === true; error.quotaRejected = reply?.quotaRejected === true; throw error; }
    if (checkpoint && reply.requestContext) checkpoint.requestContext = reply.requestContext;
    return reply.data;
  }
  async submit(id, input, persist) {
    const checkpoint = { phase: 'preparing', requestContext: { webTabId: randomUUID() } }; let generationAttempted = false;
    const write = async (api, body, phase) => { checkpoint.phase = phase; await persist({ ...checkpoint }); return this.api(id, api, body, checkpoint); };
    try {
      const created = await write(BASE + 'doc/create', { req: { conversation_id: '0', title: 'eggfansTV ' + input.taskId, initial_assets: [], create_new_conversation: true, conversation_init_ext: JSON.stringify({ agent_task_param: JSON.stringify({ runtime_type: 1 }), mode_id: '3', model_item_key: '9', reasoning_effort: '3' }) } }, 'create_intent');
      checkpoint.conversationId = created.conversation_id; checkpoint.workspaceId = created.snapshot?.canvas_workspace_id;
      if (![checkpoint.conversationId, checkpoint.workspaceId].every(value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value) && value !== '0')) throw Error('工作区回执缺失');
      checkpoint.phase = 'workspace_ready'; await persist({ ...checkpoint });
      let document = await this.read(id, checkpoint);
      const session = document.idgen_session;
      const images = [];
      for (const image of input.images) images.push(await this.evaluate(id, uploadImage, image, 150000));
      operation(input, images);
      if (images.length) {
        const resource_list = images.map((image, index) => ({ uri: image.uri, resource_type: 2, meta: { image_meta: { data: { md5: '', identifier: 'eggfans:' + input.taskId + ':' + index }, parse_extra: {}, image_info: { width: image.width, height: image.height, format: image.format, file_name: 'reference-' + index } } } }));
        const registered = await write('/alice/resource/register', { tenant_id: '5', scene_id: '148', resource_list }, 'register_intent');
        if (images.some(image => !registered[image.uri]?.resource_id)) throw Error('参考图登记未确认');
      }
      document = await this.read(id, checkpoint);
      checkpoint.itemId = canvasNodeID(session);
      const node = { id: checkpoint.itemId, type: 102, title: '视频', frame_id: '', transform: { x: 0, y: 0, width: 2048, height: 2048, rotation: 0, z_index: 1, flip_horizontal: false, flip_vertical: false }, status: 1, version: 1, created_by: 2, ext: {}, asset: { asset_key: '', asset_short_url: '', type: 2, ext: {}, status: 0, video_info: {} } };
      const nodeReply = await write(BASE + 'doc/actions', { req: { canvas_workspace_id: checkpoint.workspaceId, workspace_version: String(document.snapshot.version), actions: [{ type: 101, base_version: '0', target_item: node }] } }, 'node_intent');
      if (nodeReply.is_success !== true || !nodeReply.results?.some(value => value.result_item?.id === checkpoint.itemId && (value.result_code == null || Number(value.result_code) === 0))) throw Error('节点创建未确认');
      document = await this.read(id, checkpoint); const item = document.snapshot.doc?.items?.[checkpoint.itemId];
      if (!item || item.id !== checkpoint.itemId || item.type !== node.type || item.asset?.gen_task_info || [1, 2, 3].includes(item.asset?.status)) throw Error('节点状态不允许提交');
      checkpoint.requestId = 'canvas-video:' + checkpoint.itemId + ':' + randomUUID(); checkpoint.phase = 'exec_intent'; await persist({ ...checkpoint });
      generationAttempted = true;
      const accepted = await this.api(id, BASE + 'tool/exec', executionBody(checkpoint, node, item, input, images, document.snapshot.version), checkpoint);
      if (accepted.canvas_workspace_id !== checkpoint.workspaceId || accepted.binding_item?.id !== checkpoint.itemId || accepted.task_snapshot?.request_id !== checkpoint.requestId) throw Error('生成受理回执不匹配');
      const extras = accepted.binding_item.asset?.gen_task_info?.extras || {};
      checkpoint.taskIds = { canvas_id: extras.canvas_id, canvas_sub_id: extras.canvas_sub_id }; checkpoint.phase = 'accepted'; await persist({ ...checkpoint }); return checkpoint;
    } catch (error) { if (!generationAttempted || error.upstreamRejected === true) error.beforeGeneration = true; throw error; }
  }
  async read(id, checkpoint) {
    if (![checkpoint.conversationId, checkpoint.workspaceId].every(value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value))) throw Error('原任务工作区身份无效');
    const data = await this.api(id, BASE + 'doc/get', { req: { conversation_id: checkpoint.conversationId, canvas_workspace_id: checkpoint.workspaceId, ...(checkpoint.itemId ? { item_ids: [checkpoint.itemId] } : {}), need_idgen_session: !checkpoint.itemId } }, checkpoint);
    if (data.snapshot?.canvas_workspace_id !== checkpoint.workspaceId || !/^\d+$/.test(String(data.snapshot.version))) throw Error('原任务文档身份不匹配');
    return data;
  }
  async query(id, checkpoint) {
    await this.probe(id);
    const data = await this.read(id, checkpoint);
    return collectResult(data.snapshot.doc?.items?.[checkpoint.itemId], checkpoint);
  }
  async stop(id) {
    if (this.starting.has(id)) await this.starting.get(id).catch(() => {});
    const browser = this.browsers.get(id); if (!browser) return;
    const exited = new Promise(resolve => browser.child.once('exit', resolve));
    await browser.pipe.call('Browser.close', {}, undefined, 3000).catch(() => {});
    await Promise.race([exited, pause(4000)]);
    if (browser.child.exitCode === null) { browser.child.kill(); await Promise.race([exited, pause(2000)]); }
    if (browser.child.exitCode === null) throw Error('浏览器仍在占用环境资料');
    this.browsers.delete(id);
  }
  async clear(id) {
    await this.stop(id); const directory = this.profile(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw Error('环境目录不得是链接');
    const actual = await realpath(directory), parent = await realpath(path.dirname(directory)), root = await realpath(this.directory);
    if ((await lstat(path.dirname(directory))).isSymbolicLink() || parent !== path.join(root, 'profiles') || path.dirname(actual) !== parent || path.basename(actual) !== id) throw Error('环境清理路径越界');
    const entries = ['ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', ...['History', 'History-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal', 'Cache', 'Code Cache', 'GPUCache', 'Media Cache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Cookies', 'Cookies-journal', 'Network/Cookies', 'Network/Cookies-journal', 'Local Storage', 'Session Storage', 'IndexedDB', 'Service Worker', 'CacheStorage', 'File System', 'WebStorage', 'Storage', 'SharedStorage', 'SharedStorage-wal', 'QuotaManager', 'QuotaManager-journal'].map(entry => 'Default/' + entry)];
    const targets = [];
    for (const entry of entries) {
      let target = actual, present = true;
      for (const segment of entry.split('/')) {
        target = path.join(target, segment);
        let metadata;
        try { metadata = await lstat(target); } catch (error) { if (error.code === 'ENOENT') { present = false; break; } throw error; }
        if (metadata.isSymbolicLink() || !(await realpath(target)).startsWith(actual + path.sep)) throw Error('环境清理路径包含链接或越界');
      }
      if (present) targets.push(target);
    }
    for (const target of targets) await rm(target, { recursive: true, force: true });
  }
  async open(id) { await this.stop(id); await this.browser(id, true); }
  async close() { this.closed = true; await Promise.allSettled([...this.starting.values()]); await Promise.allSettled([...this.browsers.keys()].map(id => this.stop(id))); }
}
