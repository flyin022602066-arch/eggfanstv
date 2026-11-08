import { afterAll, beforeAll, expect, test } from "bun:test";
import type { BunPlugin } from "bun";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
    const plugins: BunPlugin[] = [
        {
            name: "test-source-alias",
            setup(builder) {
                builder.onResolve({ filter: /^@\// }, (args) => {
                    if (
                        args.path === "@/lib/media-metadata"
                        || args.path === "@/services/api/resources"
                        || args.path === "@/services/api/projects"
                        || args.path === "@/services/file-storage"
                    ) {
                        return { path: Bun.resolveSync("./fixtures/editor-asset-ingest-doubles.ts", import.meta.dir) };
                    }
                    return { path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) };
                });
                builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({
                    contents: "export default ''",
                    loader: "js",
                }));
            },
        },
    ];
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/editor-asset-ingest-harness.tsx"],
        plugins,
        target: "browser",
        define: {
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"',
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"',
            "import.meta.env.VITE_CANVAS_BACKEND_URL": '""',
            "process.env.NODE_ENV": '"production"',
        },
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs[0].text();
    const globalPath = join(import.meta.dir, "../src/styles/globals.css");
    const stylesheet = await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath });
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
            if (path === "/styles.css") return new Response(stylesheet.css, { headers: { "Content-Type": "text/css" } });
            return new Response(
                '<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/harness.js"></script></html>',
                { headers: { "Content-Type": "text/html" } },
            );
        },
    });
}, 60_000);
afterAll(() => server?.stop(true));

test("episode video library and import ownership browser regressions", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "eggfans-editor-library-"));
    const runnerPath = join(artifactDir, "browser.mjs");
    const source = await Bun.file(join(import.meta.dir, "fixtures/editor-asset-ingest-browser.ts")).text();
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
    await Bun.write(runnerPath, transpiler.transformSync(source).replace('from "playwright/test"', 'from ' + JSON.stringify(import.meta.resolve("playwright/test"))));
    const child = Bun.spawn([process.env.NODE_BINARY || "node", runnerPath, server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120_000);
