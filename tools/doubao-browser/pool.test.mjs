import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool, MODELS, TARGET, RESERVE, validateRequest } from './pool.mjs';

async function fixture(t, patch = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-pool-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const engine = {
    probe: async id => { calls.push(['probe', id]); return { ready: true, visitor: true }; },
    submit: async (id, request, persist) => {
      calls.push(['submit', id, request]);
      await persist({ phase: 'exec_intent', workspaceId: 'workspace', conversationId: 'conversation', itemId: 'item', requestId: 'request' });
      return { phase: 'accepted', workspaceId: 'workspace', conversationId: 'conversation', itemId: 'item', requestId: 'request' };
    },
    query: async () => ({ status: 'running' }),
    clear: async id => { calls.push(['clear', id]); },
    ...patch,
  };
  return { directory, calls, pool: new Pool(directory, engine) };
}
const request = { taskId: 'fixture-task', model: 'seedance_v2.5', prompt: 'fixture', duration: 5, ratio: '16:9', images: [] };

test('existing 100-environment pool expands to 300 without changing identities or active receipts', async t => {
  const { pool, directory, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  pool.state.profiles = pool.state.profiles.slice(0, 100);
  const profile = pool.state.profiles[0];
  const receipt = { taskId: request.taskId, profileId: profile.id };
  profile.state = 'busy';
  profile.taskId = request.taskId;
  profile.usedTaskId = request.taskId;
  pool.state.jobs[request.taskId] = { profileId: profile.id, phase: 'accepted', receipt };
  await pool.save();
  const original = structuredClone(pool.state);
  calls.length = 0;
  const restarted = new Pool(directory, pool.engine);
  await restarted.maintain();
  const status = await restarted.status();
  assert.equal(status.target, 300);
  assert.equal(status.total, 300);
  assert.equal(new Set(status.profiles.map(item => item.id)).size, 300);
  assert.deepEqual(status.profiles.slice(0, 100).map(item => item.id), original.profiles.map(item => item.id));
  assert.equal(status.busy, 1);
  assert.equal(status.idle, 2);
  assert.equal(status.reserve, 2);
  assert.deepEqual(restarted.state.jobs, original.jobs);
  assert.deepEqual(await restarted.lookup(request.taskId), receipt);
  assert.equal(calls.some(call => call[0] === 'submit' || call[0] === 'clear'), false);
  assert.equal((await new Pool(directory, {}).status()).total, 300);
});

test('prompt boundary counts unicode characters and preserves the full 8000-character request', () => {
  const prompt = '镜\u{1F3AC}'.repeat(4000);
  for (const model of MODELS) {
    const input = { ...request, model, prompt };
    assert.doesNotThrow(() => validateRequest(input));
    assert.equal(input.prompt, prompt);
    assert.throws(() => validateRequest({ ...input, prompt: prompt + '镜' }), /8000/);
    assert.throws(() => validateRequest({ ...input, prompt: '   ' }), /8000/);
  }
});

test('enable maintains exactly 300 environments and two warm idle pages', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const status = await pool.status();
  assert.equal(status.profiles.length, 300);
  assert.equal(new Set(status.profiles.map(p => p.id)).size, 300);
  assert.equal(status.idle, 2);
  assert.equal(calls.filter(c => c[0] === 'probe').length, 2);
});

test('automatic names are unique across pools and stable after restart and cleanup', async t => {
  const first = await fixture(t), second = await fixture(t);
  await first.pool.configure({ enabled: true });
  await second.pool.configure({ enabled: true });
  const profiles = (await first.pool.status()).profiles;
  const names = profiles.map(profile => profile.label);
  assert.equal(new Set([...names, ...(await second.pool.status()).profiles.map(profile => profile.label)]).size, TARGET * 2);
  for (const profile of profiles) assert.equal(profile.label, 'eggfansTV-' + profile.id);
  await first.pool.clearAll();
  assert.deepEqual((await first.pool.status()).profiles.map(profile => profile.label), names);
  const restarted = new Pool(first.directory, {});
  assert.deepEqual((await restarted.status()).profiles.map(profile => profile.label), names);
});

