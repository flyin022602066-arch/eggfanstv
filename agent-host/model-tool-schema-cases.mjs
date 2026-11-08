import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const timelineSource = readFileSync(new URL('../backend/internal/operations/canvas_timeline.go', import.meta.url), 'utf8');
const timelineParameters = JSON.parse(/Params: json.RawMessage\(`([^`]+)`\)/.exec(timelineSource)[1]);

function hasNonStringEnum(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.enum) && value.enum.some(item => typeof item !== 'string')) return true;
  return Object.values(value).some(hasNonStringEnum);
}

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
async function readJSON(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

test('actual host sends Gemini-compatible tools while local timeline validation remains numeric', { timeout: 25000 }, async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'eggfans-gemini-tools-'));
  const requests = [];
  const operations = [];
  let child;
  let hostLog = '';
  const provider = createServer(async (request, response) => {
    const body = await readJSON(request);
    requests.push(body);
    if (hasNonStringEnum(body.tools)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: "Invalid value at 'tools[0].function_declarations[1].parameters.properties.timeline.properties.version.enum[0]' (TYPE_STRING), 2" } }));
      return;
    }
    const done = body.messages.some(message => message.role === 'tool');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (delta, finish = null) => response.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    frame(done ? { role: 'assistant', content: '素材已读取。' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'asset-call', type: 'function', function: { name: 'asset_get', arguments: '{"assetId":"fixture-asset"}' } }] });
    frame({}, done ? 'stop' : 'tool_calls');
    response.end('data: [DONE]\n\n');
  });
  const descriptors = [
    { id: 'asset.get', assistantModes: ['canvas', 'full-access'], replay: 'safe', readOnly: true, summary: 'Read asset', params: { type: 'object', properties: { assetId: { type: 'string' } }, required: ['assetId'] } },
    { id: 'canvas.timeline.update', assistantModes: ['canvas', 'full-access'], replay: 'safe', readOnly: false, summary: 'Update timeline', params: timelineParameters },
  ];
  const ops = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.headers['x-beeftv-agent-token'] !== 'fixture-host') {
      response.writeHead(403).end(JSON.stringify({ code: 403 }));
      return;
    }
    if (request.url === '/api/ops') {
      response.end(JSON.stringify({ code: 0, data: { ops: descriptors } }));
      return;
    }
    if (request.url.startsWith('/api/assistant/runtime/turns/')) {
      response.end(JSON.stringify({ code: 0, data: { turnId: 'fixture-turn', canvasId: 'fixture-canvas', permissionMode: 'canvas', open: true } }));
      return;
    }
    operations.push({ path: request.url, body: await readJSON(request) });
    response.end(JSON.stringify({ code: 0, data: { op: 'asset.get', result: { assetId: 'fixture-asset', asset: { id: 'fixture-asset', name: '女主素材' } } } }));
  });
  try {
    const providerPort = await listen(provider);
    const opsPort = await listen(ops);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, 'agent-host/server.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, BEEFTV_AGENT_DATA_DIR: scratch, BEEFTV_AGENT_PORT: String(port), BEEFTV_AGENT_HOST_TOKEN: 'fixture-host',
      BEEFTV_OPS_URL: `http://127.0.0.1:${opsPort}/api`, BEEFTV_AGENT_MODEL: 'gemini-4-argon', BEEFTV_AGENT_API: 'openai-completions',
      BEEFTV_AGENT_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, BEEFTV_AGENT_API_KEY: 'fixture-key', BEEFTV_AGENT_TOTAL_REQUEST_BUDGET: '0',
      BEEFTV_AGENT_READ_ONLY: '0', BEEFTV_AGENT_MAX_REQUESTS_PER_TURN: '4', BEEFTV_AGENT_MAX_TOOL_STEPS_PER_TURN: '4',
      BEEFTV_AGENT_LISTEN_FD: '', BEEFTV_AGENT_INSTANCE_NONCE: '', BEEFTV_AGENT_ALLOWED_ORIGIN: '', BEEFTV_AGENT_LIFETIME_STDIN: '',
    } });
    child.stdout.on('data', chunk => { hostLog += chunk; });
    child.stderr.on('data', chunk => { hostLog += chunk; });
    const deadline = Date.now() + 12000;
    let healthy = false;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, hostLog);
      try {
        if ((await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok) { healthy = true; break; }
      } catch {}
      await delay(100);
    }
    assert(healthy, hostLog);
    const response = await fetch(base + '/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Beeftv-Agent-Token': 'fixture-host' },
      body: JSON.stringify({ canvasId: 'fixture-canvas', turnId: 'fixture-turn', message: '读取女主素材', revisionBefore: 1, references: [{ kind: 'asset', id: 'fixture-asset' }] }), signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const end = body.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'turn_end');
    assert(end, body);
    assert.equal(end.error, null, JSON.stringify(end));
    assert.equal(end.reply, '素材已读取。');
    assert.equal(requests.length, 2);
    assert.equal(operations.length, 1, JSON.stringify({ end, tools: requests.map(request => request.tools) }));
    assert.deepEqual(operations[0], { path: '/api/ops/asset.get', body: { opId: '', params: { assetId: 'fixture-asset' } } });
    for (const request of requests) {
      const version = request.tools.find(tool => tool.function.name === 'canvas_timeline_update').function.parameters.properties.timeline.properties.version;
      assert.equal(version.type, 'integer');
      assert.equal(version.minimum, 2);
      assert.equal(version.maximum, 2);
      assert.equal(version.enum, undefined);
    }
    assert.deepEqual(timelineParameters.properties.timeline.properties.version, { type: 'integer', enum: [2] });
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill();
      await closed;
    }
    for (const server of [ops, provider]) {
      if (server.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
