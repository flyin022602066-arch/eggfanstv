// Explicit local-only smoke: no provider navigation or generation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from './engine.mjs';
const directory = await mkdtemp(path.join(tmpdir(), 'eggfans-browser-smoke-'));
const engine = new Engine(directory, { home: 'about:blank', offline: true });
try {
  const id = randomUUID();
  const [first, second] = await Promise.all([engine.browser(id), engine.browser(id)]);
  assert.equal(first, second);
  assert.equal(await engine.evaluate(id, () => location.href), 'about:blank');
  await engine.stop(id);
  await mkdir(path.join(engine.profile(id), 'Default', 'Local Storage'), { recursive: true });
  await writeFile(path.join(engine.profile(id), 'Default', 'Local Storage', 'fixture-site-data'), 'fixture');
  await writeFile(path.join(engine.profile(id), 'fixture-environment-config'), 'preserve');
  await writeFile(path.join(directory, 'fixture-outside-profile'), 'preserve');
  await engine.clear(id);
  await assert.rejects(readFile(path.join(engine.profile(id), 'Default', 'Local Storage', 'fixture-site-data')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(engine.profile(id), 'fixture-environment-config'), 'utf8'), 'preserve');
  assert.ok((await readdir(directory)).includes('fixture-outside-profile'));
  console.log('Local CDP pipe, concurrent initialization, shutdown and dedicated-profile cleanup passed.');
} finally { await engine.close(); await rm(directory, { recursive: true, force: true }); }