test('legacy duplicate names are repaired durably without changing profile identities or receipts', async t => {
  const { pool, directory } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const original = JSON.parse(await readFile(path.join(directory, 'pool.json'), 'utf8'));
  for (const profile of original.profiles) profile.label = '环境 1';
  await writeFile(path.join(directory, 'pool.json'), JSON.stringify(original));
  const restarted = new Pool(directory, {});
  const profiles = (await restarted.status()).profiles;
  assert.equal(new Set(profiles.map(profile => profile.label)).size, TARGET);
  assert.deepEqual(profiles.map(profile => profile.id), original.profiles.map(profile => profile.id));
  assert.deepEqual(await restarted.lookup(request.taskId), receipt);
  const saved = JSON.parse(await readFile(path.join(directory, 'pool.json'), 'utf8'));
  assert.deepEqual(saved.profiles.map(profile => profile.label), profiles.map(profile => profile.label));
  assert.deepEqual(saved.jobs, original.jobs);
});

test('manual login windows survive failed maintenance probes and become eligible after login', async t => {
  const opened = new Set(), stopped = [];
  let loggedIn = false;
  const { pool } = await fixture(t, {
    probe: async () => ({ ready: loggedIn, needsLogin: !loggedIn }),
    open: async id => { opened.add(id); },
    manuallyOpened: id => opened.has(id),
    stop: async id => { stopped.push(id); },
  });
  await pool.configure({ enabled: true });
  const id = (await pool.status()).profiles[0].id;
  stopped.length = 0;
  await pool.open(id);
  assert.equal(stopped.includes(id), false);
  let profile = (await pool.status()).profiles.find(value => value.id === id);
  assert.equal(profile.state, 'attention'); assert.match(profile.reason, /网页未就绪/);
  loggedIn = true; profile = pool.state.profiles.find(value => value.id === id); profile.checkedAt = new Date(0).toISOString();
  await pool.maintain();
  assert.equal((await pool.status()).profiles.find(value => value.id === id).state, 'idle');
});

test('status remains readable while browser initialization is pending', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const { pool } = await fixture(t, { probe: async () => { entered(); await gate; return { ready: true }; } });
  const enabling = pool.configure({ enabled: true });
  await started;
  let timer;
  try {
    const status = await Promise.race([pool.status(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('status blocked by initialization')), 1000); })]);
    assert.equal(status.total, TARGET);
    assert.equal(status.idle, 0);
  } finally { clearTimeout(timer); release(); await enabling; }
  assert.equal((await pool.status()).idle, 2);
});

test('repeated status calls never expose an invalid loaded pool', async t => {
  const { pool, directory, calls } = await fixture(t);
  const body = JSON.stringify({ version: 1, enabled: true, profiles: [{ id: '../outside' }], jobs: {} });
  await writeFile(path.join(directory, 'pool.json'), body);
  await assert.rejects(pool.status(), /身份无效/);
  await assert.rejects(pool.status(), /身份无效/);
  assert.equal(await readFile(path.join(directory, 'pool.json'), 'utf8'), body);
  assert.equal(calls.length, 0);
});

test('accepted task consumes a ready environment without changing any generation parameters', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.equal(receipt.taskId, 'fixture-task');
  assert.equal((await pool.status()).idle, 1);
  assert.deepEqual(calls.find(c => c[0] === 'submit')[2], request);
  assert.equal((await pool.status()).busy, 1);
});

test('ready environments submit immediately even when reserve replacement is unavailable', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  calls.length = 0;
  pool.engine.probe = async () => { throw Error('replacement unavailable'); };
  const receipts = await Promise.all([pool.submit(request), pool.submit({ ...request, taskId: 'second-ready' })]);
  assert.equal(new Set(receipts.map(receipt => receipt.profileId)).size, 2);
  assert.equal((await pool.status()).idle, 0);
  assert.equal((await pool.status()).busy, 2);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 2);
});

test('a cold environment failure cannot consume another task environment or invent acceptance', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  let attempts = 0;
  pool.engine.probe = async () => ({ ready: ++attempts > 1 });
  await assert.rejects(pool.submit(request), /网页未就绪/);
  const original = await pool.lookup(request.taskId);
  const receipt = await pool.submit({ ...request, taskId: 'after-unready' });
  assert.notEqual(receipt.profileId, original.profileId);
  assert.equal((await pool.query(original)).status, 'failed');
  assert.equal(attempts, 2);
  assert.equal((await pool.status()).idle, 0);
  assert.equal((await pool.status()).busy, 1);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
  assert.equal(receipt.taskId, 'after-unready');
});

test('reserve replacement never gates an available environment after five submissions', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = [];
  for (let index = 0; index < 5; index++) receipts.push(await pool.submit({ ...request, taskId: 'first-five-' + index }));
  pool.state.profiles.find(profile => profile.state === 'cold').state = 'idle';
  let attempts = 0;
  pool.engine.probe = async () => ({ ready: ++attempts > 2 });
  receipts.push(await pool.submit({ ...request, taskId: 'sixth-task' }));
  assert.equal(new Set(receipts.map(receipt => receipt.profileId)).size, 6);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 6);
  assert.equal(attempts, 0);
  assert.equal((await pool.status()).idle, 0);
});

