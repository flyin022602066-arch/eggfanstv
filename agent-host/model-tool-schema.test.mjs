import { test, expect } from 'bun:test';
import { runDurableNodeCases } from './durable-node-test-runner.mjs';
import { adaptModelToolSchemas } from './model-tool-schema.mjs';

const options = { api: 'openai-completions', modelId: 'gemini-4-argon' };
const payload = parameters => ({ model: 'gemini-4-argon', messages: [{ role: 'user', content: 'Keep user content unchanged' }],
  tools: [{ type: 'function', function: { name: 'canvas_timeline_update', parameters } }] });

test('numeric version stays an integer fixed at 2 and the canonical schema is untouched', () => {
  const schema = { type: 'object', properties: { version: { type: 'integer', enum: [2] }, kind: { type: 'string', enum: ['video', 'audio'] } }, required: ['version'] };
  const original = payload(schema);
  const result = adaptModelToolSchemas(original, options);
  const projected = result.tools[0].function.parameters;
  expect(projected.properties.version).toEqual({ type: 'integer', minimum: 2, maximum: 2, description: 'Allowed values: 2.' });
  expect(projected.properties.kind).toEqual(schema.properties.kind);
  expect(projected.required).toEqual(['version']);
  expect(schema.properties.version).toEqual({ type: 'integer', enum: [2] });
  expect(result.messages).toBe(original.messages);
});

test('nested arrays and schema alternatives retain types, descriptions, and existing bounds', () => {
  const result = adaptModelToolSchemas(payload({ type: 'object', properties: {
    rows: { type: 'array', items: { anyOf: [{ type: 'integer', enum: [1, 2, 3], minimum: 2, description: 'Count' }, { type: 'boolean', enum: [true] }] } },
    enum: { type: 'string' },
  } }), options).tools[0].function.parameters;
  expect(result.properties.rows.items.anyOf).toEqual([
    { type: 'integer', minimum: 2, maximum: 3, description: 'Count Allowed values: 1, 2, 3.' },
    { type: 'boolean', description: 'Allowed values: true.' },
  ]);
  expect(result.properties.enum).toEqual({ type: 'string' });
});

test('Responses and Anthropic gateways project only function parameter schemas', () => {
  for (const [api, key] of [['openai-responses', 'parameters'], ['anthropic-messages', 'input_schema']]) {
    const request = { model: 'GEMINI-test', tools: [{ type: 'function', name: 'timeline', [key]: { type: 'integer', enum: [2] } }, { type: 'web_search' }] };
    const result = adaptModelToolSchemas(request, { api });
    expect(result.tools[0][key]).toEqual({ type: 'integer', minimum: 2, maximum: 2, description: 'Allowed values: 2.' });
    expect(result.tools[1]).toBe(request.tools[1]);
    expect(request.tools[0][key].enum).toEqual([2]);
  }
});

test('other models, unknown protocols and requests without tools pass through', () => {
  const request = payload({ type: 'integer', enum: [2] });
  for (const modelId of ['gpt-5', 'claude-test', 'deepseek-chat']) {
    expect(adaptModelToolSchemas(request, { ...options, modelId })).toBe(request);
  }
  expect(adaptModelToolSchemas(request, { ...options, api: 'unknown' })).toBe(request);
  const noTools = { model: 'gemini-test', messages: [] };
  expect(adaptModelToolSchemas(noTools, options)).toBe(noTools);
});

test('Gemini gateway accepts the real timeline schema and completes an asset tool turn', async () => {
  expect(await runDurableNodeCases('./model-tool-schema-cases.mjs')).toContain('fail 0');
}, 90000);
