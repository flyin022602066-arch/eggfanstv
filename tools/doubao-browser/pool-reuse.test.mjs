import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool, TARGET } from './pool.mjs';

const request = { taskId: 'first', model: 'seedance_v2.5', prompt: 'fixture', duration: 5, ratio: '16:9', images: [] };
async function fixture(t, patch = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-reuse-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cleared = [], submitted = [];
  const engine = {
    probe: async () => ({ ready: true }),
    submit: async (id, input) => { submitted.push([id, input.taskId]); return { workspaceId: 'workspace', itemId: 'item', requestId: 'request' }; },
    query: async () => ({ status: 'failed', reason: '审核不通过' }),
    clear: async id => { cleared.push(id); },
    stop: async () => {},
    ...patch,
  };
  const pool = new Pool(directory, engine);
  await pool.configure({ enabled: true });
  return { pool, directory, engine, cleared, submitted };
}

test('confirmed failure returns its environment without claiming successful use, including after restart', async t => {
  const { pool, directory, engine } = await fixture(t);
  const receipt = await pool.submit(request);
  await pool.query(receipt);
  const status = await pool.status();
  assert.equal(status.used, 0);
  assert.equal(status.failed, 1);
  assert.equal(status.profiles.find(profile => profile.id === receipt.profileId).usedTaskId, undefined);
  const restarted = new Pool(directory, engine);
  assert.equal((await restarted.status()).used, 0);
  await restarted.submit({ ...request, taskId: 'second' });
  assert.equal((await restarted.query(receipt)).status, 'failed');
  assert.equal((await restarted.status()).busy, 1);
});

test('pre-generation failure also returns its environment but preserves the original failed receipt', async t => {
  const { pool } = await fixture(t, { submit: async () => { throw Object.assign(Error('upload failed'), { beforeGeneration: true }); } });
  await assert.rejects(pool.submit(request), /upload failed/);
  const receipt = await pool.lookup(request.taskId);
  assert.equal((await pool.query(receipt)).status, 'failed');
  assert.equal((await pool.status()).used, 0);
  assert.equal((await pool.status()).busy, 0);
});

test('cleanup skips an unknown submission instead of blocking or deleting the whole pool', async t => {
  const { pool, cleared } = await fixture(t, { submit: async () => { throw Error('lost reply'); } });
  const receipt = await pool.submit(request);
  const result = await pool.clearAll();
  assert.equal(result.cleared, TARGET - 1);
  assert.equal(result.skipped, 1);
  assert.equal(cleared.includes(receipt.profileId), false);
  assert.equal((await pool.status()).busy, 1);
  assert.deepEqual(await pool.lookup(request.taskId), receipt);
});

test('successful video waiting for local delivery cannot be cleaned', async t => {
  const { pool, cleared } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  const receipt = await pool.submit(request);
  await pool.query(receipt);
  assert.equal((await pool.status()).pending, 1);
  const result = await pool.clearAll();
  assert.equal(result.skipped, 1);
  assert.equal(cleared.includes(receipt.profileId), false);
  await assert.rejects(pool.delivered({ ...receipt, profileId: 'foreign' }), /匹配/);
});

test('verified local delivery allows cleanup and restores availability durably without losing results', async t => {
  const { pool, directory, engine } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  const receipt = await pool.submit(request);
  await pool.query(receipt);
  await pool.delivered(receipt);
  assert.equal((await pool.status()).pending, 0);
  const result = await pool.clearAll();
  assert.equal(result.cleared, TARGET);
  assert.equal(result.skipped, 0);
  assert.equal((await pool.status()).used, 0);
  const restarted = new Pool(directory, engine);
  const profile = (await restarted.status()).profiles.find(value => value.id === receipt.profileId);
  assert.equal(profile.usedTaskId, undefined);
  assert.equal(profile.state, 'cold');
  assert.equal((await restarted.query(receipt)).status, 'success');
  assert.equal((await restarted.status()).used, 0);
  assert.equal((await restarted.status()).succeeded, 1);
});

test('legacy failed jobs are repaired without releasing an active task or successful undelivered result', async t => {
  const { pool, directory, engine } = await fixture(t);
  const state = JSON.parse(await readFile(path.join(directory, 'pool.json'), 'utf8'));
  delete state.lifecycleVersion;
  for (const [index, profile] of state.profiles.entries()) {
    if (index >= 98) continue;
    const taskId = 'history-' + index;
    profile.state = index === 0 ? 'busy' : 'used'; profile.usedTaskId = taskId;
    state.jobs[taskId] = { profileId: profile.id, phase: index === 0 ? 'accepted' : index < 24 ? 'success' : 'failed', receipt: { taskId, profileId: profile.id } };
  }
  await writeFile(path.join(directory, 'pool.json'), JSON.stringify(state));
  const restarted = new Pool(directory, engine);
  const status = await restarted.status();
  assert.equal(status.busy, 1);
  assert.equal(status.pending, 23);
  assert.equal(status.failed, 74);
  assert.equal(status.used, 23);
  assert.equal(status.profiles.filter(profile => profile.usedTaskId).length, 24);
  await restarted.clearAll();
  assert.equal((await restarted.status()).pending, 23);
  assert.equal((await restarted.status()).busy, 1);
});