test('same task after restart reads receipt without another submission', async t => {
  const { pool, directory, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const restarted = new Pool(directory, { submit: () => { throw Error('must not resubmit'); } });
  assert.deepEqual(await restarted.submit(request), receipt);
  assert.equal(calls.filter(c => c[0] === 'submit').length, 1);
});

test('unknown submission holds its environment across restart and is skipped by clearing', async t => {
  const { pool, directory } = await fixture(t, { submit: async (_id, _request, persist) => { await persist({ phase: 'exec_intent' }); throw Error('connection lost'); } });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const restarted = new Pool(directory, {});
  assert.deepEqual(await restarted.submit(request), receipt);
  assert.equal((await restarted.query(receipt)).status, 'submission_pending');
  restarted.engine.clear = async () => {};
  assert.equal((await restarted.clearAll()).skipped, 1);
  assert.equal((await restarted.status()).busy, 1);
});

test('batch clear skips unfinished tasks and cleans the remaining environments', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.equal((await pool.clearAll()).skipped, 1);
  assert.equal(calls.filter(c => c[0] === 'clear').length, TARGET - 1);
  assert.equal(calls.some(c => c[0] === 'clear' && c[1] === receipt.profileId), false);
});

test('clear reports real results and never claims a server quota reset', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const result = await pool.clearAll();
  assert.equal(result.cleared, TARGET);
  assert.equal(calls.filter(c => c[0] === 'clear').length, TARGET);
  assert.equal(result.quotaResetConfirmed, false);
  assert.equal((await pool.status()).profiles.length, TARGET);
  assert.equal((await pool.status()).idle, 2);
});

test('failed cleanup is reported, not counted as successful', async t => {
  let n = 0;
  const { pool } = await fixture(t, { clear: async () => { if (++n === 1) throw Error('locked'); } });
  await pool.configure({ enabled: true });
  const result = await pool.clearAll();
  assert.equal(result.cleared, TARGET - 1);
  assert.equal(result.failed.length, 1);
});

test('capacity and account readiness are never invented after a failed probe', async t => {
  const { pool } = await fixture(t, { probe: async () => ({ ready: false, reason: '需要登录' }) });
  await pool.configure({ enabled: true });
  assert.equal((await pool.status()).idle, 0);
  await assert.rejects(pool.submit(request), /网页未就绪/);
});

test('only confirmed pre-generation failures expose the retry-safe marker', async t => {
  const { pool } = await fixture(t);
  await assert.rejects(pool.submit(request), error => error.beforeGeneration === true);
  await pool.configure({ enabled: true });
  pool.engine.submit = async () => { throw Object.assign(Error('fixture upstream rejection'), { beforeGeneration: true }); };
  await assert.rejects(pool.submit(request), error => error.beforeGeneration === true);
  const legacy = { ...request, taskId: 'legacy-unknown' };
  pool.state.jobs[legacy.taskId] = { profileId: pool.state.profiles[0].id, digest: createHash('sha256').update(JSON.stringify(legacy)).digest('hex') };
  await assert.rejects(pool.submit(legacy), error => error.beforeGeneration !== true);
});

test('restarted pre-execution preparation is not reported as upstream generation', async t => {
  const { pool, directory } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const job = pool.state.jobs[request.taskId];
  job.phase = 'workspace_ready'; job.checkpoint = { phase: 'workspace_ready', conversationId: 'conversation', workspaceId: 'workspace' };
  await pool.save();
  let queried = 0;
  const restarted = new Pool(directory, { query: async () => { queried++; throw Error('must not query an unsubmitted task'); } });
  const result = await restarted.query(receipt);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /准备阶段已中断.*尚未提交视频生成/);
  assert.equal(queried, 0);
  assert.equal(restarted.state.jobs[request.taskId].phase, 'failed');
});

test('live preparation remains preparing and execution-intent resumes only the original query', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const { pool } = await fixture(t, { submit: async (_id, _input, persist) => { await persist({ phase: 'workspace_ready', workspaceId: 'workspace' }); started(); await waiting; return { phase: 'accepted', workspaceId: 'workspace', conversationId: 'conversation', itemId: 'item', requestId: 'request' }; } });
  await pool.configure({ enabled: true });
  const submitting = pool.submit(request);
  await ready;
  const receipt = await pool.lookup(request.taskId);
  const during = await pool.query(receipt);
  assert.equal(during.status, 'preparing');
  assert.match(during.reason, /准备/);
  release(); await submitting;
  pool.state.jobs[request.taskId].phase = 'exec_intent';
  assert.equal((await pool.query(receipt)).status, 'running');
});

