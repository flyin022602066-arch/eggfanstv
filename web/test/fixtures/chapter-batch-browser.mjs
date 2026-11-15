import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url, artifactDir] = process.argv.slice(2);
const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((path) => path && existsSync(path));
const browser = await chromium.launch({ executablePath, headless: true });
try {
    for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport: { width: theme === "dark" ? 1500 : 430, height: 1000 } }); page.setDefaultTimeout(12000);
        const errors = [], events = [], tasks = new Map(), candidates = [], assets = [], shots = [];
        let revision = 1, holdFirst = true, releaseFirst;
        const held = new Promise((resolve) => { releaseFirst = resolve; });
        const units = [1, 2, 3].map((number) => ({ id: "u" + number, projectId: "batch-p", title: "第" + number + "集", sourceText: "林夏走进旧屋，拿出旧信。", position: number - 1, wordCount: 15, status: "ready", createdAt: "", updatedAt: "" }));
        const core = () => ({ id: "batch-p", name: "区间离线测试", stylePresetId: "urban-live-action", status: "active", revision });
        const character = { name: "林夏", aliases: [], role: "主角", appearance: "短发", clothing: "白衣", physique: "清瘦", personality: "果断", props: "", consistencyPrompt: "短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
        const detail = () => ({ project: core(), units, assets, assetCandidates: candidates, shots, shotRevisions: [], shotReferences: [], shotArtifacts: [], workflows: [], canvases: [], canvasUnitLinks: [], assetFolders: [], tasks: [...tasks.values()] });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request: " + target.origin); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (!path.startsWith("/api/")) return route.continue();
            if (request.method() === "POST" && path === "/api/tasks") {
                const body = request.postDataJSON(), metadata = body.input.metadata, id = metadata.chapterId + "-" + metadata.chapterBatchPhase;
                events.push(id);
                if (metadata.chapterBatchPhase === "extract" && metadata.chapterId === "u2") assert.ok(candidates.filter((candidate) => candidate.unitId === "u1").every((candidate) => candidate.status === "confirmed"));
                if (metadata.chapterBatchPhase === "review") assert.ok(metadata.promptTemplateVariables.资产复核清单.includes("林夏"));
                if (metadata.chapterBatchPhase === "storyboard") assert.ok(candidates.filter((candidate) => candidate.unitId === metadata.chapterId).every((candidate) => candidate.status === "confirmed"));
                const text = JSON.stringify(metadata.chapterBatchPhase === "storyboard" ? { rows: [{ plotDescription: "林夏走进旧屋。", videoMotionPrompt: "林夏缓缓推门。", durationSeconds: 15, characters: [{ characterName: "林夏", characterAssetId: "hero", characterVersionId: "hero-v1" }], assetBindings: [{ nodeId: "hero", role: "character" }] }] } : metadata.chapterBatchPhase === "review" ? { characters: [], scenes: [], props: [{ name: "旧信", description: "关键证据", prompt: "泛黄信封" }] } : { characters: [character], scenes: [], props: [] });
                const task = { id, projectId: "batch-p", type: "canvas_text", prompt: body.prompt, status: "succeeded", attempts: 1, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:01Z", inputJson: JSON.stringify(body.input), resultJson: JSON.stringify({ text }), clientContext: { chapterId: metadata.chapterId, chapterOperation: metadata.chapterBatchPhase === "storyboard" ? "storyboard" : "characters", chapterBatchId: metadata.chapterBatchId, chapterBatchPhase: metadata.chapterBatchPhase } };
                tasks.set(id, task); return ok(id === "u1-extract" && holdFirst ? { ...task, status: "running" } : task);
            }
            if (path.endsWith("/text-events")) {
                const id = path.split("/").at(-2); if (id === "u1-extract" && holdFirst) await held;
                return route.fulfill({ contentType: "text/event-stream", body: 'event: terminal\ndata: {"status":"succeeded"}\n\n' });
            }
            if (path === "/api/tasks") return ok([...tasks.values()]);
            if (path.startsWith("/api/tasks/")) { const id = path.split("/").at(-1), task = tasks.get(id); return ok(id === "u1-extract" && holdFirst ? { ...task, status: "running" } : task); }
            if (path === "/api/projects/batch-p/asset-candidates" && request.method() === "POST") {
                const body = request.postDataJSON(), unitId = body.candidates[0].unitId; events.push(unitId + "-store");
                const created = body.candidates.map((item, index) => ({ ...item, id: unitId + "-candidate-" + index, status: "pending_confirmation", detailsJson: JSON.stringify(item.details) })); candidates.push(...created); revision++; return ok({ candidates: created });
            }
            if (path.endsWith("/confirm")) {
                const id = path.split("/").at(-2), candidate = candidates.find((item) => item.id === id); candidate.status = "confirmed";
                events.push(candidate.unitId + "-confirm");
                if (candidate.category === "character" && !assets.some((asset) => asset.id === "hero")) assets.push({ id: "hero", title: "林夏", category: "character", mediaType: "entity", primaryVersionId: "hero-v1", versionCount: 1, usages: [], unitIds: units.map((unit) => unit.id), character: { versionId: "hero-v1", version: 1, definition: character, representations: [], visualStatus: "missing", voiceStatus: "missing" } });
                revision++; return ok({ asset: assets[0] });
            }
            if (path.endsWith("/shots") && request.method() === "PUT") {
                const body = request.postDataJSON(), unitId = path.split("/").at(-2);
                assert.ok(body.shots[0].assetVersionIds.includes("hero-v1"), "storyboard submission binds the confirmed character version");
                shots.push(...body.shots.map((shot, index) => ({ ...shot, id: unitId + "-shot-" + index, unitId }))); revision++; return ok({ shots: shots.filter((shot) => shot.unitId === unitId) });
            }
            if (path.endsWith("/core")) return ok({ project: core() });
            if (path.endsWith("/character-versions")) return ok({ revision, versions: assets.filter((asset) => asset.character).map((asset) => ({ ...asset.character, assetId: asset.id, title: asset.title, updatedAt: "" })) });
            if (path.endsWith("/workspace")) {
                const unitId = path.split("/").at(-2); return ok({ ...detail(), unit: units.find((unit) => unit.id === unitId), shots: shots.filter((shot) => shot.unitId === unitId), assetCandidates: candidates.filter((candidate) => candidate.unitId === unitId) });
            }
            if (path.endsWith("/chapter-apply-receipts")) return ok({ receipts: [] });
            if (path === "/api/projects/batch-p") return ok(detail());
            if (path.endsWith("/assets")) return ok({ assets });
            if (path.includes("/skills")) return ok({ skills: [] });
            return ok({});
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(url + "?theme=" + theme);
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("spinbutton", { name: "结束集", exact: true }).fill("2");
        await dialog.getByRole("button", { name: "开始所选区间", exact: true }).click();
        await page.waitForFunction(() => document.body.textContent.includes("提取中"));
        assert.ok(await page.getByRole("button", { name: "提取角色、场景与道具", exact: true }).isDisabled());
        try { await dialog.getByRole("button", { name: "暂停后续任务", exact: true }).click(); } catch (error) { console.log(JSON.stringify({ events, errors, body: await page.locator("body").innerText() })); await page.screenshot({ path: join(artifactDir, "pause-failure.png"), fullPage: true }); throw error; }
        holdFirst = false; releaseFirst();
        await page.getByText(/区间任务已暂停/).first().waitFor({ state: "attached" });
        assert.deepEqual(events, ["u1-extract"], "pause does not submit a review or another episode");
        await page.reload();
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        await dialog.getByRole("button", { name: "开始所选区间", exact: true }).click();
        const replacement = page.getByRole("dialog", { name: "替换未完成的区间任务？" });
        await replacement.getByRole("button", { name: "保留并返回", exact: true }).click();
        assert.deepEqual(events, ["u1-extract"], "opening and cancelling replacement cannot create another paid task");
        await dialog.getByRole("button", { name: "继续未完成任务", exact: true }).click();
        await page.getByText(/区间任务已完成/).first().waitFor({ state: "attached" });
        assert.equal(events.filter((event) => event === "u1-extract").length, 1);
        assert.equal(events.filter((event) => event.endsWith("-review")).length, 2);
        assert.equal(events.filter((event) => event.endsWith("-storyboard")).length, 2);
        assert.equal(shots.length, 2); assert.equal(tasks.size, 6); assert.ok(!events.some((event) => event.startsWith("u3")));
        assert.ok((await page.getByLabel("当前页面").innerText()).endsWith("/chapters/u1"));
        assert.equal(await page.getByRole("heading", { name: "错误的强制跳转" }).count(), 0);
        await page.screenshot({ path: join(artifactDir, theme + "-batch.png"), fullPage: true });
        const previous = tasks.size; await page.reload(); await page.waitForTimeout(1500); assert.equal(tasks.size, previous, "refresh cannot create new paid tasks");
        assert.deepEqual(errors, []); await page.close(); console.log("PASS batch browser " + theme);
    }
    console.log("Artifacts: " + artifactDir);
} finally { await browser.close(); }
