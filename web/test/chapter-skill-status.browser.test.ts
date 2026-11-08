import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const webDir = resolve(import.meta.dir, "..");
    const build = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "fixtures/chapter-skill-status-harness.tsx")],
        target: "browser",
        define: {
            "process.env.NODE_ENV": "'production'",
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": "'production'",
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": "'false'",
            "import.meta.env.VITE_CANVAS_BACKEND_URL": "'/api'",
            "__APP_VERSION__": "'skill-status-test'",
            "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false",
            "__BEEFTV_PACKAGED_WINDOWS__": "false",
        },
        plugins: [{ name: "fixture-aliases", setup(builder) {
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalsPath = resolve(webDir, "src/styles/globals.css");
    const globals = await postcss([tailwind()]).process(await Bun.file(globalsPath).text(), { from: globalsPath });
    const reset = await Bun.file(resolve(webDir, "node_modules/antd/dist/reset.css")).text();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(reset + "\n" + globals.css + "\nhtml,body,#root{min-height:100%;margin:0}", { headers: { "Content-Type": "text/css" } });
        if (path.startsWith("/api/")) return Response.json({ code: 0, data: [], msg: "" });
        return new Response("<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/styles.css'></head><body><div id='root'></div><script type='module' src='/harness.js'></script></body></html>", { headers: { "Content-Type": "text/html" } });
    } });
}, 90000);

afterAll(() => server?.stop(true));

test("skill outcomes survive refresh, update from tasks, and stay readable across themes and sizes", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/chapter-skill-status-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);
