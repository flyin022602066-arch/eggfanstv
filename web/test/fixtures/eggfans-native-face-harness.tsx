import { App } from "antd";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { backendProviderConfig } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const config = normalizeConfigSnapshot({ config: {
    ...defaultConfig,
    videoNativeFace: useConfigStore.getState().config.videoNativeFace,
    channels: [
        createModelChannel({ id: "sd2", interfaceType: "eggfans-sd2-video", apiKey: "synthetic-test-key", models: ["sd-2.5-C", "sd-2.5-D"], modelProfiles: ["sd-2.5-C", "sd-2.5-D"].map((model) => ({ model, capability: "video", protocol: "eggfans-sd2-video" })) }),
        createModelChannel({ id: "other", interfaceType: "xai-video", apiKey: "synthetic-test-key", models: ["grok-imagine-video"], modelProfiles: [{ model: "grok-imagine-video", capability: "video", protocol: "xai-video" }] }),
    ],
    model: "sd2::sd-2.5-C",
    videoModel: "sd2::sd-2.5-C",
    videoGenerateAudio: "false",
    videoWatermark: "false",
    vquality: "720p",
    size: "16:9",
} }).config;
useConfigStore.setState({ config });
useUserStore.setState({ storageMode: "local" });
useCanvasThemeStore.setState({ active: true });

function Harness() {
    const [node, setNode] = useState<CanvasNodeData>(() => JSON.parse(localStorage.getItem("test-video-node") || "null") || { id: "video", title: "SD2 视频节点", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 420, height: 240, metadata: { model: "sd2::sd-2.5-C", prompt: "测试提示词" } });
    Object.assign(window, { nativeFaceHarness: { node: () => node, config: () => useConfigStore.getState().config, request: () => backendProviderConfig(buildGenerationConfig(useConfigStore.getState().config, node, "video"), "video") } });
    return <App><div style={{ padding: 40, width: 620 }}>
        <button onClick={() => useCanvasThemeStore.getState().setTheme("light")}>浅色</button>
        <button onClick={() => useCanvasThemeStore.getState().setTheme("dark")}>深色</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "sd2::sd-2.5-D" } }))}>D 模型</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "sd2::sd-2.5-C" } }))}>C 模型</button>
        <button onClick={() => { setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "other::grok-imagine-video" } })); }}>其他渠道</button>
        <CanvasNodePromptPanel projectId="fixture" node={node} isRunning={false} onPromptChange={() => {}} onGenerate={() => { throw new Error("Real generation must not run"); }} onConfigChange={(_id, patch) => setNode((current) => {
            const next = { ...current, metadata: { ...current.metadata, ...patch } };
            localStorage.setItem("test-video-node", JSON.stringify(next));
            return next;
        })} />
    </div></App>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
