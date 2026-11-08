import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("MV assets generate independently with face references and persistent image settings", async () => {
    const webDir = resolve(import.meta.dir, "..");
    const artifactDir = await mkdtemp(join(tmpdir(), "eggfans-mv-assets-"));
    const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixtures/suno-mv-layout-harness.tsx")], target: "browser",
        define: {
            "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"',
            "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "__APP_VERSION__": '"assets-test"',
            "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "false",
        },
        plugins: [{ name: "fixture-aliases", setup(builder) {
            builder.onResolve({ filter: /^@\/services\/suno-music-video$/ }, () => ({ path: join(import.meta.dir, "fixtures/suno-mv-asset-service.ts") }));
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalPath = join(webDir, "src/styles/globals.css");
    const globals = await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath });
    const css = [await Bun.file(join(webDir, "node_modules/antd/dist/reset.css")).text(), globals.css, await Bun.file(join(webDir, "src/pages/music/studio.css")).text(), await Bun.file(join(webDir, "src/components/image-size-picker.css")).text(), "html,body,#root,.fixture-shell{height:100%;margin:0}"].join("\n");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        return new Response('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
    try {
        const child = Bun.spawn([process.env.NODE_BINARY || "node", join(import.meta.dir, "fixtures/suno-mv-assets-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        console.log(stdout);
        if (code) throw new Error(stdout + stderr);
        expect(code).toBe(0);
    } finally { server.stop(true); }
}, 120000);
