import { afterAll, beforeAll, expect, test } from "bun:test";
let server: ReturnType<typeof Bun.serve>;
const timestamp = "2026-10-31T00:00:00.000Z";
const asset = (id: string, canvasId?: string) => ({ id, kind: "text", title: id, coverUrl: "", tags: [], category: "other", status: "confirmed", createdAt: timestamp, updatedAt: timestamp, data: { content: id }, metadata: canvasId ? { canvasId } : {} });
let deleted: string[] = [];
let failure = false;
let rows = [asset("A script", "canvas-a"), asset("A sibling", "canvas-a2"), asset("B script", "canvas-b"), asset("Public script")];
beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/canvas-library-harness.tsx"], target: "browser", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"' }, plugins: [{ name: "aliases", setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    server = Bun.serve({ port: 0, async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/fixture/reset") { rows = [asset("A script", "canvas-a"), asset("A sibling", "canvas-a2"), asset("B script", "canvas-b"), asset("Public script")]; deleted = []; failure = url.searchParams.has("failure"); return Response.json({ ok: true }); }
        if (path === "/fixture/state") return Response.json({ deleted });
        const json = (data: unknown) => Response.json({ code: 0, data, msg: "" });
        if (path.startsWith("/api/assets/") && request.method === "DELETE") {
            const id = decodeURIComponent(path.slice("/api/assets/".length));
            deleted.push(id);
            if (failure) return Response.json({ code: 409, data: null, reason: "asset_in_use", msg: "Fixture asset is referenced by canvas B" }, { status: 409 });
            rows = rows.filter((row) => row.id !== id);
            return json({});
        }
        if (path === "/api/assets") return json({ assets: rows, kindCounts: { all: rows.length, text: rows.length }, categoryCounts: { other: rows.length }, folderCounts: {}, favoriteTotal: 0, recentTotal: rows.length, projectCounts: {}, generatedTotal: 0, generatedKindCounts: {}, page: 1, pageSize: 100, total: rows.length, hasMore: false });
        if (path === "/api/asset-folders") return json({ folders: [] });
        if (path.startsWith("/api/")) return json([]);
        return new Response('<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 60000);
afterAll(() => server?.stop(true));
for (const mode of ["delete", "failure", "scope", "project-scope", "tray-scope", "mentions-scope"] as const) {
    test(`canvas library ${mode}`, async () => {
        const child = Bun.spawn(["node", import.meta.dir + "/fixtures/canvas-library-browser.mjs", server.url.toString(), mode], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (code) throw new Error(stdout + stderr);
        expect(code).toBe(0);
    }, 45000);
}
