import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine, operation, collectResult, trustedMedia, browserArgs, pageState, pageRequest, uploadImage, canvasNodeID, executionBody } from './engine.mjs';

test('native canvas keeps one request context from creation through polling and restart', async () => {
  const sent = [];
  let device = 'first-device';
  const context = vm.createContext({ window: {}, location: {origin:'https://www.doubao.com'}, document:{cookie:''}, performance:{getEntriesByType:()=>[{name:'https://www.doubao.com/samantha/info?aid=1&device_id='+device}]}, URL, URLSearchParams, AbortSignal, fetch:async url=>{sent.push(new URL(url, 'https://www.doubao.com')); return {ok:true,text:async()=>JSON.stringify({code:0,data:{ok:true}})};} });
  context.crypto = {randomUUID:()=>String(sent.length)};
  const request = {api:'/creativity/canvas_workspace/doc/get', body:{req:{}}, requestContext:{webTabId:'550e8400-e29b-41d4-a716-446655440000'}};
  context.input = request;
  const source = '('+pageRequest.toString()+')(input)';
  await vm.runInContext(source, context);
  device = 'changed-device';
  await vm.runInContext(source, context);
  assert.equal(sent[0].search, sent[1].search);
  assert.equal(sent[0].searchParams.get('web_tab_id'), request.requestContext.webTabId);
  context.window = {};
  await vm.runInContext(source, context);
  assert.equal(sent[2].searchParams.get('web_tab_id'), sent[0].searchParams.get('web_tab_id'));
});

test('canvas execution preserves native node identity, binding and request structure', () => {
  const itemId = canvasNodeID('ABCDEFGHIJ'); assert.match(itemId, /^[A-Za-z0-9]{8}-ABCDEFGHIJ-0202$/);
  assert.throws(() => canvasNodeID('bad'));
  const checkpoint = { workspaceId: 'workspace', conversationId: 'conversation', itemId, requestId: 'canvas-video:' + itemId + ':fixture' };
  const node = { id: itemId, type: 102, transform: { width: 2048, height: 2048, x: 0 }, asset: { status: 0 }, ext: {} };
  const body = executionBody(checkpoint, node, { id: itemId, transform: { x: 20 } }, { model: 'seedance_v2.0', prompt: 'fixture', duration: 5, ratio: '9:16' }, [], 2);
  assert.equal(body.req.biding_item.transform.width, 2048); assert.equal(body.req.biding_item.transform.x, 20);
  assert.equal(body.req.biding_item.asset.status, 0); assert.equal(body.req.workspace_version, '2');
  assert.equal(body.req.execute_request.request_id, checkpoint.requestId);
  assert.equal(body.req.execute_request.operation.use_model, 'seedance_v2.0');
  assert.equal(body.req.execute_request.canvas_context.trigger_scene, 'infinite_canvas_video_generator');
});

test('native canvas readiness does not require account login or claim account quota', () => {
  const inspect = (data, origin = 'https://www.doubao.com', entries = [{ name: 'https://www.doubao.com/samantha/user/info?aid=1&device_id=fixture' }]) => vm.runInNewContext('(' + pageState.toString() + ')()', { window: { _ROUTER_DATA: { loaderData: { chat_layout: { chat_layout: { accountInfo: { data } } } } } }, location: { origin, pathname: '/chat/' }, performance: { getEntriesByType: () => entries }, URL });
  for (const account of [{ error_code: 13, user_id: '', session_key: '' }, {}, { user_id: '0' }, { user_id: '123', error_code: 13 }]) {
    const state = inspect(account); assert.equal(state.ready, true); assert.equal(state.authenticated, false); assert.equal(state.visitor, true);
  }
  for (const account of [{ user_id: '123', error_code: 0 }, { user_id_str: '123', is_visitor_account: true }]) assert.equal(inspect(account).ready, true);
  assert.equal(inspect({ user_id_str: '123', is_visitor_account: true }).visitor, true);
  assert.equal(inspect({ user_id: '123' }).authenticated, true);
  assert.equal(inspect({}, 'https://foreign.invalid').ready, false);
  assert.equal(inspect({}, undefined, []).ready, false);
});

