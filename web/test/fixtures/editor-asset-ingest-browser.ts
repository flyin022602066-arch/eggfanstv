import { after, before, beforeEach, test as nodeTest } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, type Browser, type Page } from "playwright/test";
import type { EditorAssetIngestCall, EditorAssetIngestDoubles } from "./editor-asset-ingest-doubles";
import type { ProjectAsset, ProjectDetail } from "../../src/services/api/projects";
import type { TimelineProject } from "../../src/types/timeline";

let browser: Browser;
let page: Page;
const url = process.argv[2];
const artifactDir = process.argv[3];
const test = (name: string, body: () => Promise<void>, timeout = 15_000) => nodeTest(name, { timeout }, body);
type HarnessState = {
    doubles: EditorAssetIngestDoubles;
    assets: { id: string }[];
    projectId: string;
    switchABA: () => void;
    switchProject: () => void;
    remountEditor: () => void;
    setLibrary: (assets: ProjectAsset[], context: Pick<ProjectDetail, "units" | "shots" | "shotArtifacts">) => void;
    getTimeline: () => TimelineProject | null;
    undo: () => void;
};


before(async () => {
    const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => path && existsSync(path));
    browser = await chromium.launch({ executablePath, headless: true, timeout: 15_000 });
});
beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "导入媒体" }).waitFor({ timeout: 8_000 });
});
after(async () => { await browser?.close(); });

async function harnessState() {
    return page.evaluate(() => (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness);
}

async function hold(step: "probe" | "upload" | "link" | "refresh") {
    await page.evaluate((name) => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.doubles.hold[name] = true;
    }, step);
}

async function fail(flag: keyof EditorAssetIngestDoubles["fail"]) {
    await page.evaluate((name) => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.doubles.fail[name] = true;
    }, flag);
}

async function release(step: "probe" | "upload" | "link" | "refresh") {
    await page.evaluate((name) => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.doubles.release(name);
    }, step);
}

async function switchABA() {
    await page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.switchABA();
    });
}

async function switchProject() {
    await page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.switchProject();
    });
    await page.getByTestId("project-id").filter({ hasText: "project-b" }).waitFor({ timeout: 4_000 });
}

async function remountEditor() {
    await page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.remountEditor();
    });
    await page.getByRole("button", { name: "导入媒体" }).waitFor({ timeout: 4_000 });
}

async function importFiles(names: string[]) {
    await page.locator("input[type=file]").setInputFiles(
        names.map((name) => ({
            name,
            mimeType: name.endsWith(".png") ? "image/png" : name.endsWith(".mp3") ? "audio/mpeg" : "video/mp4",
            buffer: Buffer.from("fixture-media"),
        })),
    );
}

async function waitForCall(step: EditorAssetIngestCall["step"], phase: EditorAssetIngestCall["phase"] = "enter") {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
        const harness = await harnessState();
        if (harness?.doubles.calls.some((call) => call.step === step && call.phase === phase)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`timeout waiting for ${step} ${phase}`);
}

async function settle(ms = 400) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function writes(harness: HarnessState | undefined, step: EditorAssetIngestCall["step"]) {
    return harness?.doubles.calls.filter((call) => call.step === step && call.phase === "write") ?? [];
}

test("ordinary import probes, uploads, links and shows ready for a successful resource", async () => {
    await importFiles(["clip.mp4"]);
    await page.getByText("已导入 1 个媒体").waitFor({ timeout: 8_000 });
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
    const harness = await harnessState();
    expect(writes(harness, "probe")).toHaveLength(1);
    expect(writes(harness, "upload")).toHaveLength(1);
    expect(writes(harness, "link")).toHaveLength(1);
    expect(writes(harness, "upload")[0]?.expectedScope).toEqual(writes(harness, "upload")[0]?.liveScope);
    expect(writes(harness, "upload")[0]?.durationMs).toBe(1500);
    expect(writes(harness, "link")[0]?.projectId).toBe("project-a");
    expect(await page.getByTestId("asset-ids").textContent()).toBe("res-1");
    expect(await page.getByText("导入失败").count()).toBe(0);
}, 15_000);

