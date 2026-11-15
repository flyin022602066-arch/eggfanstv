import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool, MODELS, validateRequest } from './pool.mjs';

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

test('enable maintains exactly 100 environments and two warm idle pages', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const status = await pool.status();
  assert.equal(status.profiles.length, 100);
  assert.equal(new Set(status.profiles.map(p => p.id)).size, 100);
  assert.equal(status.idle, 2);
  assert.equal(calls.filter(c => c[0] === 'probe').length, 2);
});

test('automatic names are unique across pools and stable after restart and cleanup', async t => {
  const first = await fixture(t), second = await fixture(t);
  await first.pool.configure({ enabled: true });
  await second.pool.configure({ enabled: true });
  const profiles = (await first.pool.status()).profiles;
  const names = profiles.map(profile => profile.label);
  assert.equal(new Set([...names, ...(await second.pool.status()).profiles.map(profile => profile.label)]).size, 200);
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
  assert.equal(new Set(profiles.map(profile => profile.label)).size, 100);
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
    assert.equal(status.total, 100);
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

test('accepted task keeps two other idle environments and preserves all parameters', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.equal(receipt.taskId, 'fixture-task');
  assert.equal((await pool.status()).idle, 2);
  assert.deepEqual(calls.find(c => c[0] === 'submit')[2], request);
  assert.equal((await pool.status()).busy, 1);
});

test('replacement is ready before reservation consumes an idle environment', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  pool.engine.probe = async () => {
    assert.equal((await pool.status()).idle, 2);
    assert.equal((await pool.status()).busy, 0);
    return { ready: false };
  };
  await assert.rejects(pool.submit(request), /空闲环境不足/);
  assert.equal((await pool.status()).idle, 2);
  assert.equal((await pool.status()).busy, 0);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 0);
  for (const profile of pool.state.profiles) if (profile.state === 'attention') profile.checkedAt = new Date(0).toISOString();
  pool.engine.probe = async () => {
    assert.equal((await pool.status()).idle, 2);
    assert.equal((await pool.status()).busy, 0);
    return { ready: true };
  };
  await pool.submit(request);
  assert.equal((await pool.status()).idle, 2);
  assert.equal((await pool.status()).busy, 1);
});

test('replacement skips unready environments and continues to an unused ready candidate', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  let attempts = 0;
  pool.engine.probe = async () => ({ ready: ++attempts > 2 });
  const receipt = await pool.submit(request);
  assert.equal(attempts, 3);
  assert.equal((await pool.status()).idle, 2);
  assert.equal((await pool.status()).busy, 1);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
  assert.equal(receipt.taskId, request.taskId);
});

test('a failed replacement after five submissions does not exhaust the other unused environments', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = [];
  for (let index = 0; index < 5; index++) receipts.push(await pool.submit({ ...request, taskId: 'first-five-' + index }));
  let attempts = 0;
  pool.engine.probe = async () => ({ ready: ++attempts > 2 });
  receipts.push(await pool.submit({ ...request, taskId: 'sixth-task' }));
  assert.equal(new Set(receipts.map(receipt => receipt.profileId)).size, 6);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 6);
  assert.equal((await pool.status()).idle, 2);
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
  await assert.rejects(restarted.query(receipt), /未确认/);
  restarted.engine.clear = async () => {};
  assert.equal((await restarted.clearAll()).skipped, 1);
  assert.equal((await restarted.status()).busy, 1);
});

test('batch clear skips unfinished tasks and cleans the remaining environments', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipt = await pool.submit(request);
  assert.equal((await pool.clearAll()).skipped, 1);
  assert.equal(calls.filter(c => c[0] === 'clear').length, 99);
  assert.equal(calls.some(c => c[0] === 'clear' && c[1] === receipt.profileId), false);
});

test('clear reports real results and never claims a server quota reset', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const result = await pool.clearAll();
  assert.equal(result.cleared, 100);
  assert.equal(calls.filter(c => c[0] === 'clear').length, 100);
  assert.equal(result.quotaResetConfirmed, false);
  assert.equal((await pool.status()).profiles.length, 100);
  assert.equal((await pool.status()).idle, 2);
});

test('failed cleanup is reported, not counted as successful', async t => {
  let n = 0;
  const { pool } = await fixture(t, { clear: async () => { if (++n === 1) throw Error('locked'); } });
  await pool.configure({ enabled: true });
  const result = await pool.clearAll();
  assert.equal(result.cleared, 99);
  assert.equal(result.failed.length, 1);
});

test('capacity and account readiness are never invented after a failed probe', async t => {
  const { pool } = await fixture(t, { probe: async () => ({ ready: false, reason: '需要登录' }) });
  await pool.configure({ enabled: true });
  assert.equal((await pool.status()).idle, 0);
  await assert.rejects(pool.submit(request), /空闲/);
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

test('concurrent tasks reserve distinct environments and preserve two idle', async t => {
  const { pool } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = await Promise.all(Array.from({ length: 4 }, (_, index) => pool.submit({ ...request, taskId: 'parallel-' + index })));
  assert.equal(new Set(receipts.map(r => r.profileId)).size, 4);
  assert.equal((await pool.status()).idle, 2);
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
  for (let index = 0; index < 120; index++) {
    const receipt = await pool.submit({ ...request, taskId: 'once-only-' + index });
    original ||= receipt;
    await pool.query(receipt);
    await pool.delivered(receipt);
  }
  const submitted = calls.filter(call => call[0] === 'submit');
  assert.equal(submitted.length, 120);
  assert.equal(new Set(submitted.map(call => call[1])).size, 100);
  assert.ok((await pool.status()).profiles.filter(profile => profile.state === 'used').length < 100);
  assert.equal((await pool.status()).idle, 2);
  assert.equal((await pool.status()).succeeded, 120);
  assert.deepEqual(await new Pool(pool.directory, {}).lookup(original.taskId), original);
  assert.equal((await new Pool(pool.directory, {}).status()).total, 100);
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
  assert.equal((await restarted.status()).active, 100);
  assert.equal((await restarted.status()).busy, 2);
  assert.equal((await restarted.status()).idle, 2);
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
  assert.equal((await pool.status()).idle, 2);
});

test('100-environment capacity never consumes the last two idle environments', async t => {
  const { pool, calls } = await fixture(t);
  await pool.configure({ enabled: true });
  const receipts = await Promise.all(Array.from({ length: 98 }, (_, index) => pool.submit({ ...request, taskId: 'capacity-' + index })));
  assert.equal(new Set(receipts.map(receipt => receipt.profileId)).size, 98);
  assert.equal((await pool.status()).total, 100);
  assert.equal((await pool.status()).busy, 98);
  assert.equal((await pool.status()).idle, 2);
  await assert.rejects(pool.submit({ ...request, taskId: 'capacity-overflow' }), /空闲环境/);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 98);
  assert.equal((await pool.status()).idle, 2);
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
