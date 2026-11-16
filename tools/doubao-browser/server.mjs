import { createInterface } from 'node:readline';
import path from 'node:path';
import { Pool } from './pool.mjs';
import { Engine } from './engine.mjs';
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw Error('缺少独立工作区目录');
const engine = new Engine(directory), pool = new Pool(directory, engine);
const methods = { status: () => pool.status(), configure: input => pool.configure(input), submit: input => pool.submit(input), query: input => pool.query(input), lookup: input => pool.lookup(input.taskId), clear: () => pool.clearAll(), open: input => pool.open(input.profileId) };
let maintaining = false;
const interval = setInterval(async () => { if (maintaining) return; maintaining = true; try { await pool.maintain(); } catch {} finally { maintaining = false; } }, 10000);
interval.unref();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async line => {
  let request;
  try {
    if (line.length > 280 * 1024 * 1024) throw Error('请求过大');
    request = JSON.parse(line);
    line = null;
    if (!Number.isSafeInteger(request.id) || !Object.hasOwn(methods, request.method)) throw Error('调用无效');
    const data = await methods[request.method](request.params || {});
    process.stdout.write(JSON.stringify({ id: request.id, data }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id: request?.id, error: error.message, beforeGeneration: request?.method === 'submit' && error.beforeGeneration === true }) + '\n'); }
});
lines.on('close', async () => { clearInterval(interval); await engine.close(); process.exit(0); });
process.on('SIGTERM', async () => { clearInterval(interval); await engine.close(); process.exit(0); });
