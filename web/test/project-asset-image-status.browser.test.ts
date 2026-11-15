import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("image retrieval status is visible, collapsed logs stay optional, and query-only checks survive disconnection", async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/project-asset-image-status-harness.tsx"], target: "browser", define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"' }, plugins: [{ name: "alias", setup(builder) { builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) })); } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs[0].text();
    const stylePath = resolve(import.meta.dir, "../src/styles/globals.css");
    const css = (await postcss([tailwind()]).process(await Bun.file(stylePath).text(), { from: stylePath })).css;
    const calls: string[] = [];
    const server = Bun.serve({ port: 0, async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
        if (path === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
        if (path.startsWith("/api/")) {
            calls.push(`${request.method} ${path}`);
            if (path === "/api/tasks/interrupted/recover-image-result" && request.method === "POST") {
                await Bun.sleep(200);
                return Response.json({ code: 0, data: { task: {}, status: "unavailable", recovered: false, message: "未保留完整图片结果，无法补查；不会重新提交生成。" }, msg: "" });
            }
            return new Response("unexpected API", { status: 500 });
        }
        return new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel=stylesheet href=/styles.css><div id=root></div><script type=module src=/harness.js></script>', { headers: { "Content-Type": "text/html" } });
    } });
    const artifacts = import.meta.dir + "/../../.local/cache/asset-image-status-browser";
    mkdirSync(artifacts, { recursive: true });
    try {
        const child = Bun.spawn([process.env.NODE_BINARY || "node", resolve(import.meta.dir, "fixtures/project-asset-image-status-browser.mjs"), server.url.toString(), artifacts], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        console.log(stdout);
        if (code) throw new Error(stdout + stderr);
        expect(code).toBe(0);
        expect(calls).toEqual(Array(4).fill("POST /api/tasks/interrupted/recover-image-result"));
    } finally { server.stop(true); }
}, 60000);
