import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Engine } from './engine.mjs';
import { Pool, validateRequest } from './pool.mjs';

test('a broken CDP read pipe rejects its task without crashing the shared worker', async () => {
  const source = await readFile(new URL('./engine.mjs', import.meta.url), 'utf8');
  const definition = source.slice(source.indexOf('class Pipe {'), source.indexOf('// Executed in the originating'));
  const Pipe = vm.runInNewContext(definition + '; Pipe', { Buffer, setTimeout, clearTimeout });
  const child = new EventEmitter();
  child.stdio = Array.from({ length: 5 }, () => new PassThrough());
  const pipe = new Pipe(child);
  const pending = pipe.call('fixture', {}, undefined, 1000);
  const rejection = assert.rejects(pending, /断开/);
  assert.doesNotThrow(() => child.stdio[4].emit('error', Object.assign(Error('fixture'), { code: 'ECONNRESET' })));
  await rejection;
  await assert.rejects(pipe.call('fixture', {}, undefined, 10), /断开/);
});

test('staged references load original bytes lazily and reject foreign paths and tampering', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-transport-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('original image bytes');
  await mkdir(path.join(directory, '.submit-123'));
  await writeFile(path.join(directory, '.submit-123', '0.png'), bytes);
  const reference = { file: '.submit-123/0.png', mime: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const request = { taskId: 'fixture', model: 'seedance_v2.0', prompt: 'fixture', duration: 5, ratio: '16:9', images: [reference] };
  assert.doesNotThrow(() => validateRequest(request));
  const engine = new Engine(directory);
  assert.equal(await engine.referenceImage(reference), 'data:image/png;base64,' + bytes.toString('base64'));
  await assert.rejects(engine.referenceImage({ ...reference, file: '../outside.png' }));
  await assert.rejects(engine.referenceImage({ ...reference, sha256: '0'.repeat(64) }));
  await writeFile(path.join(directory, 'private.txt'), bytes);
  await symlink(path.join(directory, 'private.txt'), path.join(directory, '.submit-123', '1.png'));
  await assert.rejects(engine.referenceImage({ ...reference, file: '.submit-123/1.png' }));
});

test('different staging directories cannot resubmit an identical task or change reference ordering', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-staged-pool-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let submissions = 0;
  const engine = { probe: async () => ({ ready: true }), submit: async (_id, input) => { submissions++; assert.deepEqual(input.images.map(value => value.sha256), ['a'.repeat(64), 'b'.repeat(64)]); return { phase: 'accepted', requestId: 'original' }; } };
  const pool = new Pool(directory, engine);
  await pool.configure({ enabled: true });
  const request = { taskId: 'original', model: 'seedance_v2.0', prompt: '{{ref:1}} {{ref:2}}', duration: 5, ratio: '16:9', images: ['a', 'b'].map((value, index) => ({ file: '.submit-first/' + index + '.png', mime: 'image/png', bytes: 100, sha256: value.repeat(64) })) };
  const original = await pool.submit(request);
  const retry = { ...request, images: request.images.map(value => ({ ...value, file: value.file.replace('first', 'second') })) };
  assert.deepEqual(await new Pool(directory, engine).submit(retry), original);
  assert.equal(submissions, 1);
  await assert.rejects(pool.submit({ ...retry, images: [...retry.images].reverse() }), /参数已改变/);
});
