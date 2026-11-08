import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
let server: ReturnType<typeof Bun.serve>;
let rejectNextRead = false;
const reads: Array<{ path: string; token: string | null }> = [];
const recoveries: string[] = [];
const audio = new Uint8Array(44 + 32000 * 3);
const header = new DataView(audio.buffer);
audio.set(new TextEncoder().encode("RIFF"), 0);
header.setUint32(4, audio.length - 8, true);
audio.set(new TextEncoder().encode("WAVEfmt "), 8);
header.setUint32(16, 16, true);
header.setUint16(20, 1, true);
header.setUint16(22, 1, true);
header.setUint32(24, 16000, true);
header.setUint32(28, 32000, true);
header.setUint16(32, 2, true);
header.setUint16(34, 16, true);
audio.set(new TextEncoder().encode("data"), 36);
header.setUint32(40, audio.length - 44, true);
for (let sample = 0; sample < 48000; sample++) header.setInt16(44 + sample * 2, Math.round(Math.sin(sample * 440 * 2 * Math.PI / 16000) * 4000), true);

beforeEach(() => { reads.length = 0; recoveries.length = 0; rejectNextRead = false; });
beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/suno-media-harness.tsx"], target: "browser", define: {
        "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"', "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
    }, plugins: [{ name: "source", setup(builder) { builder.onResolve({ filter: /^@[/]/ }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) })); } }] });
    if (!build.success) throw new Error(build.logs.join("; "));
    const script = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
    const ok = (data: unknown) => Response.json({ code: 0, data });
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "content-type": "application/javascript" } });
        if (path === "/") return new Response('<html><body><div id="root"></div><style>.suno-studio-waveform canvas{width:600px;height:120px}.suno-studio-waveform{--muted-foreground:#333;--foreground:#111;--palette-node-audio:#06f;--control-selected-bg:#eef}</style><script type="module" src="/harness.js"></script></body></html>', { headers: { "content-type": "text/html" } });
        if (path === "/fixture.wav") return new Response(audio, { headers: { "content-type": "audio/wav" } });
        if (path === "/api/resources/suno-media") {
            if (request.method !== "POST" || request.headers.get("X-Desktop-Token") !== "synthetic-suno-media-token") return new Response("Forbidden", { status: 403 });
            const input = await request.json() as { url: string; clipId: string };
            expect(input.clipId).toBe("song");
            expect(input.url).toBe("https://cors-blocked.invalid/song.wav");
            recoveries.push(input.clipId);
            return ok({ resource: { id: "song", mimeType: "audio/wav", kind: "audio", size: audio.length } });
        }
        if (path === "/api/resources/song") return ok({ resource: { id: "song", mimeType: "audio/wav", size: audio.length } });
        if (path === "/api/resources/song/file") {
            reads.push({ path, token: request.headers.get("X-Desktop-Token") });
            if (rejectNextRead) { rejectNextRead = false; return new Response("Temporary fixture failure", { status: 503 }); }
            if (request.headers.get("X-Desktop-Token") !== "synthetic-suno-media-token") return new Response("Forbidden", { status: 403 });
            return new Response(audio, { headers: { "content-type": "audio/wav" } });
        }
        if (path.startsWith("/api/")) return ok({});
        return new Response("Not found", { status: 404 });
    } });
}, 30000);
afterAll(() => { server?.stop(true); });

for (const mode of ["owned", "waveform", "local", "legacy", "retry", "remote", "remote-waveform"] as const) {
    test(`Suno media ${mode}: authenticated playback, waveform and download`, async () => {
        rejectNextRead = mode === "retry";
        const child = Bun.spawn(["node", import.meta.dir + "/fixtures/suno-media-browser.mjs", server.url.toString(), mode], { stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (code) throw new Error(stdout + stderr);
        expect(code).toBe(0);
        expect(reads).toHaveLength(mode === "local" ? 0 : ["owned", "retry", "remote"].includes(mode) ? 2 : 1);
        expect(reads.every(read => read.token === "synthetic-suno-media-token")).toBe(true);
        expect(recoveries).toHaveLength(mode.startsWith("remote") ? 1 : 0);
    }, 45000);
}