async function seedEpisodeLibrary() {
    await page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness!;
        const makeAsset = (id: string, mediaType = "video"): ProjectAsset => ({
            id, title: `${id}素材`, mediaType, category: "material", status: "ready", versionCount: 1,
            usages: [], position: 0, storageKey: `resource:${id}`, durationMs: id === "ep1shot2" ? 15_000 : 30_000, updatedAt: "",
        });
        harness.setLibrary([makeAsset("ep2shot1"), makeAsset("场景", "image"), makeAsset("ep1shot2"), makeAsset("对白", "audio"), makeAsset("ep1shot1")], {
            units: [2, 1].map((number) => ({ id: `ep${number}`, projectId: "project-a", kind: "episode", title: `第${number}集`, sourceText: "", wordCount: 0, status: "ready", position: number, createdAt: "", updatedAt: "" })),
            shots: ["ep1shot2", "ep2shot1", "ep1shot1"].map((id) => ({ id, projectId: "project-a", unitId: id.slice(0, 3), title: id, description: "", position: Number(id.slice(-1)), durationMs: 30_000, status: "ready", createdAt: "", updatedAt: "" })),
            shotArtifacts: ["ep1shot2", "ep2shot1", "ep1shot1"].map((id) => ({ id: `artifact-${id}`, projectId: "project-a", shotId: id, resourceId: id, type: "video", version: 1, status: "ready", selected: true, metadataJson: "{}", createdAt: "", updatedAt: "" })),
        });
    });
    await page.getByRole("button", { name: "导入整集：第1集", exact: true }).waitFor();
}

async function timelineClips() {
    return page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness!;
        return harness.getTimeline()?.clips.map((clip) => ({ id: clip.directMedia?.id, startMs: clip.startMs, durationMs: clip.durationMs }));
    });
}

test("library only displays videos in episode and shot order, without deleting other project assets", async () => {
    await seedEpisodeLibrary();
    expect(await page.getByTitle("场景素材").count()).toBe(0);
    expect(await page.getByTitle("对白素材").count()).toBe(0);
    expect(await page.locator("li button").allTextContents()).toEqual(["ep1shot1素材video0:30", "ep1shot2素材video0:15", "ep2shot1素材video0:30"]);
    expect((await harnessState())?.assets).toHaveLength(5);
    for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
        const episode = await page.getByTitle("第1集", { exact: true }).boundingBox();
        const button = await page.getByRole("button", { name: "导入整集：第1集", exact: true }).boundingBox();
        expect(episode!.x + episode!.width).toBeLessThanOrEqual(button!.x + 1);
        expect(button!.x + button!.width).toBeLessThanOrEqual(256);
        expect(await page.locator("#root").evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);
        await page.screenshot({ path: join(artifactDir, `episode-library-${theme}.png`), clip: { x: 0, y: 0, width: 256, height: 560 } });
    }
    console.log(`Episode library screenshots: ${artifactDir}`);
    await page.getByTitle("第1集", { exact: true }).click();
    expect(await page.getByTitle("ep1shot1素材").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入整集：第1集", exact: true }).isVisible()).toBe(true);
}, 15_000);

