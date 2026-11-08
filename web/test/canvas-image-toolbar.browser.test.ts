import { afterAll, beforeAll, expect, test } from "bun:test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/canvas-image-toolbar-harness.tsx"], target: "browser",
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"' },
        plugins: [{ name: "aliases", setup(builder) {
            builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /[\\/]model-logo\.tsx$/ }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const stylesheet = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind()]).process(await Bun.file(stylesheet).text(), { from: stylesheet })).css;
    server = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path.startsWith("/api/")) return Response.json({ code: 0, data: [], msg: "" });
        return new Response('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 60000);
afterAll(() => server?.stop(true));

test("Agent state must not disable selected image actions", async () => {
    const source = await Bun.file(import.meta.dir + "/../src/pages/canvas/project.tsx").text();
    const start = source.indexOf("<CanvasNodeToolbar\n");
    expect(source.slice(start, source.indexOf("workspaceMode={workspaceMode}", start))).not.toContain("assistant.open");
});

test("image tools and settings survive selection, Agent, resizing and popover unmount", async () => {
    const child = Bun.spawn(["node", import.meta.dir + "/fixtures/canvas-image-toolbar-browser.mjs", server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    console.log(stdout.trim());
    expect(code).toBe(0);
}, 90000);
