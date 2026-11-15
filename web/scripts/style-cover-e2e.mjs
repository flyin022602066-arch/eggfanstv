import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "vite";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(webDirectory, "..");
const output = resolve(workspace, ".local/cache/style-cover-generation/browser");
const dist = resolve(workspace, ".local/cache/style-cover-harness");
await mkdir(output, { recursive: true });
await build({
    configFile: resolve(webDirectory, "vite.config.ts"), root: webDirectory, publicDir: false, logLevel: "error",
    plugins: [{ name: "skip-cover-test-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }],
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(webDirectory, "test/fixtures/project-styles.html") } },
});
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        const base = pathname.startsWith("/short-drama-styles/") ? resolve(webDirectory, "public") : dist;
        const path = resolve(base, "." + pathname);
        if (!path.startsWith(base + sep)) throw new Error("Path outside fixture");
        const bytes = await readFile(path);
        response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp" })[extname(path)] || "application/octet-stream" });
        response.end(bytes);
    } catch {
        response.writeHead(404);
        response.end();
    }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const reports = [];
try {
    for (const [theme, width] of [["dark", 1366], ["light", 1366], ["dark", 390]]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.setDefaultTimeout(20000);
        const errors = [];
        const imageRequests = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("response", response => { if (response.status() >= 400) errors.push(response.status() + ": " + new URL(response.url()).pathname); });
        await page.route("**/*", route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) { errors.push("Unexpected remote request: " + url.hostname); return route.abort(); }
            if (url.pathname.startsWith("/api/")) {
                const data = url.pathname === "/api/style-profiles" ? { profiles: [] } : url.pathname === "/api/project-folders" ? { folders: [] } : { projects: [], total: 0, page: 1, pageSize: 50, hasMore: false };
                return route.fulfill({ json: { code: 0, data, msg: "offline fixture" } });
            }
            if (url.pathname.startsWith("/short-drama-styles/covers/")) imageRequests.push(url.pathname);
            return route.continue();
        });
        await page.goto(origin + "/test/fixtures/project-styles.html?theme=" + theme);
        await page.getByRole("button", { name: "选择项目画风（可选）", exact: true }).click();
        await page.getByRole("heading", { name: "风格中心", exact: true }).waitFor();
        const cards = page.locator("article.style-center-card");
        assert.equal(await cards.count(), 67);
        const images = cards.locator("img");
        const sources = await images.evaluateAll(elements => elements.map(element => ({ src: element.getAttribute("src"), loading: element.loading })));
        const generated = sources.filter(item => item.src.includes("/covers/"));
        assert.equal(generated.length, 61);
        assert.ok(generated.every(item => item.src.endsWith(".thumb.webp") && item.loading === "lazy"));
        await images.evaluateAll(async elements => { await Promise.all(elements.map(async element => { element.loading = "eager"; await element.decode(); })); });
        assert.ok(await images.evaluateAll(elements => elements.every(element => element.complete && element.naturalWidth > 0)));
        assert.ok(imageRequests.every(path => path.endsWith(".thumb.webp")));
        await page.screenshot({ path: resolve(output, theme + "-" + width + "-cards.png"), fullPage: true });
        const detailTrigger = cards.first().locator(".style-center-card-cover");
        await detailTrigger.click({ force: true });
        const detail = page.locator(".canvas-style-detail-modal");
        await detail.locator(".ant-modal").waitFor({ state: "visible" });
        const fullImage = detail.locator("img");
        await fullImage.evaluate(async element => element.decode());
        assert.deepEqual(await fullImage.evaluate(element => [element.naturalWidth, element.naturalHeight]), [3840, 2160]);
        assert.ok(!(await fullImage.getAttribute("src")).includes(".thumb."));
        assert.ok(await detail.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth));
        await page.screenshot({ path: resolve(output, theme + "-" + width + "-detail.png"), fullPage: true });
        await page.keyboard.press("Escape");
        await detail.locator(".ant-modal").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "海外画风", exact: true }).click();
        assert.equal(await cards.count(), 16);
        assert.deepEqual(errors, []);
        reports.push({ theme, width, cards: sources.length, generatedCovers: generated.length, thumbnailsLoaded: true, detailNative4K: true, overseas: 16, errors });
        console.log(JSON.stringify(reports.at(-1)));
        await page.close();
    }
    await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: true, reports }, null, 2));
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
