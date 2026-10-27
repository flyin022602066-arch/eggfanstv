import { expect, test } from "bun:test";
import { prepareEditorAnalysis, type EditorAnalysisDependencies } from "@/services/editor-media-analysis";
import { defaultConfig } from "@/stores/use-config-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import type { TimelineProject } from "@/types/timeline";

const capability = defaultModelCapabilityConfig("chat-completion");
capability.text!.references.maxImages = 3;
capability.text!.references.maxImageBytes = 1024 * 1024;
const config = { ...defaultConfig, channels: [{ id: "vision", models: ["model"], modelProfiles: [{ model: "model", capabilityConfig: capability }] }] };
const project: TimelineProject = { version: 2, durationMs: 10000, tracks: [], clips: [{ id: "video", nodeId: "asset:v", kind: "video", trackId: "v", startMs: 2000, sourceStartMs: 30000, durationMs: 8000, directMedia: { id: "v", kind: "video", title: "source", storageKey: "resource:v" } }] };
const deps: EditorAnalysisDependencies = {
    readBlob: async () => new Blob(["video"], { type: "video/mp4" }),
    captureFrames: async (_blob, times) => ({ frames: times.map(timeMs => ({ timeMs, blob: new Blob(["frame"]), width: 640, height: 480 })), failures: [] }),
    encodeImage: async () => "data:image/jpeg;base64,YQ==",
    analyzeAudio: async () => ({ peak: 0.3, silence: [{ startMs: 4000, endMs: 5000 }] }),
    transcribe: async () => [{ startMs: 31000, endMs: 32000, text: "真实转写" }],
};
const options = { project, projectId: "project", assets: [], nodes: [], config, model: "vision::model", vision: true, transcribe: true };

test("actual frames and mapped speech enter the user message, not resource URLs", async () => {
    const result = await prepareEditorAnalysis(options, deps);
    expect(result.parts.filter(part => part.type === "image_url")).toHaveLength(3);
    const text = JSON.stringify(result.parts);
    expect(text).toContain("源时间 30000ms");
    expect(text).toContain("时间线 2000ms");
    expect(text).toContain("3000-4000ms");
    expect(text).toContain("真实转写");
    expect(text).not.toContain("resource:v");
});
test("director speech uses source-file times while keeping raw dialogue evidence", async () => {
    const result = await prepareEditorAnalysis({ ...options, transcriptTimebase: "source" }, deps);
    const text = JSON.stringify(result.parts);
    expect(text).toContain("源文件绝对毫秒");
    expect(text).toContain("31000-32000ms");
    expect(text).not.toContain("3000-4000ms");
    expect(result.speech.video).toEqual([{ startMs: 31000, endMs: 32000, text: "真实转写" }]);
});
test("vision capability must be explicitly enabled, with no silent text fallback", async () => {
    await expect(prepareEditorAnalysis({ ...options, config: { ...config, channels: [] } }, deps)).rejects.toThrow("看图能力");
});
test("unreadable media is reported and does not become invented analysis", async () => {
    await expect(prepareEditorAnalysis(options, { ...deps, readBlob: async () => { throw new Error("文件丢失"); } })).rejects.toThrow("文件丢失");
});
test("speech dependency failure is explicitly reported without claiming to hear dialogue", async () => {
    const result = await prepareEditorAnalysis(options, { ...deps, transcribe: async () => { throw new Error("未配置 whisper"); } });
    expect(result.report).toContain("未配置 whisper");
    expect(JSON.stringify(result.parts)).toContain("未理解声音语义");
});
test("cancelled preparation never returns a model payload", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareEditorAnalysis({ ...options, signal: controller.signal }, deps)).rejects.toThrow();
});
test("stop interrupts a blocked media read without waiting for decoder completion", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const pending = prepareEditorAnalysis({ ...options, signal: controller.signal }, { ...deps, readBlob: () => { started(); return new Promise(() => {}); } });
    await reading;
    controller.abort();
    const outcome = await Promise.race([pending.then(() => "resolved", () => "cancelled"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))]);
    expect(outcome).toBe("cancelled");
});
