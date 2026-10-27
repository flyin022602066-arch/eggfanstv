import { createRoot } from "react-dom/client";
import { EditorStoreProvider } from "@/components/editor/editor-context";
import { EditorAiAssistant } from "@/lib/plugins/builtin/editor/editor-ai-assistant";
import { configureDesktopRuntime } from "@/services/desktop-runtime";
import { createModelChannel, defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { createEditorStore } from "@/stores/editor/editor-store";
import { useUserStore } from "@/stores/use-user-store";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ProjectAsset } from "@/services/api/projects";
import "@/styles/globals.css";

const baseURL = new URLSearchParams(window.location.search).get("relay");
if (!baseURL) throw new Error("Missing local test relay");
configureDesktopRuntime({ baseURL, launchToken: "synthetic-desktop-token" });
useUserStore.setState({ storageMode: "local" });
const multimodal = new URLSearchParams(window.location.search).has("multimodal");
const director = new URLSearchParams(window.location.search).has("director");
const capability = defaultModelCapabilityConfig("chat-completion");
capability.text!.references.maxImages = 3;
capability.text!.references.maxImageBytes = 1024 * 1024;
useConfigStore.setState({ config: {
    ...defaultConfig,
    channels: [createModelChannel({
        id: "assistant-test", name: "Eggfans TV", baseUrl: "https://api.eggfans.com",
        apiKey: "synthetic-model-key", models: ["gpt-6.1-sol"],
        headers: [{ name: "X-Test-Channel", value: "editor-assistant" }],
        modelProfiles: [{ model: "gpt-6.1-sol", capability: "text", protocol: "chat-completion", capabilityConfig: multimodal ? capability : undefined }],
    })],
    model: "unrelated::image-model",
    textModel: "assistant-test::gpt-6.1-sol",
    textModels: ["assistant-test::gpt-6.1-sol"],
} });
const store = createEditorStore();
store.getState().load({ version: 2, durationMs: 10_000,
    tracks: [{ id: "video-track", kind: "video", label: "视频", order: 0 }],
    clips: [{ id: "clip-1", kind: "video", nodeId: "test-media", trackId: "video-track", startMs: 0, durationMs: 10_000, title: "测试素材", sourceStartMs: multimodal ? 2000 : 0, sourceDurationMs: 14000, directMedia: multimodal ? { id: "fixture", kind: "video", title: "本地合成视频", storageKey: "resource:synthetic-video", url: "/synthetic-video.mp4" } : undefined }],
});
if (director) {
    const base = store.getState().project!;
    store.getState().load({ ...base, durationMs: 120000, clips: Array.from({ length: 12 }, (_, index) => ({ ...base.clips[0], id: `clip-${index + 1}`, startMs: index * 10000, sourceStartMs: 0 })) });
}
let exportOpened = 0;
const assets: ProjectAsset[] = director ? [{ id: "library-video", title: "媒体库中的完整视频", mediaType: "video", category: "scene", status: "ready", versionCount: 1, usages: [], position: 0, updatedAt: "fixture", durationMs: 14000, storageKey: "resource:synthetic-video" }] : [];
Object.assign(window, { editorAssistantHarness: { project: () => store.getState().project, exportOpened: () => exportOpened, move: () => store.getState().dispatch({ op: "moveClip", payload: { id: "clip-1", startMs: 1000 } }), disableVision: () => useConfigStore.setState({ config: { ...useConfigStore.getState().config, channels: useConfigStore.getState().config.channels.map(channel => ({ ...channel, modelProfiles: [{ model: "gpt-6.1-sol", capability: "text", protocol: "chat-completion" }] })) } }) } });
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(
    <EditorStoreProvider store={store} host={{ projectId: "offline-editor", assets, refreshAssets: async () => assets, openExport: () => { exportOpened++; } }}>
        <div style={{ height: director ? 760 : 620, width: 460, maxWidth: "calc(100vw - 32px)", margin: 16 }}><EditorAiAssistant /></div>
    </EditorStoreProvider>,
);
