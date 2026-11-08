import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "fixtures/project-workspace-read-harness.tsx")],
        target: "browser",
        define: {
            "process.env.NODE_ENV": "'production'", "import.meta.env.DEV": "false", "import.meta.env.PROD": "true",
            "import.meta.env.MODE": "'production'", "import.meta.env.VITE_CANVAS_LOCAL_MODE": "'true'",
            "import.meta.env.VITE_CANVAS_BACKEND_URL": "'/api'", "__APP_VERSION__": "'project-read-test'",
            "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "true",
        },
        plugins: [{ name: "project-read-fixture", setup(builder) {
            builder.onResolve({ filter: /^\.\/detail\/(assets|canvases|chapters|overview|settings|editor)$/ }, () => ({ path: resolve(import.meta.dir, "fixtures/project-read-stub-view.tsx") }));
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        if (new URL(request.url).pathname === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        return new Response("<html><meta charset='utf-8'><div id='root'></div><script type='module' src='/harness.js'></script></html>", { headers: { "Content-Type": "text/html" } });
    } });
}, 60_000);
afterAll(() => server?.stop(true));

test("project reads survive transient refresh failures while real access failures remain blocking", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/project-workspace-read-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 90_000);
