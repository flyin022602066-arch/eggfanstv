import { afterAll, beforeAll, expect, test } from "bun:test";
let server: ReturnType<typeof Bun.serve>;
const resourceReads: string[] = [];
let unauthorizedReads = 0;
let videoReads = 0;
let writes = 0;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/canvas-asset-reopen-harness.tsx"], target: "browser",
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"false"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"' },
        plugins: [{ name: "assets", setup(builder) {
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    server = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (request.method !== "GET") writes += 1;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/original-video.mp4" || path === "/api/resources/video/file") { videoReads += 1; return new Response("unexpected video download", { status: 400 }); }
        if (path.startsWith("/api/resources/") && path.endsWith("/file")) {
            if (request.headers.get("X-Desktop-Token") !== "reopened-desktop-token") { unauthorizedReads += 1; return new Response("unauthorized", { status: 401 }); }
            resourceReads.push(path);
            return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>', { headers: { "Content-Type": "image/svg+xml" } });
        }
        if (path.startsWith("/api/")) return Response.json({ code: 0, data: [], msg: "" });
        return new Response('<html><head><meta charset="utf-8"><style>body{margin:0}.cached-resource-image-shell{display:inline-flex;min-width:64px;min-height:44px}img{max-width:100%}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
    } });
}, 60000);

afterAll(() => { server?.stop(true); });

for (const surface of ["character", "mentions", "search"] as const) {
    test(`${surface} restores authenticated asset previews after reopening a saved canvas`, async () => {
        resourceReads.length = unauthorizedReads = videoReads = writes = 0;
        // Run Playwright in Node: Bun on Windows can stall on its browser pipe.
        const child = Bun.spawn(["node", import.meta.dir + "/fixtures/canvas-asset-reopen-browser.mjs", server.url.toString(), surface], { stdout: "pipe", stderr: "pipe" });
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (exitCode) throw new Error(stdout + stderr);
        expect(resourceReads).toContain("/api/resources/character-cover/file");
        expect(unauthorizedReads).toBe(0);
        expect(videoReads).toBe(0);
        expect(writes).toBe(0);
    }, 45000);
}
