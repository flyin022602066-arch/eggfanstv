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
        const errors = [], events = [], tasks = new Map(), candidates = [], assets = [], shots = [{ id: "u1-old", unitId: "u1", title: "原有镜头" }], storyboardAttempts = new Map(), requests = [], receipts = [], alternateVersions = [];
        let reviewReferences = false;
        const skillText = "# 离线分镜技能\n按照原文和已确认资产拆解完整分镜，至少三个镜头，单镜自然起落，不增加剧情。";
        const skill = { skillId: "offline-director-skill", skillName: "离线分镜规则", description: "离线验证选择的技能进入真实请求", isAdded: true, status: 1, versionId: "offline-v1", version: "1.0.0", contentHash: "offline-hash", fileCount: 1 };
        let revision = 1, holdFirst = true, releaseFirst;
        const held = new Promise((resolve) => { releaseFirst = resolve; });
        let releaseRetry;
        const heldRetry = new Promise((resolve) => { releaseRetry = resolve; });
        const units = [1, 2, 3].map((number) => ({ id: "u" + number, projectId: "batch-p", title: "第" + number + "集", sourceText: "林夏走进旧屋，拿出旧信。", position: number - 1, wordCount: 15, status: "ready", createdAt: "", updatedAt: "" }));
        const core = () => ({ id: "batch-p", name: "区间离线测试", stylePresetId: "urban-live-action", status: "active", revision });
        const character = { name: "林夏", aliases: [], role: "主角", appearance: "短发", clothing: "白衣", physique: "清瘦", personality: "果断", props: "", consistencyPrompt: "短发", multiViewPrompt: "正侧背", voiceLanguage: "中文", voiceAge: "青年", voiceTimbre: "清亮" };
        const detail = () => ({ project: core(), units, assets, assetCandidates: candidates, shots, shotRevisions: [], shotReferences: [], shotArtifacts: [], workflows: [], canvases: [], canvasUnitLinks: [], assetFolders: [], tasks: [...tasks.values()] });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (entry) => { if (["error", "warning"].includes(entry.type())) errors.push(entry.type() + ": " + entry.text()); });
        await page.route("**/*", async (route) => {
            const request = route.request(), target = new URL(request.url()), path = target.pathname;
            if (target.origin !== new URL(url).origin) { errors.push("external request: " + target.origin); return route.abort(); }
            const ok = (data) => route.fulfill({ json: { code: 0, data, msg: "" } });
            if (!path.startsWith("/api/")) return route.continue();
            if (request.method() === "POST" && path === "/api/tasks") {
                const body = request.postDataJSON(), metadata = body.input.metadata;
                requests.push(body);
                assert.equal(body.model, "batch-offline::offline-director", "all extraction and storyboard calls use the selected batch model");
                if (metadata.chapterBatchPhase === "storyboard") {
                    assert.equal(metadata.storyboardMode, "continuous_30s");
                    assert.equal(metadata.dialogueConstraintMode, "unrestricted");
                    assert.deepEqual(metadata.systemPresentation, { mode: "character", characterName: "离线精灵", characterAppearance: "蓝色悬浮光球", characterVoice: "清亮少女音" });
                    assert.ok(body.prompt.includes(skillText), "selected skill content reaches the actual storyboard request");
                } else {
                    assert.equal(metadata.promptTemplateVariables.系统表现模式, "character");
                    assert.equal(metadata.promptTemplateVariables.系统角色名称, "离线精灵");
                }
                const attempt = metadata.chapterBatchPhase === "storyboard" ? (storyboardAttempts.get(metadata.chapterId) || 0) : 0;
                if (metadata.chapterBatchPhase === "storyboard") storyboardAttempts.set(metadata.chapterId, attempt + 1);
                const id = metadata.chapterId + "-" + metadata.chapterBatchPhase + (attempt ? "-" + attempt : "");
                events.push(id);
                if (metadata.chapterBatchPhase === "extract" && metadata.chapterId === "u2") assert.ok(candidates.filter((candidate) => candidate.unitId === "u1").every((candidate) => candidate.status === "confirmed"));
                if (metadata.chapterBatchPhase === "review") assert.ok(metadata.promptTemplateVariables.资产复核清单.includes("林夏"));
                if (metadata.chapterBatchPhase === "storyboard") assert.ok(candidates.filter((candidate) => candidate.unitId === metadata.chapterId).every((candidate) => candidate.status === "confirmed"));
                const rowCount = metadata.chapterId === "u1" && attempt === 1 ? 2 : 3;
                const text = JSON.stringify(metadata.chapterBatchPhase === "storyboard" ? { rows: Array.from({ length: rowCount }, (_, index) => ({ plotDescription: ["林夏走进旧屋。", "林夏拿出旧信。", "林夏查看信封。"][index], videoMotionPrompt: ["林夏缓缓推门。", "她从口袋里拿出旧信。", "镜头缓缓推进信封。"][index], durationSeconds: 15, characters: [{ characterName: "林夏", characterAssetId: reviewReferences ? "mistyped-hero" : "hero", characterVersionId: reviewReferences ? index === 0 ? "hero-v2" : "invalid-hero-version" : "hero-v1" }], assetBindings: [{ nodeId: "hero", role: "character" }] })) } : metadata.chapterBatchPhase === "review" ? { characters: [], scenes: [], props: [{ name: "旧信", description: "关键证据", prompt: "泛黄信封" }] } : { characters: [character], scenes: [], props: [] });
                const task = { id, projectId: "batch-p", type: "canvas_text", prompt: body.prompt, status: metadata.chapterBatchPhase === "storyboard" && metadata.chapterId === "u1" && attempt === 0 ? "failed" : "succeeded", error: "上游暂时失败", attempts: 1, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:01Z", inputJson: JSON.stringify(body.input), resultJson: JSON.stringify({ text }), clientContext: { chapterId: metadata.chapterId, chapterOperation: metadata.chapterBatchPhase === "storyboard" ? "storyboard" : "characters", chapterBatchId: metadata.chapterBatchId, chapterBatchPhase: metadata.chapterBatchPhase } };
                tasks.set(id, task);
                if (id === "u1-storyboard-1") await heldRetry;
                return ok(id === "u1-extract" && holdFirst ? { ...task, status: "running" } : task);
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
                assert.ok(body.shots[0].assetVersionIds.includes(reviewReferences ? "hero-v2" : "hero-v1"), "storyboard submission binds the selected character version");
                assert.equal(body.shots.length, 3, "failed or sparse results are never written");
                assert.deepEqual(body.expectedShotIds, shots.filter((shot) => shot.unitId === unitId).map((shot) => shot.id));
                for (let index = shots.length - 1; index >= 0; index--) if (shots[index].unitId === unitId) shots.splice(index, 1);
                shots.push(...body.shots.map((shot, index) => ({ ...shot, id: unitId + "-shot-" + index, unitId }))); revision++;
                if (body.sourceTaskId) receipts.push({ taskId: body.sourceTaskId, applied: true, kind: "storyboard", resultCount: body.shots.length });
                return ok({ shots: shots.filter((shot) => shot.unitId === unitId) });
            }
            if (path.endsWith("/core")) return ok({ project: core() });
            if (path.endsWith("/character-versions")) return ok({ revision, versions: [...assets.filter((asset) => asset.character).map((asset) => ({ ...asset.character, assetId: asset.id, title: asset.title, updatedAt: "" })), ...alternateVersions] });
            if (path.endsWith("/workspace")) {
                const unitId = path.split("/").at(-2); return ok({ ...detail(), unit: units.find((unit) => unit.id === unitId), shots: shots.filter((shot) => shot.unitId === unitId), assetCandidates: candidates.filter((candidate) => candidate.unitId === unitId) });
            }
            if (path.endsWith("/chapter-apply-receipts")) return ok({ receipts: receipts.filter((receipt) => (target.searchParams.get("taskIds") || "").split(",").includes(receipt.taskId)) });
            if (path === "/api/projects/batch-p") return ok(detail());
            if (path.endsWith("/assets")) return ok({ assets });
            if (path === "/api/skills/offline-director-skill/files") return ok({ files: [{ path: "SKILL.md", kind: "markdown", mimeType: "text/markdown", size: skillText.length, sha256: "offline-sha" }] });
            if (path === "/api/skills/offline-director-skill/file") return ok({ file: { file: { path: "SKILL.md", kind: "markdown", mimeType: "text/markdown", size: skillText.length, sha256: "offline-sha" }, content: skillText, binary: false } });
            if (path.includes("/skills")) return ok({ skills: [skill] });
            return ok({});
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(url + "?theme=" + theme);
        assert.equal(await page.title(), "区间批量离线验证");
        assert.equal(new URL(page.url()).origin, new URL(url).origin);
        assert.equal(await page.locator("vite-error-overlay").count(), 0);
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("拟人化系统", { exact: true }).click();
        await dialog.getByRole("textbox", { name: "系统角色名称", exact: true }).fill("离线精灵");
        await dialog.getByRole("textbox", { name: "系统形象设定", exact: true }).fill("蓝色悬浮光球");
        await dialog.getByRole("textbox", { name: "系统声音设定", exact: true }).fill("清亮少女音");
        await dialog.getByRole("button", { name: "offline-text", exact: true }).click();
        await page.getByRole("button", { name: "离线文本模型", exact: true }).click();
        await page.getByRole("option", { name: /offline-director/ }).click();
        await dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true }).click();
        await page.locator(".ant-select-dropdown:visible").getByText("离线分镜规则", { exact: true }).click();
        await dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true }).press("Escape");
        await dialog.getByRole("combobox", { name: "分镜拆解模式", exact: true }).click();
        await page.locator(".ant-select-dropdown:visible").getByText("30 秒连续分镜（2.5 视频模型）", { exact: true }).click();
        await page.waitForTimeout(250);
        await dialog.getByText("不限制对白字数", { exact: true }).click();
        await page.waitForTimeout(250);
        const scrollArea = dialog.getByRole("region", { name: "区间任务配置与进度", exact: true });
        await scrollArea.evaluate((element) => { element.scrollTop = 0; });
        await page.screenshot({ path: join(artifactDir, theme + "-settings-top.png"), fullPage: true });
        await dialog.getByRole("combobox", { name: "分镜拆解模式", exact: true }).scrollIntoViewIfNeeded();
        const startBounds = await dialog.getByRole("button", { name: "开始所选区间", exact: true }).boundingBox();
        assert.ok(startBounds && startBounds.y >= 0 && startBounds.y + startBounds.height <= page.viewportSize().height, "start button remains inside the viewport while settings scroll");
        const closeBounds = await dialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
        assert.ok(closeBounds && closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= page.viewportSize().height, "close remains reachable");
        assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "dialog has no horizontal overflow");
        await page.screenshot({ path: join(artifactDir, theme + "-settings.png"), fullPage: true });
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
        const singleDialog = page.getByRole("dialog", { name: "生成章节分镜", exact: true });
        assert.equal(await singleDialog.getByRole("textbox", { name: "系统角色名称", exact: true }).inputValue(), "离线精灵", "batch and single episode share project settings");
        assert.ok(await singleDialog.getByRole("button", { name: "offline-director", exact: true }).isVisible());
        await singleDialog.getByRole("button", { name: "取 消", exact: true }).click();
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        await dialog.getByRole("spinbutton", { name: "结束集", exact: true }).fill("2");
        await dialog.getByRole("button", { name: "开始所选区间", exact: true }).click();
        await page.waitForFunction(() => document.body.textContent.includes("提取中"));
        assert.ok(await dialog.getByRole("textbox", { name: "系统角色名称", exact: true }).isDisabled());
        assert.ok(await dialog.getByRole("button", { name: "offline-director", exact: true }).isDisabled());
        assert.ok(await dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true }).isDisabled());
        assert.ok(await dialog.getByRole("combobox", { name: "分镜拆解模式", exact: true }).isDisabled());
        assert.ok(await page.getByRole("button", { name: "提取角色、场景与道具", exact: true }).isDisabled());
        try { await dialog.getByRole("button", { name: "暂停后续任务", exact: true }).click(); } catch (error) { console.log(JSON.stringify({ events, errors, body: await page.locator("body").innerText() })); await page.screenshot({ path: join(artifactDir, "pause-failure.png"), fullPage: true }); throw error; }
        holdFirst = false; releaseFirst();
        await page.getByText(/区间任务已暂停/).first().waitFor({ state: "attached" });
        assert.deepEqual(events, ["u1-extract"], "pause does not submit a review or another episode");
        await page.reload();
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        assert.equal(await dialog.getByRole("textbox", { name: "系统角色名称", exact: true }).inputValue(), "离线精灵", "settings survive refresh");
        assert.ok(await dialog.getByRole("radio", { name: "不限制对白字数", exact: true }).isChecked());
        assert.ok(await dialog.getByRole("button", { name: "offline-director", exact: true }).isVisible());
        assert.ok(await dialog.getByText("离线分镜规则", { exact: true }).isVisible());
        await dialog.getByRole("button", { name: "开始所选区间", exact: true }).click();
        const replacement = page.getByRole("dialog", { name: "替换未完成的区间任务？" });
        await replacement.getByRole("button", { name: "保留并返回", exact: true }).click();
        assert.deepEqual(events, ["u1-extract"], "opening and cancelling replacement cannot create another paid task");
        await dialog.getByRole("button", { name: "继续未完成任务", exact: true }).click();
        const generating = dialog.getByRole("status", { name: "分镜生成中", exact: true });
        await generating.waitFor();
        await generating.getByText("第1次重试", { exact: true }).waitFor();
        assert.match(await generating.innerText(), /生成中/);
        assert.match(await generating.innerText(), /第1次重试/);
        assert.equal(await generating.getAttribute("aria-busy"), "true");
        assert.equal(await generating.locator("svg").count(), 1, "an active retry has a visible loading indicator");
        assert.ok(await dialog.getByText("分镜请求处理中，等待本次结果；如失败将立即重试，无固定等待间隔。", { exact: true }).isVisible());
        assert.equal(await dialog.getByRole("alert").filter({ hasText: "上游暂时失败" }).count(), 0, "a new storyboard attempt must not display the previous attempt's failure as its current status");
        assert.equal(shots.filter((shot) => shot.unitId === "u1").length, 1, "old shot survives model failure until a complete replacement is ready");
        await dialog.getByRole("region", { name: "区间任务逐集进度", exact: true }).scrollIntoViewIfNeeded();
        await generating.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifactDir, theme + "-retry.png"), fullPage: true });
        await dialog.getByRole("button", { name: "暂停后续任务", exact: true }).click();
        releaseRetry();
        await page.getByText(/区间任务已暂停/).first().waitFor({ state: "attached" });
        assert.equal(await dialog.getByRole("status", { name: "分镜生成中", exact: true }).count(), 0, "paused batches do not claim to be actively generating");
        assert.equal(storyboardAttempts.get("u1"), 2, "pause retains the already submitted retry without another task");
        await dialog.getByText("仅提取资产", { exact: true }).click();
        assert.equal(await dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true }).count(), 0, "assets-only mode does not offer irrelevant storyboard settings");
        const previousStoryboards = events.filter((event) => event.includes("-storyboard")).length;
        await dialog.getByRole("button", { name: "继续未完成任务", exact: true }).click();
        await dialog.getByText(/当前任务：.*仅提取资产/).waitFor();
        await page.getByRole("status").filter({ hasText: /区间任务已完成/ }).waitFor();
        assert.equal(events.filter((event) => event.includes("-storyboard")).length, previousStoryboards, "assets-only continuation cannot query, retry or submit unfinished storyboards");
        assert.equal(await dialog.getByText("本次不执行", { exact: true }).count(), 2);
        assert.ok(await dialog.getByRole("radio", { name: "仅提取资产", exact: true }).isChecked());
        await dialog.getByRole("region", { name: "区间任务逐集进度", exact: true }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(artifactDir, theme + "-assets-only.png"), fullPage: true });
        await dialog.getByText("仅拆解分镜", { exact: true }).click();
        assert.ok(await dialog.getByRole("combobox", { name: "本次生成使用的技能", exact: true }).isVisible());
        await dialog.getByRole("button", { name: "继续未完成任务", exact: true }).click();
        await dialog.getByText(/当前任务：.*仅拆解分镜/).waitFor();
        await page.getByRole("status").filter({ hasText: /区间任务已完成/ }).waitFor();
        assert.equal(events.filter((event) => event === "u1-extract").length, 1);
        assert.equal(events.filter((event) => event.endsWith("-review")).length, 2);
        assert.equal(events.filter((event) => event.includes("-storyboard")).length, 4);
        assert.equal(shots.length, 6); assert.equal(tasks.size, 8); assert.equal(requests.length, 8); assert.ok(!events.some((event) => event.startsWith("u3")));
        assert.deepEqual([...tasks.values()].filter((task) => task.id.startsWith("u1-storyboard")).map((task) => JSON.parse(task.inputJson).metadata.clientOperationId.split(":").at(-1)), ["0", "1", "2"]);
        assert.ok((await page.getByLabel("当前页面").innerText()).endsWith("/chapters/u1"));
        assert.equal(await page.getByRole("heading", { name: "错误的强制跳转" }).count(), 0);
        await page.screenshot({ path: join(artifactDir, theme + "-batch.png"), fullPage: true });
        const previous = tasks.size; await page.reload(); await page.waitForTimeout(1500); assert.equal(tasks.size, previous, "refresh cannot create new paid tasks");
        reviewReferences = true;
        alternateVersions.push({ ...assets[0].character, versionId: "hero-v2", version: 2, assetId: "hero", title: "林夏", definition: { clothing: "黑甲战斗" }, updatedAt: "" });
        await page.getByRole("button", { name: "区间批量提取 / 分镜", exact: true }).click();
        await dialog.getByText("仅拆解分镜", { exact: true }).click();
        await dialog.getByRole("spinbutton", { name: "结束集", exact: true }).fill("3");
        await dialog.getByRole("spinbutton", { name: "起始集", exact: true }).fill("3");
        await dialog.getByRole("button", { name: "开始所选区间", exact: true }).click();
        const reviewButton = dialog.getByRole("button", { name: "核对引用", exact: true });
        await reviewButton.waitFor();
        await page.waitForFunction(() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes("核对引用")); return button && !button.disabled; });
        assert.equal(requests.length, previous + 1, "ambiguous references retain the paid result rather than repeating generation");
        await reviewButton.click();
        const reviewDialog = page.getByRole("dialog").filter({ hasText: "请核对角色造型版本" });
        await reviewDialog.getByRole("button", { name: "先不写入", exact: true }).click();
        assert.equal(shots.filter((shot) => shot.unitId === "u3").length, 0);
        await reviewButton.click();
        const choices = reviewDialog.getByRole("combobox");
        await choices.first().waitFor();
        const choiceCount = await choices.count();
        assert.ok(choiceCount > 0 && choiceCount <= 3, "review exposes every invalid reference retained in the parsed storyboard");
        assert.equal(await reviewDialog.getByRole("button", { name: "写入已生成的分镜", exact: true }).isDisabled(), true);
        for (const choice of await choices.all()) {
            await choice.click();
            const controls = await choice.getAttribute("aria-controls");
            const menu = page.locator(`[id="${controls}"]`).locator("..");
            await menu.getByText(/v2 · 黑甲战斗/).click();
            await menu.waitFor({ state: "hidden" });
        }
        await reviewDialog.getByRole("button", { name: "写入已生成的分镜", exact: true }).click();
        await page.getByText("第3集分镜已核对写入，未重新调用模型", { exact: true }).waitFor({ state: "attached" });
        assert.equal(shots.filter((shot) => shot.unitId === "u3").length, 3);
        assert.equal(requests.length, previous + 1, "manual correction never calls the model again");
        assert.equal(await reviewButton.count(), 0);
        assert.ok((await page.getByLabel("当前页面").innerText()).endsWith("/chapters/u1"));
        await page.screenshot({ path: join(artifactDir, theme + "-review-completed.png"), fullPage: true });
        assert.deepEqual(errors, []); await page.close(); console.log("PASS batch browser " + theme);
    }
    console.log("Artifacts: " + artifactDir);
} finally { await browser.close(); }