test("episode buttons append after the previous episode, prevent double clicks and undo as a batch", async () => {
    await seedEpisodeLibrary();
    await page.getByRole("button", { name: "导入整集：第1集", exact: true }).dblclick();
    expect(await timelineClips()).toEqual([
        { id: "ep1shot1", startMs: 0, durationMs: 30_000 },
        { id: "ep1shot2", startMs: 30_000, durationMs: 15_000 },
    ]);
    await page.getByRole("button", { name: "导入整集：第2集", exact: true }).click();
    expect(await timelineClips()).toEqual([
        { id: "ep1shot1", startMs: 0, durationMs: 30_000 },
        { id: "ep1shot2", startMs: 30_000, durationMs: 15_000 },
        { id: "ep2shot1", startMs: 45_000, durationMs: 30_000 },
    ]);
    await page.evaluate(() => (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness!.undo());
    expect(await timelineClips()).toHaveLength(2);
    await page.evaluate(() => (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness!.undo());
    expect(await timelineClips()).toHaveLength(0);
    expect((await harnessState())?.doubles.calls).toHaveLength(0);
}, 15_000);

test("non-video local imports are rejected before upload", async () => {
    await importFiles(["picture.png", "voice.mp3"]);
    await page.getByText("媒体库仅显示视频，请选择视频文件").waitFor();
    expect((await harnessState())?.doubles.calls).toHaveLength(0);
}, 15_000);

test("ordinary upload error does not claim ready", async () => {
    await fail("upload");
    await importFiles(["clip.mp4"]);
    await page.getByText("「clip.mp4」网络中断").waitFor({ timeout: 8_000 });
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
    const harness = await harnessState();
    expect(writes(harness, "link")).toHaveLength(0);
    expect(await page.getByTestId("asset-ids").textContent()).toBe("");
}, 15_000);

test("failed resource status does not claim ready", async () => {
    await fail("uploadStatusFailed");
    await importFiles(["clip.mp4"]);
    await page.getByText("「clip.mp4」转码失败").waitFor({ timeout: 8_000 });
    expect(await page.getByText("已导入").count()).toBe(0);
    const harness = await harnessState();
    expect(writes(harness, "link")).toHaveLength(0);
}, 15_000);

test("link retry succeeds after one ordinary failure", async () => {
    await fail("linkOnce");
    await importFiles(["clip.mp4"]);
    await page.getByText("已导入 1 个媒体").waitFor({ timeout: 8_000 });
    const harness = await harnessState();
    expect(harness?.doubles.calls.filter((call) => call.step === "link" && call.phase === "enter")).toHaveLength(2);
    expect(writes(harness, "link")).toHaveLength(1);
}, 15_000);

test("two link failures do not claim ready", async () => {
    await fail("link");
    await importFiles(["clip.mp4"]);
    await page.getByText("「clip.mp4」已上传但挂载到项目失败，请重试").waitFor({ timeout: 8_000 });
    expect(await page.getByText("已导入").count()).toBe(0);
}, 15_000);

test("sequential batch dedupes the same filename and kind", async () => {
    await importFiles(["clip.mp4", "clip.mp4"]);
    await page.getByText("已导入 1 个，跳过 1 个重复文件").waitFor({ timeout: 8_000 });
    const harness = await harnessState();
    expect(writes(harness, "upload")).toHaveLength(1);
    expect(writes(harness, "link")).toHaveLength(1);
}, 15_000);

test("delayed probe after A→B→A does not upload, link, or paint stale status", async () => {
    await hold("probe");
    await importFiles(["clip.mp4"]);
    await waitForCall("probe");
    await switchABA();
    await release("probe");
    await settle();
    const harness = await harnessState();
    expect(writes(harness, "upload")).toHaveLength(0);
    expect(writes(harness, "link")).toHaveLength(0);
    expect(harness?.doubles.writesAfterSwitch).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByText("账号已切换").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed upload after A→B→A does not link or paint stale status", async () => {
    await hold("upload");
    await importFiles(["clip.mp4"]);
    await waitForCall("upload");
    await switchABA();
    await release("upload");
    await settle();
    const harness = await harnessState();
    expect(writes(harness, "link")).toHaveLength(0);
    expect(harness?.doubles.writesAfterSwitch).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed link after A→B→A does not write under the replacement identity", async () => {
    await hold("link");
    await importFiles(["clip.mp4"]);
    await waitForCall("link");
    await switchABA();
    await release("link");
    await settle();
    const harness = await harnessState();
    expect(writes(harness, "link")).toHaveLength(0);
    expect(harness?.doubles.writesAfterSwitch).toBe(0);
    expect(harness?.doubles.refreshAfterSwitch).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed ordinary upload error after A→B→A does not paint on the replacement generation", async () => {
    await fail("upload");
    await hold("upload");
    await importFiles(["clip.mp4"]);
    await waitForCall("upload");
    await switchABA();
    await release("upload");
    await settle();
    expect(await page.getByText("网络中断").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    const harness = await harnessState();
    expect(harness?.doubles.writesAfterSwitch).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed ordinary upload error after editor remount does not paint on the new mount", async () => {
    await fail("upload");
    await hold("upload");
    await importFiles(["clip.mp4"]);
    await waitForCall("upload");
    await remountEditor();
    await release("upload");
    await settle();
    expect(await page.getByText("网络中断").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed probe after editor remount does not continue writes or keep importing", async () => {
    await hold("probe");
    await importFiles(["clip.mp4"]);
    await waitForCall("probe");
    await remountEditor();
    await release("probe");
    await settle();
    const harness = await harnessState();
    expect(writes(harness, "upload")).toHaveLength(0);
    expect(writes(harness, "link")).toHaveLength(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed ordinary upload error after project switch does not paint on the new project", async () => {
    await fail("upload");
    await hold("upload");
    await importFiles(["clip.mp4"]);
    await waitForCall("upload");
    await switchProject();
    await release("upload");
    await settle();
    expect(await page.getByTestId("project-id").textContent()).toBe("project-b");
    expect(await page.getByText("网络中断").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed upload after project switch does not link into the new editor", async () => {
    await hold("upload");
    await importFiles(["clip.mp4"]);
    await waitForCall("upload");
    await switchProject();
    await release("upload");
    await settle();
    const harness = await harnessState();
    expect(harness?.projectId).toBe("project-b");
    expect(writes(harness, "link")).toHaveLength(0);
    expect(await page.getByTestId("asset-ids").textContent()).toBe("");
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByText("导入失败").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("delayed refresh after A→B→A does not paint ready on the replacement generation", async () => {
    await hold("refresh");
    await importFiles(["clip.mp4"]);
    await waitForCall("refresh");
    await switchABA();
    await release("refresh");
    await settle();
    const harness = await harnessState();
    expect(harness?.doubles.calls.filter((call) => call.step === "refresh" && call.phase === "write")).toHaveLength(0);
    expect(await page.getByText("已导入").count()).toBe(0);
    expect(await page.getByRole("button", { name: "导入媒体" }).count()).toBe(1);
}, 15_000);

test("a new import after A→B→A still succeeds under the live identity", async () => {
    await hold("probe");
    await importFiles(["stale.mp4"]);
    await waitForCall("probe");
    await switchABA();
    await release("probe");
    await settle();
    await page.evaluate(() => {
        const harness = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness;
        if (!harness) throw new Error("harness missing");
        harness.doubles.hold.probe = false;
        harness.doubles.resetGate("probe");
        harness.doubles.switched = false;
        harness.doubles.linked = [];
        harness.doubles.calls = [];
    });
    await importFiles(["fresh.mp4"]);
    await page.getByText("已导入 1 个媒体").waitFor({ timeout: 8_000 });
    expect(await page.getByTestId("asset-ids").textContent()).toBe("res-1");
}, 15_000);

test("old import completion cannot clear a new project import busy state", async () => {
    await hold("probe");
    await importFiles(["old.mp4"]);
    await waitForCall("probe");
    await switchProject();
    await page.evaluate(() => {
        const state = (window as Window & { __editorAssetIngestHarness?: HarnessState }).__editorAssetIngestHarness!;
        state.doubles.hold.probe = false;
        state.doubles.hold.upload = true;
    });
    await importFiles(["new.mp4"]);
    await waitForCall("upload");
    await release("probe");
    await settle();
    expect(await page.getByRole("button", { name: "导入中" }).isDisabled()).toBe(true);
    await release("upload");
    await page.getByText("已导入 1 个媒体").waitFor({ timeout: 8_000 });
}, 15_000);
