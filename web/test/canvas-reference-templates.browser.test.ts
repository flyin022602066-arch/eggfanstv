import { afterAll, beforeAll, expect, test } from 'bun:test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + '/fixtures/reference-template-harness.tsx'], target: 'browser', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'import.meta.env.VITE_CANVAS_LOCAL_MODE': '"false"', 'import.meta.env.VITE_CANVAS_BACKEND_URL': '"/api"' }, plugins: [{ name: 'aliases', setup(builder) {
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('../src/' + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /[\\/]model-logo\.tsx$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', '{}'), loader: 'tsx' }));
        builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: 'js' }));
    } }] });
    if (!build.success) throw new Error(build.logs.join('\n'));
    const scripts = new Map(await Promise.all(build.outputs.map(async output => [output.path.split('/').at(-1)!.split('\\').at(-1)!, await output.text()] as const)));
    const stylesheetPath = import.meta.dir + '/../src/styles/globals.css';
    const css = (await postcss([tailwind()]).process(await Bun.file(stylesheetPath).text(), { from: stylesheetPath })).css;
    server = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/styles.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
        const script = scripts.get(path.slice(1));
        if (script) return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
        if (path.startsWith('/api/')) return Response.json({ code: 0, data: [], msg: '' });
        return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reference template fixture</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/reference-template-harness.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } });
    } });
}, 60000);
afterAll(() => server?.stop(true));
test('reference template import, combination, apply, persistence and project isolation in both themes', async () => {
    const child = Bun.spawn(['node', import.meta.dir + '/fixtures/reference-template-browser.mjs', server.url.toString()], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    console.log(stdout.trim()); expect(code).toBe(0);
}, 120000);
