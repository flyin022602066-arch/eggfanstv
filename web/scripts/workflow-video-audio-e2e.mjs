import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, extname, sep } from "node:path";
import { build } from "vite";
import { storyboardSequencePrompt } from "../test/fixtures/storyboard-sequence.ts";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("playwright");
const jiasuJ2Fixture = process.argv.includes("--jiasu-j2");
const jiasuJ3Fixture = process.argv.includes("--jiasu-j3");
const sceneBindingFixture = process.argv.includes("--scene-binding");
const densityFixture = process.argv.includes("--storyboard-density");
const sequenceFixture = process.argv.includes("--storyboard-sequence");
const reviewFixture = densityFixture || sequenceFixture;
const overwriteFixture = reviewFixture || process.argv.includes("--chapter-overwrite");
const promptFixture = process.argv.includes("--prompt-preview");
const rememberModelFixture = process.argv.includes("--remember-model");
const chapterModelFixture = process.argv.includes("--chapter-model-memory");
const workflowRetryFixture = process.argv.includes("--workflow-retry");
const workflowRouteFixture = process.argv.includes("--workflow-route");
const jiasuFixture = workflowRetryFixture || promptFixture || jiasuJ2Fixture || jiasuJ3Fixture || sceneBindingFixture || process.argv.includes("--jiasu");
const bindingFixture = workflowRetryFixture || promptFixture || jiasuJ2Fixture || jiasuJ3Fixture || sceneBindingFixture || overwriteFixture || process.argv.includes("--asset-binding");
const skillDefinitions = promptFixture ? JSON.parse(await readFile(resolve(root, "backend/internal/skills/seed/skills.json"), "utf8")).filter(skill => ["14811816982540", "14889899551756", "14889899552012"].includes(skill.skill_id)) : [];
const videoGuides = new Map(await Promise.all([["14811816982540", "world"], ["14889899551756", "character"], ["14889899552012", "performance"]].filter(() => promptFixture).map(async ([id, name]) => [id, await readFile(resolve(root, `backend/internal/skills/seed/video/${name}.md`), "utf8")])));
const originalImages = new Map(jiasuJ2Fixture ? [
    ["character-original", await readFile("S:/codex/Temp/Codex/codex-clipboard-070815d2-f870-4a2e-8d30-c7c798ea23e7.png")],
    ["scene-original", await readFile("S:/codex/Temp/Codex/codex-clipboard-b126733e-3f4b-43cd-9a80-04dd72ed2ad9.png")],
] : []);
const imageResources = new Map(originalImages);
const maskedUploads = [];
let failNextMaskUpload = false;
const dist = resolve(root, ".local/cache/workflow-video-audio-harness");
const output = resolve(root, chapterModelFixture ? "output/playwright/chapter-model-memory" : sequenceFixture ? "output/playwright/storyboard-sequence" : densityFixture ? "output/playwright/storyboard-density" : promptFixture ? "output/playwright/video-prompt-preview" : overwriteFixture ? "output/playwright/chapter-overwrite" : sceneBindingFixture ? "output/playwright/scene-binding-30s" : rememberModelFixture ? "output/playwright/workflow-model-memory" : jiasuJ2Fixture ? "output/playwright/workflow-jiasu-reference" : bindingFixture ? "output/playwright/workflow-asset-binding" : jiasuFixture ? "output/playwright/workflow-jiasu-audio" : "output/playwright/workflow-video-audio");
await mkdir(output, { recursive: true });
await build({ configFile: resolve(root, "web/vite.config.ts"), root: resolve(root, "web"), plugins: [{ name: "skip-media-prune", enforce: "post", configResolved(config) { config.plugins = config.plugins.filter(plugin => plugin.name !== "beeftv-prune-optional-media"); } }], build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: resolve(root, "web/test/fixtures/project-asset-images.html") } } });
const server = createServer(async (request, response) => {
    try {
        const path = resolve(dist, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
        if (!path.startsWith(dist + sep)) throw new Error("invalid path");
        response.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm" })[extname(path)] || "application/octet-stream" });
        response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const submissions = [], errors = [], report = [];
let savedConfig = {}, configRevision = 0, remote = 0, failNextSubmission = false;
let workspace = {}, catalog = [], rejectBinding = false;
let chapterTask, savedShots;
let replacementAttempts = 0, rejectNextReplacement = false;
const savedRevisions = [];
const bindingCalls = [];
await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && !["blob:", "data:"].includes(url.protocol)) { remote++; return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = data => route.fulfill({ json: { code: 0, data, msg: "offline test" } });
    if (promptFixture && url.pathname === "/api/skills/added") return json({ skills: skillDefinitions.map(skill => ({ skillId: skill.skill_id, skillName: skill.skill_name, description: skill.description, versionId: "offline-version", version: "1.0.0", isAdded: true, status: 1 })) });
    const skillFile = url.pathname.match(/^\/api\/skills\/([^/]+)\/(files|file)$/);
    if (promptFixture && skillFile) {
        const file = { path: "references/video-generation.md", kind: "markdown", sha256: "offline-guide", size: 400 };
        return json(skillFile[2] === "files" ? { files: [file] } : { file: { file, content: videoGuides.get(skillFile[1]), binary: false } });
    }
    if (jiasuJ2Fixture && request.method() === "POST" && url.pathname === "/api/resources") {
        if (failNextMaskUpload) {
            failNextMaskUpload = false;
            return route.fulfill({ status: 400, json: { code: 400, msg: "离线测试：处理图保存失败", reason: "invalid_input" } });
        }
        const form = await new Response(request.postDataBuffer(), { headers: { "Content-Type": request.headers()["content-type"] } }).formData();
        const bytes = Buffer.from(await form.get("file").arrayBuffer());
        const id = `j2-masked-${maskedUploads.length + 1}`;
        imageResources.set(id, bytes);
        maskedUploads.push({ id, bytes });
        return json({ resource: { id, mimeType: "image/png", size: bytes.length, width: Number(form.get("width")), height: Number(form.get("height")), status: "ready" } });
    }
    const imageResource = url.pathname.match(/^\/api\/resources\/([^/]+)(\/file)?$/);
    if (jiasuJ2Fixture && imageResource && imageResources.has(imageResource[1])) {
        const id = imageResource[1], bytes = imageResources.get(id);
        return imageResource[2] ? route.fulfill({ contentType: "image/png", body: bytes }) : json({ resource: { id, mimeType: "image/png", size: bytes.length, status: "ready" } });
    }
    if (url.pathname === "/api/workspace/model-config") {
        if (request.method() === "PUT") { savedConfig = request.postDataJSON().config; configRevision++; return json({ saved: true, revision: configRevision }); }
        return json({ config: savedConfig, revision: configRevision, health: "ready", source: "builtin+local" });
    }
    if (url.pathname.endsWith("/units/unit/workspace")) return json(workspace);
    if (bindingFixture && /\/shots\/[^/]+\/assets$/.test(url.pathname) && request.method() === "POST") {
        if (rejectBinding) return route.fulfill({ status: 400, json: { code: 400, msg: "离线测试：资产绑定失败", reason: "invalid_input" } });
        const input = request.postDataJSON();
        const asset = catalog.find(candidate => candidate.primaryVersionId === input.assetVersionId);
        assert.ok(asset, "only this project's asset versions can be linked");
        bindingCalls.push(input.assetVersionId);
        const reference = { id: `bound-${bindingCalls.length}`, shotId: decodeURIComponent(url.pathname.split("/").at(-2)), ...input, status: "linked", asset };
        workspace.shotReferences.push(reference);
        workspace.assets = catalog.filter(candidate => workspace.shotReferences.some(item => item.assetVersionId === candidate.primaryVersionId));
        return json({ reference });
    }
    if (request.method() === "POST" && /\/projects\/fixture-project\/shots$/.test(url.pathname)) { savedRevisions.push(request.postDataJSON()); return json({ shot: { ...request.postDataJSON(), currentRevisionId: "saved-revision" } }); }
    if ((sceneBindingFixture || overwriteFixture) && request.method() === "PUT" && /\/units\/unit\/shots$/.test(url.pathname)) {
        replacementAttempts++;
        const input = request.postDataJSON();
        if (overwriteFixture) assert.deepEqual(new Set(input.expectedShotIds), new Set(workspace.shots.map(shot => shot.id)));
        if (rejectNextReplacement) { rejectNextReplacement = false; return route.fulfill({ status: 400, json: { code: 400, msg: "离线测试：保存失败，旧分镜保留", reason: "invalid_input" } }); }
        savedShots = input.shots;
        if (overwriteFixture) workspace = { ...workspace, shots: savedShots.map((shot, index) => ({ ...shot, id: `new-shot-${index}`, unitId: "unit", position: index, updatedAt: new Date().toISOString() })) };
        if (reviewFixture) {
            workspace.shots = workspace.shots.map((shot, index) => ({ ...shot, currentRevisionId: `density-revision-${index}` }));
            workspace.shotRevisions = savedShots.map((shot, index) => ({ ...shot.revision, id: `density-revision-${index}`, shotId: `new-shot-${index}`, actionBeatsJson: JSON.stringify(shot.revision.actionBeats), version: 1 }));
        }
        return json({ shots: savedShots });
    }
    if ((sceneBindingFixture || overwriteFixture) && url.pathname.endsWith("/chapter-task/text-events")) return route.fulfill({ contentType: "text/event-stream", body: 'id: 1\nevent: terminal\ndata: {"status":"succeeded"}\n\n' });
    if ((sceneBindingFixture || overwriteFixture) && url.pathname.endsWith("/tasks/chapter-task")) return json(chapterTask);
    if (request.method() === "POST" && url.pathname === "/api/tasks") {
        if (failNextSubmission) {
            failNextSubmission = false;
            return route.fulfill({ status: 400, json: { code: 400, msg: "离线测试：模型参数校验失败", reason: "invalid_input" } });
        }
        submissions.push(request.postDataJSON());
        if (chapterModelFixture) return route.fulfill({ status: 400, json: { code: 400, msg: "离线回归：已捕获请求，未调用模型", reason: "invalid_input" } });
        if ((sceneBindingFixture || overwriteFixture) && submissions.at(-1).operation === "storyboard") {
            const timeBeats = sequenceFixture ? storyboardSequencePrompt.split("\n\n").filter(section => section.startsWith("镜头")).join("\n\n") : densityFixture ? "0–7s：大殿全景，嬴政沉重喘息。\n7–15s：中景推近，抬起右手。\n15–22s：面部特写，眼皮颤合。\n22–30s：近景仰角，双目闭合，呼吸拉长。" : "0–10s 抬头；10–20s 环顾；20–30s 停顿";
            const row = { durationSeconds: 30, plotDescription: "角色原图甲在古城场景观察四周", dialogue: "", characters: ["角色原图甲"], sceneAssetId: "scene", sceneName: "古城场景", propNames: [], assetBindings: [{ nodeId: "scene", role: "environment", priority: 100 }], timeBeats, videoMotionPrompt: sequenceFixture ? storyboardSequencePrompt : timeBeats, imageGenerationPrompt: "角色原图甲站在古城场景" };
            const rows = overwriteFixture ? Array.from({ length: 4 }, (_, index) => ({ ...row, shotNumber: index + 1, characters: [], assetBindings: catalog.slice(0, index === 3 ? 7 : 3).map(asset => ({ nodeId: asset.id, role: asset.category, priority: 100 })) })) : [row];
            chapterTask = { id: "chapter-task", projectId: "fixture-project", type: "canvas_text", status: "succeeded", resultJson: JSON.stringify({ rows }), inputJson: JSON.stringify(submissions.at(-1).input), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
            return json({ ...chapterTask, status: "queued" });
        }
        const task = { id: `video-task-${submissions.length}`, type: "canvas_video", status: "queued", clientContext: { shotId: submissions.at(-1).input.metadata.shotId, artifactType: "video" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (workflowRetryFixture) workspace.tasks.push(task);
        return json(task);
    }
    if (url.pathname.includes("/resources/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" />' });
    if (/\/tasks$/.test(url.pathname)) return json(overwriteFixture && chapterTask ? [chapterTask] : []);
    if (/\/assets$/.test(url.pathname)) return json({ assets: bindingFixture ? catalog : [], total: catalog.length, categoryCounts: {}, folderCounts: {}, page: 1, pageSize: 24, hasMore: false });
    return json({ skills: [], folders: [], sources: [], data: [] });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
const settings = page.locator("details").filter({ has: page.locator("summary", { hasText: "生成设置" }) });
const audio = page.getByRole("switch", { name: "生成声音", exact: true });
const submit = async expectedAudio => {
    const count = submissions.length;
    await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/tasks") && response.request().method() === "POST"), page.getByRole("button", { name: /^生成镜头视频/ }).click()]);
    assert.equal(submissions.length, count + 1, "exactly one local task must be submitted");
    assert.equal(submissions.at(-1).input.config.videoGenerateAudio, expectedAudio, "the user's audio preference must reach the video task");
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some(button => /生成镜头视频/.test(button.textContent || "") && button.classList.contains("ant-btn-loading")));
};
try {
    const query = new URLSearchParams();
    if (bindingFixture) query.set("bindings", "1");
    if (sceneBindingFixture) query.set("scene-binding", "1");
    if (overwriteFixture) query.set("chapter-overwrite", "1");
    if (workflowRouteFixture) query.set("workflow-regression", "1");
    if (jiasuFixture) query.set("provider", jiasuJ3Fixture ? "jiasu-j3" : workflowRetryFixture || promptFixture || jiasuJ2Fixture || sceneBindingFixture ? "jiasu-j2" : "jiasu");
    await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/project-asset-images.html?${query}`);
    await page.waitForFunction(() => Boolean(window.projectImageFixture));
    workspace = await page.evaluate(() => structuredClone(window.projectImageFixture.videoDetail));
    catalog = await page.evaluate(() => structuredClone(window.projectImageFixture.bindingAssets));
    await page.getByRole("button", { name: "测试视频页", exact: true }).click();
    if (workflowRetryFixture) {
        workspace.shotReferences = catalog.map((asset, index) => ({ id: `existing-${index}`, shotId: "shot", assetVersionId: asset.primaryVersionId, status: "linked", role: "reference", asset }));
        workspace.assets = catalog;
        workspace.tasks = [
            { id: "image-running", type: "canvas_image", status: "running", clientContext: { shotId: "shot", artifactType: "storyboard" }, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-21T09:00:00Z" },
            { id: "video-failed", type: "canvas_video", status: "failed", clientContext: { shotId: "shot", artifactType: "video" }, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T08:00:00Z" },
        ];
        const refresh = () => page.evaluate(() => window.projectImageFixture.refreshVideoWorkspace());
        await refresh();
        const retry = page.locator(".workflow-preview-actions button").first();
        assert.equal(await retry.isEnabled(), true);
        await retry.click();
        await page.waitForFunction(() => document.querySelector(".workflow-editor-actions .ant-btn-loading") !== null);
        await page.getByRole("button", { name: /生成镜头视频（已运行/ }).waitFor();
        assert.equal(submissions.length, 1, "failed video reuses existing references despite the image task");
        assert.equal(submissions[0].type, "canvas_video");
        assert.equal(submissions[0].input.config.interfaceType, "jiasu-video");
        assert.equal(submissions[0].input.config.model, "sd-2.5-j2-V");
        assert.equal(submissions[0].input.referenceImages.length, 2);
        assert.equal(bindingCalls.length, 0, "existing bindings are not modified");
        assert.equal(await retry.isDisabled(), true, "a queued video cannot be submitted twice");
        assert.match(await page.locator(".workflow-timeline-status").innerText(), /生成中/);
        workspace.tasks.at(-1).status = "failed";
        workspace.tasks.at(-1).updatedAt = "2026-10-22T00:00:00Z";
        await refresh();
        await page.getByRole("button", { name: "生成镜头视频（重新提交）", exact: true }).waitFor();
        assert.equal(await retry.isEnabled(), true);
        assert.match(await page.locator(".workflow-timeline-status").innerText(), /生成失败/);
        await retry.click();
        await page.getByRole("button", { name: /生成镜头视频（已运行/ }).waitFor();
        assert.equal(submissions.length, 2);
        await page.screenshot({ path: resolve(output, "retry-with-other-stage.png") });
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, failedVideoCanRetry: true, sameStageDuplicatesBlocked: true, videoModel: submissions[0].input.config.model, externalRequests: remote }));
    } else if (chapterModelFixture) {
        const defaultModel = "text-fixture::offline-text";
        const preferredModel = "text-fixture::offline-text-second";
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        const openStoryboard = async () => {
            await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
            await page.getByRole("dialog", { name: "生成章节分镜", exact: true }).waitFor();
        };
        const dialog = page.getByRole("dialog", { name: "生成章节分镜", exact: true });
        const picker = dialog.locator(".canvas-composer-model-picker");
        const closeDialog = async () => {
            await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
            await dialog.waitFor({ state: "hidden" });
        };
        await openStoryboard();
        assert.match(await picker.innerText(), /offline-text/);
        await picker.click();
        const list = page.getByRole("listbox", { name: "选择用于生成分镜的文本模型", exact: true });
        assert.deepEqual(await list.locator(".canvas-model-picker-brand-copy strong").allTextContents(), ["离线文本模型"]);
        await list.getByRole("button", { name: /离线文本模型/ }).click();
        const options = list.getByRole("option");
        assert.equal(await options.count(), 2);
        assert.ok((await options.allTextContents()).every(text => !/gpt-image|seedance|suno|dola/.test(text)));
        const preferenceSaved = page.waitForResponse(response => response.url().endsWith("/api/workspace/model-config") && response.request().method() === "PUT" && response.request().postDataJSON().config.projectWorkflowModels?.["fixture-project"]?.chapterText === preferredModel);
        await list.getByRole("option", { name: /offline-text-second/ }).click();
        await closeDialog();
        await openStoryboard();
        assert.match(await picker.innerText(), /offline-text-second/, "closing and reopening must retain the chosen model");
        await page.waitForFunction(model => window.projectImageFixture.readConfig().projectWorkflowModels?.["fixture-project"]?.chapterText === model, preferredModel);
        await preferenceSaved;
        assert.equal(savedConfig.textModel, defaultModel, "a project preference must not change the global default");
        await closeDialog();
        await page.getByRole("button", { name: "测试资产页", exact: true }).click();
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await openStoryboard();
        assert.match(await picker.innerText(), /offline-text-second/);
        await page.screenshot({ path: resolve(output, "remembered-model-dark.png"), animations: "disabled" });
        const fixtureURL = page.url();
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForFunction(model => window.projectImageFixture?.readConfig().projectWorkflowModels?.["fixture-project"]?.chapterText === model, preferredModel);
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await openStoryboard();
        assert.match(await picker.innerText(), /offline-text-second/);
        await closeDialog();
        await page.evaluate(model => window.projectImageFixture.setDefaultTextModel(model), defaultModel);
        await page.getByRole("button", { name: "提取角色、场景与道具", exact: true }).click();
        const extractDialog = page.getByRole("dialog", { name: "提取章节角色、场景与道具", exact: true });
        assert.match(await extractDialog.locator(".canvas-composer-model-picker").innerText(), /offline-text-second/);
        await extractDialog.getByRole("button", { name: /^取\s*消$/ }).click();
        const otherProjectURL = new URL(fixtureURL);
        otherProjectURL.searchParams.set("project", "other-project");
        await page.goto(otherProjectURL.toString());
        await page.waitForFunction(() => Boolean(window.projectImageFixture));
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await openStoryboard();
        assert.match(await picker.innerText(), /^offline-text$/);
        await page.evaluate(model => window.projectImageFixture.setDefaultTextModel(model), preferredModel);
        await dialog.getByRole("button", { name: "offline-text-second", exact: true }).waitFor();
        await closeDialog();
        await page.goto(fixtureURL);
        await page.waitForFunction(model => window.projectImageFixture?.readConfig().projectWorkflowModels?.["fixture-project"]?.chapterText === model, preferredModel);
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await openStoryboard();
        const submissionCaptured = page.waitForResponse(response => response.url().endsWith("/api/tasks") && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "生成分镜", exact: true }).click();
        await submissionCaptured;
        await dialog.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "生成到分镜制作", exact: true }).waitFor();
        assert.equal(submissions.length, 1);
        assert.equal(submissions[0].model, preferredModel);
        assert.equal(submissions[0].input.config.model, "offline-text-second");
        await page.evaluate(() => window.projectImageFixture.removeChannel("text-fixture"));
        await openStoryboard();
        await dialog.getByText("上次选择的文本模型当前不可用，请重新选择；不会自动切换到其他模型。", { exact: true }).waitFor();
        assert.equal(await dialog.getByRole("button", { name: "生成分镜", exact: true }).isDisabled(), true);
        assert.equal(submissions.length, 1, "an unavailable selection must not create another task");
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["First use follows the configured default and the picker contains only text models", "Cancel/reopen and leaving/reentering retain the selected channel/model", "Clearing browser storage and reloading restores the selection from the local model-config API", "Chapter asset extraction shares the remembered text model without changing global defaults", "Projects keep separate choices and unselected projects follow global default changes", "Submission uses exactly the selected text model and missing selections are blocked"], submissions: submissions.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (promptFixture) {
        await page.getByRole("button", { name: "按规则匹配", exact: true }).click();
        await page.getByText("镜头资产", { exact: true }).waitFor();
        if (!(await settings.evaluate(element => element.open))) await settings.locator(":scope > summary").click();
        const skillPicker = page.getByRole("combobox", { name: "本次生成使用的技能", exact: true });
        for (const skill of skillDefinitions) {
            await skillPicker.click();
            await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").getByText(skill.skill_name, { exact: true }).click();
            await skillPicker.press("Escape");
        }
        const preview = page.locator("details").filter({ has: page.locator("summary", { hasText: "最终提交提示词" }) });
        await preview.locator(":scope > summary").click();
        const fullPrompt = page.getByRole("textbox", { name: "最终提交提示词全文", exact: true });
        await page.waitForFunction(() => {
            const value = document.querySelector('[aria-label="最终提交提示词全文"]')?.value || "";
            return value.includes("【世界观美术设定】") && value.includes("【AI演员微表情导演】") && value.includes("【OC魅力诊断师】");
        });
        const text = await fullPrompt.inputValue();
        assert.ok(text.length < 3000, "the three selected skills must not inject their full Agent workflows");
        assert.match(text, /@图片1/);
        assert.match(text, /@图片2/);
        assert.match(text, /世界观/);
        assert.match(await preview.innerText(), /15000/);
        await submit("true");
        assert.equal(submissions.at(-1).input.prompt, text, "submitted prompt must exactly match the preview");
        assert.equal(submissions.at(-1).input.metadata.skillFiles.length, 3);
        assert.ok(submissions.at(-1).input.metadata.skillFiles.every(file => file.path === "references/video-generation.md"));
        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, "complete-prompt-dark.png"), animations: "disabled" });
        const longPrompt = "文".repeat(15001);
        await page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true }).fill(longPrompt);
        await page.getByText("完整提示词超过模型上限", { exact: true }).waitFor();
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByText(/最终提交提示词共 .*当前模型上限 15000/).first().waitFor();
        assert.equal(submissions.length, 1, "over-limit prompts must never submit another task");
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, "over-limit-light.png"), animations: "disabled" });
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["Three selected skills use concise video rules", "Full prompt and character breakdown are visible", "Submitted prompt exactly matches preview including asset bindings", "Over 15000 characters blocks locally without another task", "Preview works in dark and light themes"], promptChars: Array.from(text).length, submissions: submissions.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (overwriteFixture) {
        const initial = await page.evaluate(() => structuredClone(window.projectImageFixture.chapterDetail));
        workspace = structuredClone(initial);
        catalog = initial.assets;
        const originalIds = workspace.shots.map(shot => shot.id);
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
        const mode = page.getByRole("combobox", { name: "分镜拆解模式", exact: true });
        await mode.click();
        await mode.press("ArrowDown");
        await mode.press("Enter");
        await page.waitForFunction(() => window.projectImageFixture.readConfig().projectChapterStoryboardModes?.["fixture-project"] === "continuous_30s");
        if (reviewFixture) await page.getByText("每段总时长 30 秒，视频提示词目标 800–1000 字", { exact: false }).waitFor();
        rejectNextReplacement = true;
        await page.getByRole("button", { name: "重新生成分镜", exact: true }).click();
        await page.getByRole("button", { name: "生成成功后替换", exact: true }).click();
        await page.getByRole("button", { name: "应用已生成分镜", exact: true }).waitFor();
        assert.equal(submissions.length, 1);
        assert.equal(replacementAttempts, 1);
        if (reviewFixture) {
            assert.ok(submissions[0].prompt.includes(initial.units[0].sourceText), "the complete original chapter reaches the text task");
            for (const rule of ["800–1000", "整体设定", "镜头1 / 镜头2 / 镜头3", "起幅", "落幅", "→", "结尾约束", "单镜头只保留一种运镜", "禁止写绝对秒数", "原文剧情节点", "不得用停顿"]) assert.ok(submissions[0].prompt.includes(rule), `the text task receives ${rule}`);
            assert.equal(submissions[0].input.shotDurationSeconds, 30);
            assert.equal(submissions[0].input.metadata.storyboardMode, "continuous_30s");
            assert.ok(!submissions[0].prompt.includes("0–6s、6–13s、13–22s、22–30s"), "old equal-length examples are removed");
        }
        assert.deepEqual(workspace.shots.map(shot => shot.id), originalIds);
        assert.equal(workspace.shots.length, 13);
        await page.getByText("生成到分镜制作（新结果待保存）", { exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, "save-failure-preserves-old.png"), animations: "disabled" });
        await page.getByRole("button", { name: "应用已生成分镜", exact: true }).click();
        await page.getByRole("button", { name: "应用并替换", exact: true }).click();
        await page.waitForFunction(() => window.projectImageFixture.currentChapterDetail.shots.length === 4);
        assert.equal(replacementAttempts, 2);
        assert.equal(submissions.length, 1);
        assert.ok(savedShots.every(shot => shot.durationMs === 30000 && shot.revision.durationMs === 30000));
        assert.equal(savedShots[3].assetVersionIds.length, 7);
        if (densityFixture) {
            await page.getByText("30 秒分镜脚本建议", { exact: true }).waitFor();
            await page.getByText("查看 4 段检查建议", { exact: true }).click();
            await page.getByText("包含秒数或时间码，请改用镜头顺序描述", { exact: false }).first().waitFor();
            assert.ok(savedShots.every(shot => shot.revision.action.includes("0–7s：大殿全景，嬴政沉重喘息。")), "quality review preserves the generated content");
            assert.equal(submissions.length, 1, "quality review must not trigger paid retries");
        }
        assert.ok(workspace.shots.every(shot => !originalIds.includes(shot.id)));
        if (workflowRouteFixture) {
            await page.getByLabel("工作流路由", { exact: true }).waitFor();
            assert.match(await page.getByLabel("工作流路由", { exact: true }).innerText(), /\/video$/, "saved chapter shots must open video production immediately");
            assert.ok(!(await page.locator(".workflow-model-picker").innerText()).includes("gpt-image"));
            assert.equal(await page.locator("details[open]").count(), 3, "generation settings and both prompt sections open by default");
        }
        await page.screenshot({ path: resolve(output, "four-thirty-second-shots.png"), animations: "disabled" });
        if (reviewFixture) {
            await page.getByRole("button", { name: "测试分镜页", exact: true }).click();
            const review = page.getByRole("alert").filter({ hasText: "原始拆解提示词建议" });
            const editor = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
            await editor.waitFor();
            if (sequenceFixture) {
                assert.ok(savedShots.every(shot => shot.revision.videoPrompt.startsWith(storyboardSequencePrompt)), "numbered shots are saved intact with their asset references");
                await page.waitForFunction(() => {
                    const editor = document.querySelector('[aria-label="视频提示词，可使用 @ 引用已绑定资产"]');
                    return (editor?.value ?? editor?.textContent ?? "").includes("镜头6：");
                });
                assert.match(await editor.evaluate(element => element.value ?? element.textContent), /镜头6：/);
                assert.equal(await review.count(), 0, "six complete shots do not require a fixed shot count or a timeline");
                assert.equal(await page.getByText("30 秒分镜脚本建议", { exact: true }).count(), 0);
            } else {
                await review.waitFor();
                assert.match(await review.innerText(), /800–1000/);
            }
            await page.screenshot({ path: resolve(output, "prompt-review-dark.png"), animations: "disabled" });
            await page.getByRole("button", { name: "切换主题", exact: true }).click();
            await page.screenshot({ path: resolve(output, "prompt-review-light.png"), animations: "disabled" });
            assert.equal(submissions.length, 1);
        }
        await page.reload();
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await page.getByText("生成到分镜制作（已生成）", { exact: true }).waitFor();
        assert.equal(replacementAttempts, 2);
        assert.equal(submissions.length, 1);
        workspace = structuredClone(initial);
        await page.reload();
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await page.waitForFunction(() => window.projectImageFixture.currentChapterDetail.shots.length === 4);
        assert.equal(replacementAttempts, 3);
        assert.equal(submissions.length, 1);
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: [...(reviewFixture ? ["The full chapter and numbered-shot rules reach the text task with duration=30", sequenceFixture ? "Six naturally ordered shots with opening/closing frames and 800-1000 characters pass without timeline requirements" : "Timestamped sparse prompts are reported without rewriting content or automatic generation"] : []), "Failed save preserves all 13 old shots and displays result pending save", "Retry applies 4 thirty-second shots with all 7 asset bindings and no new generation", "Reload does not replay an already applied task", "Reload restores an unapplied completed task without generation"], externalRequests: remote, submissions: submissions.length, replacementAttempts, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (sceneBindingFixture) {
        await page.getByRole("button", { name: "补齐本章资产", exact: true }).click();
        await page.getByText("本章资产已检查，补齐 4 个绑定；未提交生成任务", { exact: true }).waitFor({ state: "attached" });
        await page.getByText("已绑定 2 项", { exact: true }).waitFor();
        const references = shotId => workspace.shotReferences.filter(reference => reference.shotId === shotId).map(reference => reference.assetVersionId);
        assert.deepEqual(new Set(references("shot")), new Set(["scene-v1", "char-ready-v1", "prop-v1"]));
        assert.deepEqual(new Set(references("shot-2")), new Set(["char-ready-old", "scene-v1"]));
        assert.deepEqual(references("shot-3"), ["garden-v1"]);
        assert.equal(submissions.length, 0);
        await page.getByRole("button", { name: "补齐本章资产", exact: true }).click();
        await page.getByText("本章资产已检查，补齐 0 个绑定；未提交生成任务", { exact: true }).waitFor({ state: "attached" });
        assert.equal(bindingCalls.length, 4);
        await settings.locator(":scope > summary").click();
        assert.equal(await page.getByRole("spinbutton", { name: "镜头时长（秒）" }).inputValue(), "30");
        await submit("true");
        assert.equal(submissions.at(-1).input.config.videoSeconds, "30");
        assert.equal(submissions.at(-1).input.referenceImages.length, 2);
        assert.ok(savedRevisions.at(-1).revision.actionBeats.some(beat => beat.type === "asset_context"));
        await page.evaluate(() => window.setWorkflowVideoModel("jiasu-fixture::sd-2.0-mini-J1"));
        await page.getByText("当前模型不支持 30 秒镜头", { exact: true }).waitFor();
        const beforeUnsupported = submissions.length;
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByRole("alert").filter({ hasText: "生成未提交" }).waitFor();
        assert.equal(submissions.length, beforeUnsupported);
        await page.screenshot({ path: resolve(output, "scene-binding-dark.png"), animations: "disabled" });
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
        await page.screenshot({ path: resolve(output, "scene-binding-light.png"), animations: "disabled" });
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
        const modeSelect = page.getByRole("combobox", { name: "分镜拆解模式", exact: true });
        await modeSelect.click();
        await modeSelect.press("ArrowDown");
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith("/api/workspace/model-config") && response.request().method() === "PUT" && response.request().postDataJSON().config.projectChapterStoryboardModes?.["fixture-project"] === "continuous_30s"),
            modeSelect.press("Enter"),
        ]);
        await page.waitForFunction(() => window.projectImageFixture.readConfig().projectChapterStoryboardModes?.["fixture-project"] === "continuous_30s");
        await page.screenshot({ path: resolve(output, "mode-dialog.png"), animations: "disabled" });
        await page.reload();
        await page.getByRole("button", { name: "测试章节页", exact: true }).click();
        await page.getByRole("button", { name: "生成到分镜制作", exact: true }).click();
        await page.getByText("每段总时长 30 秒，视频提示词目标 800–1000 字", { exact: false }).waitFor();
        await page.getByRole("button", { name: "生成分镜", exact: true }).click();
        await page.waitForResponse(response => response.url().endsWith("/units/unit/shots") && response.request().method() === "PUT");
        const chapterSubmission = submissions.at(-1);
        assert.equal(chapterSubmission.input.shotDurationSeconds, 30);
        assert.equal(chapterSubmission.input.metadata.storyboardMode, "continuous_30s");
        assert.match(chapterSubmission.prompt, /禁止写绝对秒数/);
        assert.match(chapterSubmission.prompt, /sceneAssetId/);
        assert.equal(savedShots[0].durationMs, 30000);
        assert.ok(savedShots[0].assetVersionIds.includes("scene-v1"));
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["Every shot inherits its environment until an explicit scene change", "Props remain shot-specific and pinned character versions stay unchanged", "Chapter repair is idempotent and consumes no generation requests", "30 second video duration and asset context survive submission; incompatible models are blocked", "Chapter mode survives reload and reaches the text task, output mapping and saved shot"], submissions: submissions.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (rememberModelFixture) {
        const preferredVideo = "jiasu-fixture::sd-2.5-j2-V";
        const preferredImage = "fixture::gpt-image-1";
        const prompt = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
        const summary = settings.locator(":scope > summary");
        const chooseModel = async (channel, model) => {
            if (!(await settings.evaluate(element => element.open))) await summary.click();
            await page.locator(".workflow-model-picker").click();
            await page.getByRole("button", { name: channel }).click();
            await page.getByRole("option", { name: model }).click();
        };
        await prompt.fill("模型切换前未保存的提示词");
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith("/api/workspace/model-config") && response.request().method() === "PUT" && response.request().postDataJSON().config.projectWorkflowModels?.["fixture-project"]?.video === preferredVideo),
            chooseModel(/离线佳速模型/, /sd-2.5-j2-V/),
        ]);
        assert.match(await prompt.innerText(), /模型切换前未保存的提示词/);
        await page.waitForFunction(model => window.projectImageFixture.readConfig().projectWorkflowModels?.["fixture-project"]?.video === model, preferredVideo);
        assert.equal(savedConfig.projectWorkflowModels["fixture-project"].video, preferredVideo);
        await page.evaluate(() => window.projectImageFixture.setDefaultVideoModel("mints-fixture::doubao-seedance-2-0-260128"));
        assert.match(await summary.innerText(), /sd-2.5-j2-V/);
        assert.match(await prompt.innerText(), /模型切换前未保存的提示词/);
        await page.getByRole("button", { name: "测试资产页", exact: true }).click();
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        assert.match(await summary.innerText(), /sd-2.5-j2-V/);
        await page.getByRole("button", { name: "测试分镜页", exact: true }).click();
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith("/api/workspace/model-config") && response.request().method() === "PUT" && response.request().postDataJSON().config.projectWorkflowModels?.["fixture-project"]?.storyboard === preferredImage),
            chooseModel(/离线图片模型/, /场景专用测试模型/),
        ]);
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        assert.match(await summary.innerText(), /sd-2.5-j2-V/);
        await page.waitForFunction(model => window.projectImageFixture.readConfig().projectWorkflowModels?.["fixture-project"]?.storyboard === model, preferredImage);
        assert.equal(savedConfig.projectWorkflowModels["fixture-project"].storyboard, preferredImage);
        const fixtureURL = page.url();
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForFunction(model => window.projectImageFixture?.readConfig().projectWorkflowModels?.["fixture-project"]?.video === model, preferredVideo);
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        assert.match(await summary.innerText(), /sd-2.5-j2-V/);
        await submit("true");
        assert.equal(submissions.at(-1).model, preferredVideo);
        assert.equal(submissions.at(-1).input.config.model, "sd-2.5-j2-V");
        await page.getByRole("button", { name: "测试分镜页", exact: true }).click();
        assert.match(await summary.innerText(), /场景专用测试模型/);
        const otherProjectURL = new URL(fixtureURL);
        otherProjectURL.searchParams.set("project", "other-project");
        await page.goto(otherProjectURL.toString());
        await page.waitForFunction(model => window.projectImageFixture?.readConfig().projectWorkflowModels?.["fixture-project"]?.video === model, preferredVideo);
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        assert.match(await summary.innerText(), /doubao-seedance-2-0-mini-260615/);
        await page.goto(fixtureURL);
        await page.waitForFunction(model => window.projectImageFixture?.readConfig().projectWorkflowModels?.["fixture-project"]?.video === model, preferredVideo);
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        await page.evaluate(() => window.projectImageFixture.removeChannel("jiasu-fixture"));
        await summary.click();
        await page.getByText("请选择可用模型后再生成，不会自动切换到默认模型。", { exact: true }).waitFor();
        const beforeUnavailable = submissions.length;
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByText("上次选择的模型当前不可用，请重新选择生成模型；不会自动切换到其他模型", { exact: true }).first().waitFor();
        assert.equal(submissions.length, beforeUnavailable);
        await page.screenshot({ path: resolve(output, "unavailable-model.png"), animations: "disabled" });
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["Choosing a video model preserves unsaved prompt and overrides project/global defaults", "Model choice survives leaving/reentering the page and stays separate from storyboard choice", "Clearing browser storage and reopening restores both selections from the local model-config API", "The submitted task uses exactly the remembered channel/model", "Another project keeps its own default", "An unavailable remembered model blocks submission instead of falling back"], submissions: submissions.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (jiasuJ3Fixture) {
        assert.equal(await settings.evaluate(element => element.open), true);
        assert.match(await settings.locator(":scope > summary").innerText(), /sd-2.5-J3-doubao/);
        assert.equal(await settings.getByText("当前模型不支持 30 秒镜头", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("spinbutton", { name: "镜头时长（秒）" }).inputValue(), "30");
        const resolution = settings.locator(".ant-form-item").filter({ has: page.locator("label", { hasText: /^分辨率$/ }) }).getByRole("combobox");
        await resolution.click();
        const options = page.locator(".ant-select-dropdown:visible .ant-select-item-option-content");
        assert.deepEqual(await options.allTextContents(), ["720P", "1080P"]);
        await options.getByText("1080P", { exact: true }).click();
        await submit("true");
        const task = submissions.at(-1);
        assert.equal(task.model, "jiasu-fixture::sd-2.5-J3-doubao");
        assert.equal(task.input.config.model, "sd-2.5-J3-doubao");
        assert.equal(task.input.config.interfaceType, "jiasu-video");
        assert.equal(task.input.config.videoSeconds, "30");
        assert.equal(task.input.config.vquality, "1080p");
        assert.equal(task.input.referenceImages.length, 2);
        assert.match(task.input.prompt, /@图片1/);
        const canvas = await page.evaluate(model => window.projectImageFixture.canvasVideoRequest(model, "30", "16:9", "1080p"), task.model);
        assert.equal(canvas.model, task.input.config.model);
        assert.equal(canvas.interfaceType, task.input.config.interfaceType);
        assert.equal(canvas.videoSeconds, task.input.config.videoSeconds);
        assert.equal(String(canvas.vquality).replace(/p$/i, ""), "1080");
        await page.screenshot({ path: resolve(output, "j3-workflow-1080p.png"), animations: "disabled" });
        await page.reload();
        await page.waitForFunction(() => Boolean(window.projectImageFixture));
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        assert.match(await settings.locator(":scope > summary").innerText(), /sd-2.5-J3-doubao/);
        assert.equal(await settings.getByText("当前模型不支持 30 秒镜头", { exact: true }).count(), 0);
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, model: task.input.config.model, seconds: task.input.config.videoSeconds, resolution: task.input.config.vquality, restoredStaleProfile: true, externalRequests: remote }));
    } else if (jiasuJ2Fixture) {
        await settings.locator("summary").click();
        await settings.getByText("当前模型不接受 face 参数", { exact: false }).waitFor();
        await submit("true");
        const compareCanvas = async (masked = false) => {
            const task = submissions.at(-1);
            const config = task.input.config;
            const canvasConfig = await page.evaluate(([model, seconds, size, vquality]) => window.projectImageFixture.canvasVideoRequest(model, seconds, size, vquality), [task.model, config.videoSeconds, config.size, config.vquality]);
            const fields = ["channelId", "apiFormat", "interfaceType", "baseUrl", "apiKey", "credentialRef", "model", "headers", "size", "videoSeconds", "videoGenerateAudio", "videoWatermark", "videoJiasuFaceMode", "capabilityConfig"];
            assert.deepEqual(Object.fromEntries(fields.map(key => [key, config[key]])), Object.fromEntries(fields.map(key => [key, canvasConfig[key]])), "project video and canvas must use identical Jiasu provider settings");
            assert.equal(String(config.vquality).replace(/p$/i, ""), String(canvasConfig.vquality).replace(/p$/i, ""), "both entry points must request the same resolution");
            assert.deepEqual(new Set(task.input.referenceImages.map(image => image.storageKey)), new Set(masked ? ["resource:j2-masked-1", "resource:j2-masked-2"] : ["resource:character-original", "resource:scene-original"]));
            assert.deepEqual(task.input.referenceImages.map(image => image.name), ["角色原图甲", "古城场景"]);
            assert.match(task.input.prompt, /@图片1/, "character binding must use Jiasu native at-reference syntax");
            assert.match(task.input.prompt, /@图片2/, "scene binding must use Jiasu native at-reference syntax");
            assert.equal(config.face, undefined, "SD2 face must not leak into Jiasu");
            assert.equal(config.videoJiasuFaceMask, undefined, "local processing options must not reach upstream");
        };
        await compareCanvas();
        assert.equal(submissions.at(-1).input.config.model, "sd-2.5-j2-V");
        await settings.getByRole("button", { name: "服务端默认", exact: true }).click();
        await submit("true");
        await compareCanvas();
        assert.equal(submissions.at(-1).input.config.videoJiasuFaceMode, "default");
        const localMask = settings.getByRole("switch", { name: "自动人脸遮罩", exact: true });
        await localMask.click();
        await settings.getByRole("button", { name: "75%", exact: true }).click();
        failNextMaskUpload = true;
        const beforeFailedMask = submissions.length;
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByText("离线测试：处理图保存失败", { exact: false }).first().waitFor();
        assert.equal(submissions.length, beforeFailedMask, "failed image processing must not submit video or fall back to originals");
        assert.equal(maskedUploads.length, 0);
        await submit("true");
        await compareCanvas(true);
        assert.equal(maskedUploads.length, 2, "both bound images must be processed before the task is created");
        for (const [index, bytes] of [...originalImages.values()].entries()) assert.notDeepEqual(maskedUploads[index].bytes, bytes, "the selected reference must contain the local mask");
        await page.screenshot({ path: resolve(output, "j2-local-mask-dark.png"), animations: "disabled" });
        await page.reload();
        await page.waitForFunction(() => window.projectImageFixture?.readConfig().videoJiasuFaceMask === "grid-75");
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        await submit("true");
        await compareCanvas(true);
        assert.equal(maskedUploads.length, 2, "reopening the project must reuse its processed resources");
        await settings.locator("summary").click();
        await localMask.click();
        await page.locator(".workflow-model-picker").click();
        await page.getByRole("button", { name: /离线佳速模型/ }).click();
        await page.getByRole("option", { name: /dola-sd-2.5/ }).click();
        await settings.getByRole("button", { name: "素描处理", exact: true }).click();
        await submit("true");
        await compareCanvas();
        assert.equal(submissions.at(-1).input.config.videoJiasuFaceMode, "heavy");
        await settings.getByRole("button", { name: "保持原图", exact: true }).click();
        await submit("true");
        await compareCanvas();
        assert.equal(submissions.at(-1).input.config.videoJiasuFaceMode, "off");
        const prompt = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
        await prompt.fill("未保存的运镜和对白");
        await settings.getByRole("button", { name: "轻度处理", exact: true }).click();
        assert.match(await prompt.innerText(), /未保存的运镜和对白/);
        await page.waitForFunction(() => window.projectImageFixture.readConfig().videoJiasuFaceMode === "light");
        await page.waitForTimeout(1000);
        assert.equal(savedConfig.videoJiasuFaceMode, "light");
        await page.screenshot({ path: resolve(output, "dola-face-dark.png"), animations: "disabled" });
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
        await page.screenshot({ path: resolve(output, "dola-face-light.png"), animations: "disabled" });
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["J2-V sends the same provider settings as canvas, including both bound images", "J2-V local detection and 75% masks run before submission and preserve reference names", "Failed processing blocks submission; reopening reuses processed references and the saved mask preference", "Dola heavy and original-image modes match the working canvas settings", "Face preference persists without clearing unsaved prompt", "Other channels' face flags are absent"], submissions: submissions.length, processedImages: maskedUploads.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else if (bindingFixture) {
        const prompt = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
        await prompt.fill("角色原图甲在古城场景挥手，未保存的运镜向前推");
        await page.getByRole("button", { name: "按规则匹配", exact: true }).click();
        await page.getByText("已绑定 2 项", { exact: true }).waitFor();
        assert.match(await prompt.innerText(), /未保存的运镜向前推/);
        assert.equal(submissions.length, 0, "matching assets must not generate or upload media");
        assert.deepEqual(new Set(bindingCalls), new Set(["char-ready-v1", "scene-v1"]));
        await page.screenshot({ path: resolve(output, "bindings-dark.png") });
        await page.reload();
        workspace.shotReferences = [];
        workspace.assets = [];
        await page.getByRole("button", { name: "测试视频页", exact: true }).click();
        await submit("true");
        const task = submissions.at(-1);
        assert.equal(task.input.config.videoEggfansReferenceMode, "url");
        assert.deepEqual(new Set(task.input.referenceImages.map(image => image.storageKey)), new Set(["resource:character-original", "resource:scene-original"]));
        assert.match(task.prompt, /角色原图甲/);
        assert.match(task.prompt, /古城场景/);
        assert.equal(bindingCalls.length, 4, "generation must restore both missing references before submitting");
        await page.getByText("已绑定 2 项", { exact: true }).waitFor();
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
        await page.screenshot({ path: resolve(output, "bindings-light.png") });
        workspace.shotReferences = [];
        workspace.assets = [];
        rejectBinding = true;
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByRole("alert").filter({ hasText: "生成未提交" }).waitFor();
        assert.match(await page.getByRole("alert").filter({ hasText: "生成未提交" }).innerText(), /资产绑定失败/);
        assert.equal(submissions.length, 1);
        rejectBinding = false;
        catalog = catalog.map(asset => asset.category === "character" ? { ...asset, character: { ...asset.character, representations: [], visualStatus: "missing" } } : asset);
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        await page.getByRole("alert").filter({ hasText: "缺少参考图" }).waitFor();
        assert.equal(submissions.length, 1, "missing image must block text-only generation");
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        const result = { passed: ["Manual rule matching preserves unsaved edits and persists both assets", "Generation repairs old unbound shots and submits owned original image resources in URL mode", "Binding failure and missing images stop task submission", "Dark and light asset previews render"], submissions: submissions.length, externalRequests: remote, errors };
        await writeFile(resolve(output, "report.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } else {
    await submit("true");
    report.push("Saved audio=true reaches the video task with audio enabled by default");
    if (jiasuFixture) {
        await settings.locator("summary").click();
        assert.equal(await settings.getByText("同步声音已开启", { exact: true }).isVisible(), true);
        assert.equal(await settings.getByText("当前模型不支持同步生成音频", { exact: true }).count(), 0);
        await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/tasks") && response.request().method() === "POST"), page.getByRole("button", { name: "重新生成", exact: true }).click()]);
        assert.equal(submissions.length, 2);
        assert.equal(submissions[1].input.config.model, "sd-2.0-mini-J1");
        assert.equal(submissions[1].input.config.videoGenerateAudio, "true");
        failNextSubmission = true;
        await page.getByRole("button", { name: "重新生成", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "生成未提交" }).waitFor();
        assert.match(await page.getByRole("alert").filter({ hasText: "生成未提交" }).innerText(), /模型参数校验失败/);
        await submit("true");
        assert.equal(await page.getByRole("alert").filter({ hasText: "生成未提交" }).count(), 0);
        const advanced = page.locator("details.is-advanced");
        await advanced.locator("summary").click();
        const scene = page.getByRole("textbox", { name: "镜头画面，可使用 @ 引用已绑定资产", exact: true });
        await scene.fill("");
        assert.equal((await scene.innerText()).trim(), "");
        await advanced.locator("summary").click();
        const countBeforeValidation = submissions.length;
        await page.getByRole("button", { name: /^生成镜头视频/ }).click();
        const validationAlert = page.getByRole("alert").filter({ hasText: "生成未提交" });
        await validationAlert.waitFor();
        assert.match(await validationAlert.innerText(), /请输入镜头画面/);
        assert.equal(await advanced.getAttribute("open"), "");
        assert.equal(submissions.length, countBeforeValidation);
        await scene.fill("古城远景，风吹树叶");
        await submit("true");
        assert.equal(remote, 0);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: resolve(output, "jiasu-ready.png") });
        await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: ["Existing J1 video's main Generate and Regenerate buttons both submit audio-enabled tasks after a failed workflow stage", "Rejected submissions show the actual API error and can be retried", "Hidden required field errors expand their section and never create a task"], submissions: submissions.length, externalRequests: remote, errors }, null, 2));
        console.log("Jiasu J1 audio, Generate and Regenerate passed");
        process.exitCode = 0;
    } else {
    await settings.locator("summary").click();
    assert.equal(await audio.getAttribute("aria-checked"), "true");
    const prompt = page.getByRole("textbox", { name: "视频提示词，可使用 @ 引用已绑定资产", exact: true });
    await prompt.fill("未保存提示词：人物挥手并说你好，保留鸟鸣");
    const duration = page.getByRole("spinbutton", { name: "镜头时长（秒）" });
    await duration.fill("8");
    await page.locator(".workflow-model-picker").click();
    await page.getByRole("button", { name: /离线视频模型/ }).click();
    await page.getByRole("option", { name: /doubao-seedance-2-0-260128/ }).click();
    await audio.click();
    assert.equal(await audio.getAttribute("aria-checked"), "false");
    assert.match(await prompt.innerText(), /未保存提示词/);
    assert.equal(await duration.inputValue(), "8");
    await submit("false");
    assert.match(submissions.at(-1).input.config.model, /doubao-seedance-2-0-260128$/);
    assert.match(submissions.at(-1).prompt, /未保存提示词/);
    assert.equal(submissions.at(-1).input.config.videoSeconds, "8");
    report.push("Turning audio off preserves unsaved prompt, chosen model and duration, and submits false");
    await page.waitForFunction(() => window.projectImageFixture.readConfig().videoGenerateAudio === "false");
    await page.waitForTimeout(1200);
    assert.equal(savedConfig.videoGenerateAudio, "false");
    await page.reload();
    await page.getByRole("button", { name: "测试视频页", exact: true }).click();
    await settings.locator("summary").click();
    assert.equal(await audio.getAttribute("aria-checked"), "false");
    await audio.click();
    await submit("true");
    await page.waitForTimeout(1200);
    assert.equal(savedConfig.videoGenerateAudio, "true");
    report.push("Audio choice survives model-config save and page reload; re-enabling submits true");
    await page.screenshot({ path: resolve(output, "video-audio-dark.png") });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.screenshot({ path: resolve(output, "video-audio-light.png") });
    assert.equal(remote, 0, "no remote provider requests are allowed");
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, "report.json"), JSON.stringify({ passed: report, submissions: submissions.length, externalRequests: remote, errors }, null, 2));
    console.log(JSON.stringify({ passed: report, submissions: submissions.length, externalRequests: remote, output }, null, 2));
    }
    }
} catch (error) {
    await page.screenshot({ path: resolve(output, "failure.png") });
    if (rememberModelFixture || sceneBindingFixture || overwriteFixture) await writeFile(resolve(output, "failure-snapshot.txt"), await page.locator("body").ariaSnapshot());
    if (overwriteFixture) console.log(JSON.stringify({ submissions: submissions.length, replacementAttempts, taskStatus: chapterTask?.status, shotCount: workspace.shots?.length, errors }));
    throw error;
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
