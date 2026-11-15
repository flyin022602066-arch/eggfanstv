import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
let server: ReturnType<typeof Bun.serve>;
let artifactDir: string;
beforeAll(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "beeftv-hanbao-"));
    const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/hanbao-harness.tsx")], target: "browser", define: {
        "process.env.NODE_ENV": "'production'", "import.meta.env": '{"DEV":false,"PROD":true,"MODE":"production","VITE_CANVAS_BACKEND_URL":"/api","VITE_CANVAS_LOCAL_MODE":"true"}', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": "'production'", "import.meta.env.VITE_CANVAS_BACKEND_URL": "'/api'", "__APP_VERSION__": "'hanbao-test'", "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "true",
    }, plugins: [{ name: "fixture", setup(builder) {
        builder.onResolve({ filter: /^virtual:beeftv-shiki-onig-wasm$/ }, () => ({ path: "shiki-fixture", namespace: "fixture" }));
        builder.onLoad({ filter: /^shiki-fixture$/, namespace: "fixture" }, () => ({ contents: "export default 'data:application/wasm;base64,AGFzbQEAAAA='", loader: "js" }));
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
        builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const path = resolve(import.meta.dir, "../src/styles/globals.css");
    const css = await postcss([tailwind()]).process(await Bun.file(path).text(), { from: path });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css.css, { headers: { "Content-Type": "text/css" } });
        return new Response('<html><head><title>BeefTV Hanbao Offline QA</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 60000);
afterAll(() => server?.stop(true));

test("Doubao browser pool supports enable, cleanup feedback and errors offline", async () => {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/doubao-browser-manager.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);
test("Hanbao per-account quota management selects and saves the clicked account visibly", async () => {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/hanbao-account-quota-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);
test("Hanbao settings save has persistent truthful feedback without losing edits", async () => {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/hanbao-save-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120000);
test("Hanbao model management, accounts and SMS work in dark/light desktop/mobile without upstream calls", async () => {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/hanbao-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120000);

test("Hanbao recovery shows actionable failures and queries the original task without generating", async () => {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/hanbao-recovery-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120000);