test('terminal query releases only its original environment', async t => {
  const { pool } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://example.douyinvod.com/result.mp4' }) });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  await assert.rejects(pool.query({ ...receipt, profileId: 'foreign' }));
  assert.equal((await pool.status()).busy, 1);
  assert.equal((await pool.query(receipt)).status, 'success');
  assert.equal((await pool.status()).busy, 0);
});
test('upstream rejection details survive restart without another generation or query', async t => {
  const result = { status: 'failed', reason: '上游画布任务生成失败（业务码 2）：审核不通过,请修改后重试' };
  const { pool, directory, calls } = await fixture(t, { query: async () => result });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.deepEqual(await pool.query(receipt), result);
  assert.equal((await pool.status()).busy, 0);
  const restarted = new Pool(directory, { query: () => { throw Error('terminal result must remain cached'); }, submit: () => { throw Error('must not regenerate'); } });
  assert.deepEqual(await restarted.query(receipt), result);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
});

test('persisted terminal results never retain their original busy reservation', async t => {
  const { pool, directory } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const save = pool.save.bind(pool);
  const saved = [];
  pool.save = async () => {
    await save();
    saved.push(JSON.parse(await readFile(path.join(directory, 'pool.json'), 'utf8')));
  };
  await pool.query(receipt);
  assert.ok(saved.length > 0);
  for (const state of saved) {
    assert.equal(state.jobs[receipt.taskId].phase, 'success');
    const profile = state.profiles.find(value => value.id === receipt.profileId);
    assert.notEqual(profile.state, 'busy');
    assert.equal(profile.taskId, undefined);
  }
});

test('repeated terminal query cannot release a newer reservation', async t => {
  const { pool } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://example.douyinvod.com/result.mp4' }) });
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  await pool.query(original);
  await pool.submit({ ...request, taskId: 'second-task' });
  assert.equal((await pool.status()).busy, 1);
  await pool.query(original);
  assert.equal((await pool.status()).busy, 1);
});

test('concurrent tasks reserve distinct environments without waiting for spare pages', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = await Promise.all(Array.from({ length: 4 }, (_, index) => pool.submit({ ...request, taskId: 'parallel-' + index })));
  assert.equal(new Set(receipts.map(r => r.profileId)).size, 4);
  assert.equal((await pool.status()).idle, 0);
  assert.equal((await pool.status()).busy, 4);
  await assert.rejects(pool.open(receipts[0].profileId), /占用/);
});

test('completed tasks rotate environments instead of always reusing the first profile', async t => {
  const { pool, calls } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://example.douyinvod.com/result.mp4' }) });
  await pool.configure({ enabled: true });
  const assigned = [];
  for (let index = 0; index < 6; index++) {
    const receipt = await pool.submit({ ...request, taskId: 'sequential-' + index });
    assigned.push(receipt.profileId);
    await pool.query(receipt);
  }
  assert.equal(new Set(assigned).size, 6);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 6);
  assert.equal((await pool.status()).busy, 0);
  await pool.maintain();
  assert.equal((await pool.status()).idle, 2);
});

test('environment rotation survives restart without replaying a completed task', async t => {
  const { pool, directory } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://example.douyinvod.com/result.mp4' }) });
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  await pool.query(original);
  const assigned = [];
  const restarted = new Pool(directory, {
    probe: async () => ({ ready: true, visitor: true }),
    submit: async (profileId, input) => { assigned.push([profileId, input.taskId]); return { phase: 'accepted' }; },
  });
  assert.deepEqual(await restarted.submit(request), original);
  const next = await restarted.submit({ ...request, taskId: 'after-restart' });
  assert.notEqual(next.profileId, original.profileId);
  assert.deepEqual(assigned, [[next.profileId, 'after-restart']]);
});

test('a delivered environment is reusable after cleanup and stays reset across restart', async t => {
  const { pool, directory } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }), open: async () => {} });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  await pool.query(receipt);
  await pool.delivered(receipt);
  assert.equal((await pool.status()).profiles.find(profile => profile.id === receipt.profileId).state, 'used');
  await pool.open(receipt.profileId);
  await pool.clearAll();
  const restarted = new Pool(directory, { probe: async () => ({ ready: true }), submit: async () => ({ phase: 'accepted' }) });
  await restarted.maintain();
  const profile = (await restarted.status()).profiles.find(profile => profile.id === receipt.profileId);
  assert.ok(['cold', 'idle'].includes(profile.state));
  assert.equal(profile.usedTaskId, undefined);
  assert.deepEqual(await restarted.query(receipt), { status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' });
});

