function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = { ...schema };
  for (const key of ['properties', '$defs', 'definitions', 'patternProperties']) {
    if (schema[key] && typeof schema[key] === 'object') {
      result[key] = Object.fromEntries(Object.entries(schema[key]).map(([name, child]) => [name, geminiSchema(child)]));
    }
  }
  for (const key of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else']) {
    if (schema[key] && typeof schema[key] === 'object') {
      result[key] = Array.isArray(schema[key]) ? schema[key].map(geminiSchema) : geminiSchema(schema[key]);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    if (Array.isArray(schema[key])) result[key] = schema[key].map(geminiSchema);
  }
  if (Array.isArray(schema.enum) && schema.enum.some(value => typeof value !== 'string')) {
    delete result.enum;
    result.description = [schema.description, `Allowed values: ${schema.enum.map(value => JSON.stringify(value)).join(', ')}.`].filter(Boolean).join(' ');
    if (['integer', 'number'].includes(schema.type) && schema.enum.length && schema.enum.every(value => typeof value === 'number' && Number.isFinite(value))) {
      result.minimum = Math.max(schema.minimum ?? -Infinity, Math.min(...schema.enum));
      result.maximum = Math.min(schema.maximum ?? Infinity, Math.max(...schema.enum));
    }
  }
  return result;
}

export function adaptModelToolSchemas(payload, { api, modelId } = {}) {
  if (!/gemini/i.test(modelId || payload?.model || '') || !Array.isArray(payload?.tools)) return payload;
  if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(api)) return payload;
  const schemaKey = api === 'anthropic-messages' ? 'input_schema' : 'parameters';
  return { ...payload, tools: payload.tools.map(tool => {
    const definition = api === 'openai-completions' ? tool.function : tool;
    if (!definition?.[schemaKey]) return tool;
    const projected = { ...definition, [schemaKey]: geminiSchema(definition[schemaKey]) };
    return api === 'openai-completions' ? { ...tool, function: projected } : projected;
  }) };
}
