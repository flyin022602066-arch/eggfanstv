import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [resolve(import.meta.dir, "fixtures/workflow-preview-selection-harness.tsx")],
        target: "browser",
        define: {
            "process.env.NODE_ENV": "'production'",
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": "'production'",
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": "'false'",
            "import.meta.env.VITE_CANVAS_BACKEND_URL": "'/api'",
            "__APP_VERSION__": "'preview-selection-test'",
            "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false",
            "__BEEFTV_PACKAGED_WINDOWS__": "false",
        },
        plugins: [{ name: "fixture-aliases", setup(builder) {
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalPath = resolve(import.meta.dir, "../src/styles/globals.css");
    const globalCss = await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath });
    const episodeCss = await Bun.file(resolve(import.meta.dir, "../node_modules/antd/dist/reset.css")).text() + "\n" + globalCss.css + "\n" + await Bun.file(resolve(import.meta.dir, "../src/pages/projects/detail/workflow.css")).text();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/episode-download.css") return new Response(episodeCss, { headers: { "Content-Type": "text/css" } });
        if (path === "/workflow.css") return new Response(Bun.file(resolve(import.meta.dir, "../src/pages/projects/detail/workflow.css")), { headers: { "Content-Type": "text/css" } });
        return new Response("<html><head><meta charset='utf-8'></head><body><div id='root'></div><script type='module' src='/harness.js'></script></body></html>", { headers: { "Content-Type": "text/html" } });
    } });
}, 60000);

afterAll(() => server?.stop(true));

test("completed shots never regress to historical pending tasks after refresh or local stop", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-state-reconciliation-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("episode progress, browser stages and failed-video retries remain accurate without live providers", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-progress-retry-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("episode-download saves ordered original videos in one ZIP without generation requests", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-unit-video-download-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("automatic prompt repair displays the actual full submission and protects later manual edits", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-prompt-repair-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("manual final prompt survives failures and reloads and reaches the actual task payload unchanged", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-final-prompt-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("camera language displays authored or recovered settings without leaking across shots", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-camera-language-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("video preview isolates shot tasks and keeps asset diagnostics out of the final prompt", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-preview-selection-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("portrait and landscape videos remain complete in the preview and native fullscreen", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-video-aspect-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("failed video queries remain visible without a receipt and never create another task", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-video-query-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("Hanbao video ratio remembers the last project selection across chapters and reloads", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-video-ratio-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("manual asset removal survives reload, chapter repair and the actual video submission payload", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-asset-removal-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);

test("merged props reach the actual video submission with only the retained image and matching prompt numbering", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/workflow-prop-merge-browser.mjs"), server.url.toString()], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 60000);