test('historical failed jobs return their environments without disturbing running task receipts', async t => {
  const { pool, directory } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  const state = JSON.parse(await readFile(path.join(directory, 'pool.json'), 'utf8'));
  const used = state.profiles.find(profile => profile.id !== receipt.profileId);
  used.state = 'cold'; delete used.usedTaskId;
  state.jobs.historical = { profileId: used.id, phase: 'failed' };
  await writeFile(path.join(directory, 'pool.json'), JSON.stringify(state));
  const probed = [];
  const restarted = new Pool(directory, { probe: async id => { probed.push(id); return { ready: true }; } });
  await restarted.maintain();
  assert.equal((await restarted.status()).profiles.find(profile => profile.id === used.id).state, 'idle');
  assert.equal(probed.includes(used.id), true);
  assert.equal((await restarted.status()).busy, 1);
  assert.deepEqual(await restarted.lookup(request.taskId), receipt);
});

test('a rejected environment is never silently recycled and keeps the actual failure', async t => {
  const { pool } = await fixture(t, { submit: async () => { throw Object.assign(Error('上游拒绝请求（业务码 quota_empty）'), { beforeGeneration: true, quotaRejected: true }); } });
  await pool.configure({ enabled: true });
  await assert.rejects(pool.submit(request), /quota_empty/);
  const record = pool.state.jobs[request.taskId];
  await pool.open(record.profileId).catch(() => {});
  await pool.maintain();
  assert.equal((await pool.status()).profiles.find(profile => profile.id === record.profileId).state, 'exhausted');
  assert.match((await pool.query(record.receipt)).reason, /quota_empty/);
});

test('delivered environments recycle after cleanup without losing receipts', async t => {
  const { pool, calls } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  await pool.configure({ enabled: true });
  let original;
  for (let index = 0; index < TARGET + 20; index++) {
    const receipt = await pool.submit({ ...request, taskId: 'once-only-' + index });
    original ||= receipt;
    await pool.query(receipt);
    await pool.delivered(receipt);
  }
  const submitted = calls.filter(call => call[0] === 'submit');
  assert.equal(submitted.length, TARGET + 20);
  assert.equal(new Set(submitted.map(call => call[1])).size, TARGET);
  await pool.maintain();
  assert.ok((await pool.status()).profiles.filter(profile => profile.state === 'used').length < TARGET);
  assert.equal((await pool.status()).idle, 2);
  assert.equal((await pool.status()).succeeded, TARGET + 20);
  assert.deepEqual(await new Pool(pool.directory, {}).lookup(original.taskId), original);
  assert.equal((await new Pool(pool.directory, {}).status()).total, TARGET);
});

test('a historical pool with failed profiles releases them before the next submission', async t => {
  const { pool, directory } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const [index, profile] of pool.state.profiles.entries()) {
    if (index >= 98) { profile.state = 'idle'; continue; }
    profile.usedTaskId = 'history-' + index;
    profile.state = index === 0 ? 'busy' : 'used';
    pool.state.jobs[profile.usedTaskId] = { profileId: profile.id, phase: index === 0 ? 'accepted' : 'failed', receipt: { taskId: profile.usedTaskId, profileId: profile.id } };
  }
  await pool.save();
  const submitted = [];
  const restarted = new Pool(directory, {
    probe: async () => ({ ready: true }),
    submit: async profileId => { submitted.push(profileId); return { phase: 'accepted' }; },
  });
  const receipt = await restarted.submit({ ...request, taskId: 'after-historical-exhaustion' });
  assert.equal(submitted.length, 1);
  assert.equal((await restarted.status()).active, TARGET);
  assert.equal((await restarted.status()).busy, 2);
  assert.equal((await restarted.status()).idle, 0);
  assert.equal((await restarted.status()).used, 0);
  assert.equal((await restarted.status()).failed, 97);
  assert.equal(receipt.profileId, submitted[0]);
  assert.deepEqual(await restarted.lookup('history-0'), pool.state.jobs['history-0'].receipt);
});

test('concurrent duplicate submissions reserve one environment and call generation once', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = await Promise.all(Array.from({ length: 12 }, () => pool.submit(request)));
  assert.ok(receipts.every(receipt => receipt.profileId === receipts[0].profileId));
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
  assert.equal((await pool.status()).busy, 1);
  assert.equal((await pool.status()).idle, 1);
});