test('native image upload locates current Rspack and legacy runtime without module IDs', async () => {
  for (const key of ['rspackChunkapp_flow_chat', '__LOADABLE_LOADED_CHUNKS__']) {
    let submitted = 0;
    const uploader = { getInstance: () => ({ cancel() {} }), upload: async (_file, callbacks) => { submitted++; callbacks.complete({ uploadResult: { ImageUri: 'tos-cn-fixture/portrait', ImageWidth: 10, ImageHeight: 20 } }); return 'key'; } };
    const runtime = () => ({ a: async () => ({ getUploader: async () => uploader }) });
    runtime.m = { locator: function () { return ['serviceContainer', 'resourceStore', 'chat-ioc-manager: cannot bind empty service']; } };
    const chunks = []; chunks.push = packet => packet[2](runtime);
    const context = { window: { [key]: chunks }, location: { origin: 'https://www.doubao.com', pathname: '/chat/' }, crypto: { randomUUID: () => 'fixture' }, File: class {}, createImageBitmap: async () => ({ width: 10, height: 20, close() {} }), atob: value => Buffer.from(value, 'base64').toString('binary'), setTimeout, clearTimeout };
    const result = await vm.runInNewContext('(' + uploadImage.toString() + ')("data:image/png;base64,aW1hZ2U=")', context);
    assert.equal(result.uri, 'tos-cn-fixture/portrait'); assert.equal(submitted, 1);
  }
});

test('video parameters and model names are passed without conflating Fast and standard', () => {
  for (const model of ['seedance_v2.5', 'seedance_v2.0_std', 'seedance_v2.0', 'seedance_v2.0_mini']) {
    const result = operation({ model, duration: 12, ratio: '9:16', prompt: 'fixture' }, []);
    assert.equal(result.use_model, model); assert.equal(result.prompt, 'fixture');
    assert.deepEqual(result.video_param, { duration: 12, ratio: '9:16' });
  }
});
test('image receipt validation rejects traversal and invalid dimensions', () => {
  const input = { model: 'seedance_v2.5', prompt: 'fixture', duration: 5, ratio: '16:9' };
  assert.throws(() => operation(input, [{ uri: '../foreign', width: 10, height: 10 }]));
  assert.throws(() => operation(input, [{ uri: 'tos-cn-fixture/a', width: 0, height: 10 }]));
  assert.equal(operation(input, [{ uri: 'tos-cn-fixture/a', width: 10, height: 20 }]).attachments[0].image.height, 20);
});

