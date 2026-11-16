import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [], reads = [];
    let releaseRefresh;
    let deferRefresh = false;
    const timestamp = "2026-11-15T00:00:00Z";
    const version = { assetId: "hero", title: "苏卉", versionId: "v0", version: 1, definition: { aliases: ["小卉"] }, updatedAt: timestamp, visualStatus: "ready", voiceStatus: "missing", representations: [{ id: "rep", resourceId: "image", mediaType: "image", role: "primary" }] };
    const asset = { id: "hero", title: "苏卉", category: "character", mediaType: "entity", primaryVersionId: "v0", character: version, definitionJson: JSON.stringify(version.definition), versionCount: 1, usages: [], position: 0, status: "confirmed", updatedAt: timestamp };
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
        const request = route.request(), target = new URL(request.url()), path = target.pathname;
        if (target.origin !== new URL(url).origin) { errors.push("unexpected remote request"); return route.abort(); }
        if (!path.startsWith("/api/")) return route.continue();
        assert.equal(request.method(), "GET", "opening and refreshing looks must not submit generation");
        reads.push(target.pathname + target.search);
        const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
        if (path.endsWith("/character-versions")) {
            if (deferRefresh) await new Promise((resolve) => { releaseRefresh = resolve; });
            return ok({ revision: 1, versions: [version] });
        }
        if (path.endsWith("/assets")) {
            if (target.searchParams.get("category") !== "character") return route.fulfill({ status: 503, json: { code: 503, data: null, msg: "full project library intentionally unavailable" } });
            return ok({ assets: [asset] });
        }
        if (path.endsWith("/workspace")) return ok({ unit: { id: "u", sourceText: "小卉走到窗前。" }, assets: [], shots: [{ id: "s", unitId: "u", position: 0, currentRevisionId: "sr", description: "小卉走到窗前。" }], shotRevisions: [{ id: "sr", shotId: "s", version: 1, videoPrompt: "小卉走到窗前。" }], shotReferences: [], tasks: [], shotArtifacts: [] });
        if (path.includes("/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#888"/></svg>' });
        errors.push("unexpected API read: " + path);
        return route.abort();
    });
    await page.goto(url + "?theme=dark");
    const panel = page.getByRole("region", { name: "角色造型参考" });
    const versionPicker = panel.getByRole("combobox", { name: "苏卉造型版本", exact: true });
    await versionPicker.waitFor({ timeout: 3000 });
    assert.equal(await versionPicker.isEnabled(), true);
    assert.equal(reads.filter((path) => path.includes("/assets")).every((path) => path.includes("category=character")), true);
    deferRefresh = true;
    await panel.getByRole("button", { name: "刷新造型列表", exact: true }).click();
    await panel.getByRole("status").getByText("正在刷新，保留当前造型…", { exact: true }).waitFor();
    assert.equal(await versionPicker.isVisible(), true);
    while (!releaseRefresh) await new Promise((resolve) => setTimeout(resolve, 20));
    releaseRefresh();
    await panel.getByRole("status").waitFor({ state: "hidden" });
    assert.equal(await versionPicker.isEnabled(), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(artifactDir, "character-reference-loading.png") });
    console.log("PASS: looks load without the full asset library, aliases are preserved, refresh retains cards, no generation or external requests");
} finally { await browser.close(); }