test('concurrent demand grows beyond 300 without withholding idle pages or losing persisted receipts', async t => {
  const { pool, directory, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = await Promise.all(Array.from({ length: TARGET }, (_, index) => pool.submit({ ...request, taskId: 'capacity-' + index })));
  assert.equal(new Set(receipts.map(receipt => receipt.profileId)).size, TARGET);
  assert.equal((await pool.status()).total, TARGET);
  assert.equal((await pool.status()).busy, TARGET);
  assert.equal((await pool.status()).idle, 0);
  const originalJobs = structuredClone(pool.state.jobs);
  const originalIds = pool.state.profiles.map(profile => profile.id);
  const additional = await Promise.all(Array.from({ length: 4 }, (_, index) => pool.submit({ ...request, taskId: 'capacity-overflow-' + index })));
  const status = await pool.status();
  assert.equal(status.total, TARGET + 4);
  assert.equal(status.busy, TARGET + 4);
  assert.equal(status.idle, 0);
  assert.equal(new Set([...receipts, ...additional].map(receipt => receipt.profileId)).size, TARGET + 4);
  assert.ok(originalIds.every(id => status.profiles.some(profile => profile.id === id)));
  for (const [taskId, job] of Object.entries(originalJobs)) assert.deepEqual(pool.state.jobs[taskId], job);
  assert.equal(calls.filter(call => call[0] === 'submit').length, TARGET + 4);
  assert.equal(calls.filter(call => call[0] === 'clear').length, 0);
  const restarted = new Pool(directory, pool.engine);
  await restarted.maintain();
  assert.equal((await restarted.status()).total, TARGET + 4 + RESERVE);
  assert.equal((await restarted.status()).idle, RESERVE);
  assert.deepEqual(restarted.state.jobs, pool.state.jobs);
  assert.deepEqual(await restarted.submit({ ...request, taskId: 'capacity-overflow-0' }), additional[0]);
  assert.equal(calls.filter(call => call[0] === 'submit').length, TARGET + 4);
});

test('maintenance adds reserve without touching busy, unknown or undelivered environments', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const [index, profile] of pool.state.profiles.entries()) {
    const taskId = 'protected-' + index;
    const phase = index % 3 === 0 ? 'success' : index % 3 === 1 ? 'unknown' : 'accepted';
    profile.state = phase === 'success' ? 'pending' : 'busy';
    profile.usedTaskId = taskId;
    if (phase !== 'success') profile.taskId = taskId;
    pool.state.jobs[taskId] = { profileId: profile.id, phase, receipt: { taskId, profileId: profile.id } };
  }
  const original = structuredClone(pool.state);
  calls.length = 0;
  await pool.maintain();
  assert.equal((await pool.status()).total, TARGET + RESERVE);
  assert.equal((await pool.status()).idle, RESERVE);
  assert.deepEqual(pool.state.profiles.slice(0, TARGET), original.profiles);
  assert.deepEqual(pool.state.jobs, original.jobs);
  const receipt = await pool.submit(request);
  assert.equal((await pool.status()).total, TARGET + RESERVE);
  assert.equal((await pool.status()).idle, 1);
  assert.equal(original.profiles.some(profile => profile.id === receipt.profileId), false);
  assert.equal(calls.some(call => call[0] === 'clear'), false);
});

test('unready browsers do not cause repeated automatic environment creation', async t => {
  const { pool, calls } = await fixture(t, { probe: async id => { calls.push(['probe', id]); return { ready: false }; } });
  await pool.configure({ enabled: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(pool.submit({ ...request, taskId: 'unready-' + attempt }), /网页未就绪/);
    await pool.maintain();
    assert.equal((await pool.status()).total, TARGET);
    assert.equal((await pool.status()).busy, 0);
  }
  assert.equal(calls.filter(call => call[0] === 'probe').length, 11);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 0);
});

test('unknown exec preserves a recoverable original receipt before transport returns', async t => {
  let generated = 0;
  const { pool, directory } = await fixture(t, {
    submit: async (_id, _input, persist) => { generated++; await persist({ phase: 'exec_intent', workspaceId: 'workspace', conversationId: 'conversation', itemId: 'item', requestId: 'request' }); throw Error('fixture lost reply'); },
    query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }),
  });
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.deepEqual(await pool.lookup(request.taskId), receipt);
  assert.equal((await pool.clearAll()).skipped, 1);
  assert.equal((await pool.query(receipt)).status, 'success');
  assert.deepEqual(await new Pool(directory, {}).lookup(request.taskId), receipt);
  assert.equal(generated, 1);
});

