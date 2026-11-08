import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;
let artifactDir: string;
beforeAll(async () => {
    const webDir = resolve(import.meta.dir, "..");
    artifactDir = await mkdtemp(join(tmpdir(), "eggfans-assets-layout-"));
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/assets-layout-harness.tsx")], target: "browser", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "__APP_VERSION__": '"layout-test"', "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "false" }, plugins: [{ name: "fixture-aliases", setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalPath = join(webDir, "src/styles/globals.css");
    const globalCss = await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath });
    const css = [await Bun.file(join(webDir, "node_modules/antd/dist/reset.css")).text(), globalCss.css, ...await Promise.all(["workspace-product.css", "assets-reference-baseline.css", "assets-frame-lock.css", "assets-final-lock.css", "beeftv-local-overrides.css"].map((file) => Bun.file(join(webDir, "src/styles", file)).text()))].join("\n");
    const timestamp = "2026-10-31T00:00:00.000Z";
    const rows = Array.from({ length: 18 }, (_, index) => ({ id: `fixture-${index}`, kind: index % 3 === 0 ? "text" : index % 3 === 1 ? "image" : "audio", title: `资产 ${String(index + 1).padStart(2, "0")} · 角色与场景参考`, coverUrl: index % 3 === 1 ? "/fixture-cover.svg" : "", tags: [], category: "other", status: "confirmed", source: "测试素材", createdAt: timestamp, updatedAt: timestamp, data: { content: "用于核对角色与场景的完整文本，列表与网格都应紧凑显示。", dataUrl: "/fixture-cover.svg", url: "/fixture-audio.mp3", width: 512, height: 384, bytes: 1024, mimeType: index % 3 === 2 ? "audio/mpeg" : "image/svg+xml" }, metadata: {} }));
    server = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        const json = (data: unknown) => Response.json({ code: 0, data, msg: "" });
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path === "/fixture-cover.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"><rect width="512" height="384" fill="#557688"/><circle cx="256" cy="150" r="70" fill="#d4bca0"/><path d="M140 384V270Q256 180 372 270V384" fill="#253e50"/></svg>', { headers: { "Content-Type": "image/svg+xml" } });
        if (path === "/api/assets") return json({ assets: rows, kindCounts: { all: 18, image: 6, audio: 6, text: 6 }, categoryCounts: { other: 18 }, folderCounts: {}, favoriteTotal: 0, recentTotal: 18, projectCounts: {}, generatedTotal: 0, generatedKindCounts: {}, page: 1, pageSize: 100, total: 18, hasMore: false });
        if (path === "/api/asset-folders") return json({ folders: [] });
        if (path.startsWith("/api/")) return json([]);
        return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 90000);
afterAll(() => server?.stop(true));

test("asset library stays compact and controls never overlap across widths and themes", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", join(import.meta.dir, "fixtures/assets-layout-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120000);