test('automatic low-water cleanup reuses completed delivered environments but never pending deliveries', async t => {
  const { pool, cleared } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  const identities = [];
  for (let index = 0; index < TARGET + 5; index++) {
    const receipt = await pool.submit({ ...request, taskId: 'rotation-' + index });
    identities.push(receipt.profileId);
    await pool.query(receipt);
    await pool.delivered(receipt);
  }
  assert.equal(new Set(identities).size, TARGET);
  assert.equal((await pool.status()).total, TARGET);
  assert.ok(cleared.length > 0);
  assert.equal((await pool.status()).succeeded, TARGET + 5);
});

test('cleanup failure never returns a dirty environment to scheduling', async t => {
  const { pool } = await fixture(t);
  const failedId = pool.state.profiles[0].id;
  pool.engine.clear = async id => { if (id === failedId) throw Error('locked'); };
  const result = await pool.clearAll();
  assert.deepEqual(result.failed, [failedId]);
  await pool.maintain();
  const profile = (await pool.status()).profiles.find(value => value.id === failedId);
  assert.equal(profile.state, 'attention');
  assert.equal(profile.needsCleanup, true);
});

test('backend delivery markers release only confirmed successful tasks before clearing', async t => {
  const { pool, directory, cleared } = await fixture(t, { query: async () => ({ status: 'success', videoUrl: 'https://v.douyinvod.com/fixture.mp4' }) });
  const receipt = await pool.submit(request);
  await pool.query(receipt);
  await mkdir(path.join(directory, 'deliveries'));
  await writeFile(path.join(directory, 'deliveries', receipt.taskId + '.json'), JSON.stringify({ taskId: 'foreign', delivered: true }));
  assert.equal((await pool.clearAll()).skipped, 1);
  assert.equal(cleared.includes(receipt.profileId), false);
  await writeFile(path.join(directory, 'deliveries', receipt.taskId + '.json'), JSON.stringify({ taskId: receipt.taskId, delivered: true }));
  assert.equal((await pool.clearAll()).skipped, 0);
  assert.equal(cleared.includes(receipt.profileId), true);
  assert.equal((await pool.status()).used, 0);
});

test('a late old-task query cannot free or stop the same profile assigned to a new task', async t => {
  let enter, release, queried = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const stopped = [];
  const { pool } = await fixture(t, {
    query: async () => { if (++queried === 1) { enter(); await gate; } return { status: 'failed', reason: 'original failed' }; },
    stop: async id => { stopped.push(id); },
  });
  const receipt = await pool.submit(request);
  const late = pool.query(receipt);
  await entered;
  await pool.query(receipt);
  pool.state.profiles.sort((left, right) => left.id === receipt.profileId ? -1 : right.id === receipt.profileId ? 1 : 0);
  const profile = pool.state.profiles.find(value => value.id === receipt.profileId); profile.state = 'idle';
  const next = await pool.submit({ ...request, taskId: 'same-environment-new-task' });
  assert.equal(next.profileId, receipt.profileId);
  stopped.length = 0;
  release(); await late;
  assert.equal(profile.state, 'busy');
  assert.equal(profile.taskId, next.taskId);
  assert.deepEqual(stopped, []);
});

test('one returned failure stays reusable across more than 300 total failed generations', async t => {
  const { pool, submitted } = await fixture(t);
  for (let index = 0; index < TARGET + 5; index++) {
    const receipt = await pool.submit({ ...request, taskId: 'failed-rotation-' + index });
    await pool.query(receipt);
  }
  assert.equal(submitted.length, TARGET + 5);
  assert.equal(new Set(submitted.map(([id]) => id)).size, TARGET);
  assert.equal((await pool.status()).used, 0);
  assert.equal((await pool.status()).busy, 0);
  assert.equal((await pool.status()).failed, TARGET + 5);
});

test('invalid persisted task identity cannot escape the delivery marker directory', async t => {
  const { pool, directory } = await fixture(t);
  pool.state.jobs['../escape'] = { profileId: pool.state.profiles[0].id, phase: 'success' };
  await pool.save();
  await assert.rejects(new Pool(directory, {}).status(), /任务.*无效/);
});
