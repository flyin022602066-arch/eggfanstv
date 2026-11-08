import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let server: ReturnType<typeof Bun.serve>;
let artifactDir: string;
beforeAll(async () => {
    const webDir = resolve(import.meta.dir, "..");
    const artifactRoot = resolve(webDir, "../output/playwright");
    await mkdir(artifactRoot, { recursive: true });
    artifactDir = await mkdtemp(join(artifactRoot, "project-cover-"));
    const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixtures/project-cover-preview-harness.tsx")], target: "browser",
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "__APP_VERSION__": '"cover-test"', "__BEEFTV_HEAVY_MEDIA_ENABLED__": "false", "__BEEFTV_PACKAGED_WINDOWS__": "false" },
        plugins: [{ name: "fixture-aliases", setup(builder) {
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            // Bun does not expand Vite's optional model icon glob.
            builder.onLoad({ filter: /model-logo\.tsx$/ }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace('import.meta.glob("../../node_modules/@lobehub/icons/es/*/components/Mono.js", { import: "default" })', "{}"), loader: "tsx" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const globalPath = join(webDir, "src/styles/globals.css");
    const css = (await postcss([tailwind()]).process(await Bun.file(globalPath).text(), { from: globalPath })).css;
    const project = { id: "cover-project", userId: "local", name: "封面回归项目", type: "short-drama", aspectRatio: "16:9", sourceType: "blank", description: "", stylePresetId: "", coverResourceId: "generated-cover", status: "active", revision: 1, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
        const path = new URL(request.url).pathname;
        const json = (data: unknown) => Response.json({ code: 0, data, msg: "" });
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path.startsWith("/api/resources/")) {
            if (request.headers.get("X-Desktop-Token") !== "offline-cover-test") return new Response("desktop token required", { status: 401 });
            if (path.includes("missing-cover")) return new Response("missing resource", { status: 404 });
            const width = path.includes("replacement-cover") ? 640 : 320;
            return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="180"><rect width="100%" height="100%" fill="#557688"/><circle cx="160" cy="80" r="40" fill="#d4bca0"/></svg>`, { headers: { "Content-Type": "image/svg+xml" } });
        }
        if (path === "/api/projects") return json({ projects: [{ project, canvasCount: 0, assetCount: 0, unitCount: 0, completedUnitCount: 0 }], page: 1, pageSize: 50, total: 1, hasMore: false });
        if (path === "/api/projects/cover-project/assets") return json({ assets: [{ id: "library-image", title: "项目素材封面", mediaType: "image", category: "other", status: "confirmed", versionCount: 1, usages: [], storageKey: "resource:library-cover", updatedAt: project.updatedAt }], categoryCounts: {}, folderCounts: {}, unitCounts: {}, page: 1, pageSize: 40, total: 1, hasMore: false });
        if (path === "/api/project-folders") return json({ folders: [] });
        if (path.startsWith("/api/")) return new Response("unexpected test API request", { status: 500 });
        return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 90000);
afterAll(() => server?.stop(true));

test("project settings and library decode protected covers across themes and widths", async () => {
    const child = Bun.spawn([process.env.NODE_BINARY || "node", join(import.meta.dir, "fixtures/project-cover-preview-browser.mjs"), server.url.toString(), artifactDir], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    console.log(stdout);
    if (code) throw new Error(stdout + stderr);
    expect(code).toBe(0);
}, 120000);