test('native reference placeholders stay bound to their ordered attachments', () => {
  const input = { model: 'seedance_v2.5', prompt: '{{ref 2}} fixture {{ref:1}}', duration: 5, ratio: '16:9' };
  const images = [{ uri: 'tos-cn-fixture/a', width: 10, height: 20 }, { uri: 'tos-cn-fixture/b', width: 30, height: 40 }];
  const result = operation(input, images);
  assert.equal(result.prompt, '{{ref:2}} fixture {{ref:1}}');
  assert.deepEqual(result.attachments.map(a => a.prompt_placeholder), ['{{ref:1}}', '{{ref:2}}']);
  assert.throws(() => operation({ ...input, prompt: '{{ref 3}}' }, images));
});
test('result collector validates original node and task identities', () => {
  const checkpoint = { itemId: 'item', taskIds: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  assert.throws(() => collectResult({ id: 'foreign' }, checkpoint));
  assert.throws(() => collectResult({ id: 'item', asset: { gen_task_info: { extras: { canvas_id: 'other', canvas_sub_id: 'sub' } } } }, checkpoint));
  assert.equal(collectResult({ id: 'item', asset: { status: 2 } }, checkpoint).status, 'running');
});
test('failed original task preserves the upstream rejection message and business code', () => {
  const checkpoint = { itemId: 'item', taskIds: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  const task = { code: 2, message: '审核不通过,请修改后重试', extras: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  const result = collectResult({ id: 'item', asset: { status: 3, gen_task_info: task } }, checkpoint);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, '上游画布任务生成失败（业务码 2）：审核不通过,请修改后重试');
  assert.throws(() => collectResult({ id: 'item', asset: { status: 3, gen_task_info: { ...task, extras: { canvas_id: 'other' } } } }, checkpoint));
});
test('an active original node is not failed by an intermediate task business code', () => {
  const checkpoint = { itemId: 'item', taskIds: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  const task = { code: 2, message: '暂未同步', extras: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  for (const status of [0, 1, '1']) assert.equal(collectResult({ id: 'item', asset: { status, gen_task_info: task } }, checkpoint).status, 'running');
  assert.equal(collectResult({ id: 'item', asset: { status: 3, gen_task_info: task } }, checkpoint).status, 'failed');
});
test('failure messages redact credentials and URLs and remain bounded plain text', () => {
  const message = '请求被拒绝\nAuthorization: Bearer secret-access-token; api_key=private-key; https://cdn.example.test/video?signature=private-url ' + '额'.repeat(1000);
  const result = collectResult({ id: 'item', asset: { status: 3, gen_task_info: { code: 3, message } } }, { itemId: 'item' });
  assert.match(result.reason, /请求被拒绝/);
  for (const secret of ['secret-access-token', 'private-key', 'private-url', '\n']) assert.equal(result.reason.includes(secret), false);
  assert.ok(result.reason.length < 500);
  for (const empty of [undefined, null, {}, '  ']) {
    const fallback = collectResult({ id: 'item', asset: { status: 3, gen_task_info: { code: 2, message: empty } } }, { itemId: 'item' });
    assert.equal(fallback.reason, '上游画布任务生成失败（业务码 2）');
  }
});

test('only explicit upstream quota failure marks an exhausted environment', async () => {
  for (const message of ['额度不足，请充值', 'insufficient credits', 'quota_exceeded']) {
    const result = collectResult({ id: 'item', asset: { status: 3, gen_task_info: { code: 2, message } } }, { itemId: 'item' });
    assert.equal(result.quotaRejected, true);
  }
  const rejected = collectResult({ id: 'item', asset: { status: 3, gen_task_info: { code: 2, message: '审核不通过' } } }, { itemId: 'item' });
  assert.notEqual(rejected.quotaRejected, true);
  const context = vm.createContext({ window: {}, location: { origin: 'https://www.doubao.com' }, document: { cookie: '' }, performance: { getEntriesByType: () => [] }, URL, URLSearchParams, AbortSignal, fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ code: 'quota_empty', msg: 'private api_key=secret' }) }) });
  context.input = { api: '/creativity/canvas_workspace/tool/exec', body: {}, requestContext: { webTabId: 'fixture', params: 'aid=1&device_id=fixture' } };
  const packet = await vm.runInContext('(' + pageRequest.toString() + ')(input)', context);
  assert.equal(packet.quotaRejected, true);
  assert.equal(JSON.stringify(packet).includes('secret'), false);
  const engine = new Engine('unused'); engine.evaluate = async () => packet;
  await assert.rejects(engine.api('fixture', '/creativity/canvas_workspace/tool/exec', {}), error => error.quotaRejected === true && error.upstreamRejected === true);
});
test('video result requires trusted unwatermarked media and successful status', () => {
  const checkpoint = { itemId: 'item' };
  const item = { id: 'item', asset: { status: 2, video_info: { video_model: { video_list: { original: { main_url: Buffer.from('https://v.douyinvod.com/fixture.mp4?logo_type=unwatermarked').toString('base64') } } } } } };
  assert.equal(collectResult(item, checkpoint).status, 'success');
  item.asset.status = 1; assert.equal(collectResult(item, checkpoint).status, 'running');
  item.asset.status = 3; assert.equal(collectResult(item, checkpoint).status, 'failed');
  assert.equal(trustedMedia('https://douyinvod.com.evil.invalid/a'), '');
  assert.equal(trustedMedia('http://v.douyinvod.com/a'), '');
});
test('native Doubao CDN result is received from the original completed task', () => {
  const checkpoint = { itemId: 'item', taskIds: { canvas_id: 'canvas', canvas_sub_id: 'sub' } };
  const item = { id: 'item', asset: { status: 2, gen_task_info: { code: 0, extras: { canvas_id: 'canvas', canvas_sub_id: 'sub' } }, video_info: { video_model: JSON.stringify({ video_list: { video_1: { main_url: Buffer.from('https://v26-vdl.doubao.com/video.mp4?lr=unwatermarked').toString('base64'), encryption_method: '' } } }) } } };
  const result = collectResult(item, checkpoint);
  assert.equal(result.status, 'success'); assert.equal(new URL(result.videoUrl).hostname, 'v26-vdl.doubao.com');
  assert.equal(trustedMedia('https://v26-vdl.doubao.com.evil.invalid/video.mp4'), '');
  const video = JSON.parse(item.asset.video_info.video_model);
  video.video_list.video_1.backup_url_1 = video.video_list.video_1.main_url; delete video.video_list.video_1.main_url;
  item.asset.video_info.video_model = JSON.stringify(video);
  assert.equal(collectResult(item, checkpoint).status, 'success');
});
test('browser launches only its dedicated profile through an inherited debugging pipe', () => {
  const args = browserArgs('S:/fixture/profile', false);
  assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(args.includes('--user-data-dir=S:/fixture/profile'));
  assert.equal(args.some(a => a.includes('--no-sandbox') || a.includes('remote-debugging-port')), false);
});