test('slow environment preparation never blocks another live task checkpoint or original query', async t => {
  let releaseProbe, enteredProbe, continueSubmission, enteredSubmission;
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  const probeStarted = new Promise(resolve => { enteredProbe = resolve; });
  const submissionGate = new Promise(resolve => { continueSubmission = resolve; });
  const submissionStarted = new Promise(resolve => { enteredSubmission = resolve; });
  const { pool } = await fixture(t, {
    submit: async (_profileId, input, persist) => {
      if (input.taskId === 'first-live') {
        enteredSubmission();
        await submissionGate;
      }
      const checkpoint = { phase: 'accepted', workspaceId: 'workspace', conversationId: 'conversation', itemId: input.taskId, requestId: input.taskId };
      await persist(checkpoint);
      return checkpoint;
    },
  });
  await pool.configure({ enabled: true });
  const first = pool.submit({ ...request, taskId: 'first-live' });
  await submissionStarted;
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  pool.engine.probe = async () => { enteredProbe(); await probeGate; return { ready: true }; };
  const second = pool.submit({ ...request, taskId: 'second-slow' });
  await probeStarted;
  continueSubmission();
  let timer;
  try {
    const receipt = await Promise.race([first, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('checkpoint blocked by another environment preparation')), 300); })]);
    assert.equal((await pool.query(receipt)).status, 'running');
  } finally {
    clearTimeout(timer);
    releaseProbe();
    await Promise.allSettled([first, second]);
  }
});

test('independent batch submissions prepare different cold environments concurrently', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  const preparing = [];
  let release, bothStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { bothStarted = resolve; });
  pool.engine.probe = async profileId => {
    preparing.push(profileId);
    if (preparing.length === 2) bothStarted();
    await gate;
    return { ready: true };
  };
  const first = pool.submit({ ...request, taskId: 'parallel-cold-1' });
  const second = pool.submit({ ...request, taskId: 'parallel-cold-2' });
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('cold browser preparation was serialized')), 300); })]);
    assert.equal(new Set(preparing).size, 2);
  } finally {
    clearTimeout(timer);
    release();
    await Promise.allSettled([first, second]);
  }
  assert.equal((await pool.status()).busy, 2);
  assert.equal((await pool.status()).idle, 0);
});

test('background reserve preparation never queues a ready submission or an original query', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  const spare = pool.state.profiles.filter(profile => profile.state === 'idle');
  for (const profile of spare.slice(1)) profile.state = 'cold';
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.probe = async () => { entered(); await gate; return { ready: true }; };
  const maintenance = pool.maintain();
  await started;
  let timer;
  try {
    const result = await Promise.race([
      Promise.all([pool.submit({ ...request, taskId: 'ready-during-maintenance' }), pool.query(original)]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('submission or query queued behind background warmup')), 500); }),
    ]);
    assert.notEqual(result[0].profileId, original.profileId);
    assert.equal(result[1].status, 'running');
  } finally {
    clearTimeout(timer); release(); await maintenance;
    await pool.tail;
  }
});

test('a new task prepares its own environment while every background warmup is still pending', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  const blocked = new Set(pool.state.profiles.slice(0, 2).map(profile => profile.id));
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.probe = async id => { if (blocked.has(id)) { entered(); await gate; } return { ready: true }; };
  const maintenance = pool.maintain();
  await started;
  let timer;
  try {
    const receipt = await Promise.race([pool.submit(request), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('task waited for unrelated warmup')), 500); })]);
    assert.equal(blocked.has(receipt.profileId), false);
    assert.equal((await pool.query(receipt)).status, 'running');
  } finally { clearTimeout(timer); release(); await maintenance; await pool.tail; }
});

test('cleaning all idle profiles never blocks original queries or newly submitted work', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.clear = async () => { entered(); await gate; };
  const cleaning = pool.clearAll();
  await started;
  let timer;
  try {
    const [receipt, result] = await Promise.race([
      Promise.all([pool.submit({ ...request, taskId: 'during-clear' }), pool.query(original)]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('task blocked by website cleanup')), 500); }),
    ]);
    assert.notEqual(receipt.profileId, original.profileId);
    assert.equal(result.status, 'running');
    assert.equal((await pool.query(receipt)).status, 'running');
  } finally { clearTimeout(timer); release(); await cleaning; await pool.tail; }
});

