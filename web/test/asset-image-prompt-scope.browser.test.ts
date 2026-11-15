import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;
let artifactDir: string;
beforeAll(async () => {
    const artifactRoot = resolve(import.meta.dir, "../../output/playwright");
    await mkdir(artifactRoot, { recursive: true });
    artifactDir = await mkdtemp(join(artifactRoot, "asset-prompt-scope-"));
    const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "fixtures/asset-image-prompt-scope-harness.tsx")], target: "browser", define: {
        "process.env.NODE_ENV": "'production'", "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": "'production'", "import.meta.env.VITE_CANVAS_LOCAL_MODE": "'false'", "import.meta.env.VITE_CANVAS_BACKEND_URL": "'/api'", "__APP_VERSION__": "'prompt-scope-test'", "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "false",
    }, plugins: [{ name: "prompt-scope-fixture", setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
        builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalPath = resolve(import.meta.dir, "../src/styles/globals.css");
    const css = (await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath })).css;
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path.startsWith("/api/")) return new Response("unexpected offline API", { status: 500 });
        return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 90000);
afterAll(() => server?.stop(true));
for (const scenario of ["isolation", "single-look", "legacy"]) {
    test(`asset supplements ${scenario} stay scoped in Chromium`, async () => {
        const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/asset-image-prompt-scope-browser.mjs"), server.url.toString(), artifactDir, scenario], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        console.log(stdout);
        if (code) throw new Error(stdout + stderr);
        expect(code).toBe(0);
    }, 90000);
}