test('cleanup deletes only provider browser data and preserves video files, receipts and neighboring profiles', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-browser-clear-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = randomUUID(), otherId = randomUUID(), engine = new Engine(directory);
  const files = ['pool.json', 'output/video.mp4', 'resources/video.mp4', 'cache/video.mp4', 'profiles/' + otherId + '/Cookies', 'profiles/' + id + '/Local State', 'profiles/' + id + '/Default/Preferences', 'profiles/' + id + '/Default/Bookmarks'];
  const cleared = ['Default/History', 'Default/History-journal', 'Default/Cookies', 'Default/Network/Cookies', 'Default/Cache/data', 'Default/Code Cache/js/data', 'ShaderCache/data', 'Default/GPUCache/data', 'Default/Local Storage/leveldb/data', 'Default/Session Storage/data', 'Default/IndexedDB/site/data', 'Default/Service Worker/Database/data', 'Default/Service Worker/CacheStorage/data', 'Default/File System/data', 'Default/WebStorage/data'];
  for (const file of [...files, ...cleared.map(name => 'profiles/' + id + '/' + name)]) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'sentinel:' + file);
  }
  await engine.clear(id);
  for (const file of cleared) await assert.rejects(readFile(path.join(engine.profile(id), file)), { code: 'ENOENT' });
  for (const file of files) assert.equal(await readFile(path.join(directory, file), 'utf8'), 'sentinel:' + file);
});

test('cleanup rejects a nested storage junction without touching its target', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-browser-storage-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = randomUUID(), external = path.join(directory, 'video-library');
  await mkdir(external); await writeFile(path.join(external, 'Cookies'), 'must survive');
  await mkdir(path.join(directory, 'profiles', id, 'Default'), { recursive: true });
  await symlink(external, path.join(directory, 'profiles', id, 'Default', 'Network'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Engine(directory).clear(id), /链接|越界/);
  assert.equal(await readFile(path.join(external, 'Cookies'), 'utf8'), 'must survive');
});

test('cleanup rejects directory junctions before deleting any external files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-browser-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = randomUUID(), external = path.join(directory, 'video-library');
  await mkdir(external); await writeFile(path.join(external, 'video.mp4'), 'must survive');
  await mkdir(path.join(directory, 'profiles'));
  await symlink(external, path.join(directory, 'profiles', id), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Engine(directory).clear(id), /链接|越界/);
  assert.equal(await readFile(path.join(external, 'video.mp4'), 'utf8'), 'must survive');
});