test('slow shutdown of a completed environment cannot block other task checkpoints or reuse that profile early', async t => {
  const { pool, calls } = await fixture(t, { query: async () => ({ status: 'failed', reason: 'fixture rejection' }) });
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.stop = async () => { entered(); await gate; };
  const ending = pool.query(original);
  await started;
  let timer;
  try {
    const receipt = await Promise.race([pool.submit({ ...request, taskId: 'during-shutdown' }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('checkpoint blocked by browser shutdown')), 500); })]);
    assert.notEqual(receipt.profileId, original.profileId);
    assert.deepEqual(calls.find(call => call[0] === 'submit' && call[2].taskId === 'during-shutdown')[2], { ...request, taskId: 'during-shutdown' });
  } finally { clearTimeout(timer); release(); await ending; await pool.tail; }
});

test('duplicate requests during cold preparation keep one original receipt and one generation', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.probe = async () => { entered(); await gate; return { ready: true }; };
  const first = pool.submit(request);
  await started;
  try {
    const receipt = await pool.submit(request);
    assert.equal((await pool.query(receipt)).status, 'preparing');
    await assert.rejects(pool.submit({ ...request, prompt: 'changed' }), /参数已改变/);
    assert.equal(calls.some(call => call[0] === 'submit'), false);
    release();
    assert.deepEqual(await first, receipt);
    assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
  } finally { release(); await first; }
});

test('more than 300 submissions all reach generation before any earlier submission completes', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const profiles = new Set();
  const { pool } = await fixture(t, { submit: async (id, input, persist) => {
    profiles.add(id);
    if (profiles.size === 320) entered();
    await gate;
    const checkpoint = { phase: 'accepted', workspaceId: 'workspace', itemId: input.taskId, requestId: input.taskId };
    await persist(checkpoint);
    return checkpoint;
  } });
  await pool.configure({ enabled: true });
  const submitting = Promise.all(Array.from({ length: 320 }, (_, index) => pool.submit({ ...request, taskId: 'all-inflight-' + index })));
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('batch waiting for another generation to finish')), 5000); })]);
    assert.equal((await pool.status()).busy, 320);
    assert.equal(profiles.size, 320);
  } finally { clearTimeout(timer); release(); await submitting; }
});

test('cleanup skips an environment reserved by a task still preparing its browser', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  for (const profile of pool.state.profiles) if (profile.state === 'idle') profile.state = 'cold';
  const id = pool.state.profiles[0].id;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  pool.engine.probe = async profileId => { if (profileId === id) { entered(); await gate; } return { ready: true }; };
  const submitting = pool.submit(request);
  await started;
  try {
    const result = await pool.clearAll();
    assert.equal(result.skipped, 1);
    assert.equal(calls.some(call => call[0] === 'clear' && call[1] === id), false);
    assert.equal((await pool.query(await pool.lookup(request.taskId))).status, 'preparing');
  } finally { release(); await submitting; }
});

test('a failed browser shutdown cannot return its profile to scheduling or overwrite the original result', async t => {
  const { pool } = await fixture(t, { query: async () => ({ status: 'failed', reason: 'original upstream failure' }), stop: async () => { throw Error('fixture process still running'); } });
  await pool.configure({ enabled: true });
  const original = await pool.submit(request);
  assert.deepEqual(await pool.query(original), { status: 'failed', reason: 'original upstream failure' });
  const profile = pool.state.profiles.find(value => value.id === original.profileId);
  assert.equal(profile.needsCleanup, true);
  assert.equal(profile.state, 'attention');
  pool.state.profiles.sort((left, right) => left.id === original.profileId ? -1 : right.id === original.profileId ? 1 : 0);
  const next = await pool.submit({ ...request, taskId: 'after-shutdown-failure' });
  assert.notEqual(next.profileId, original.profileId);
});

test('late submission acknowledgements cannot reset an already confirmed terminal result', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const { pool, directory } = await fixture(t, {
    submit: async (_id, input, persist) => {
      const checkpoint = { phase: 'accepted', workspaceId: 'workspace', itemId: input.taskId, requestId: input.taskId };
      await persist(checkpoint); entered(); await gate; return checkpoint;
    },
    query: async () => ({ status: 'failed', reason: 'original confirmed failure' }),
  });
  await pool.configure({ enabled: true });
  const submitting = pool.submit(request);
  await started;
  try {
    const receipt = await pool.lookup(request.taskId);
    assert.equal((await pool.query(receipt)).status, 'failed');
    release(); await submitting;
    assert.equal(pool.state.jobs[request.taskId].phase, 'failed');
    const restarted = new Pool(directory, {});
    assert.equal((await restarted.status()).busy, 0);
    assert.deepEqual(await restarted.query(receipt), { status: 'failed', reason: 'original confirmed failure' });
  } finally { release(); await submitting; }
});
