import { App } from "antd";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { backendProviderConfig } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const models = ["dola-sd-2.5", "dola-sd-2.0", "minimax-h3", "sd-2.5-J3-doubao"];
const config = normalizeConfigSnapshot({ config: {
    ...defaultConfig,
    videoJiasuFaceMode: useConfigStore.getState().config.videoJiasuFaceMode,
    channels: [
        createModelChannel({ id: "jiasu-video", name: "佳速视频", baseUrl: "https://ai.jiasuapi.com", apiKey: "synthetic-key", interfaceType: "jiasu-video", models, modelProfiles: models.map((model) => ({ model, capability: "video", protocol: "jiasu-video", capabilityConfig: defaultModelCapabilityConfig("jiasu-video", model) })) }),
        createModelChannel({ id: "sd2", name: "Eggfans SD2", apiKey: "synthetic-other-key", interfaceType: "eggfans-sd2-video", models: ["sd-2.5-D"], modelProfiles: [{ model: "sd-2.5-D", capability: "video", protocol: "eggfans-sd2-video" }] }),
    ],
    model: "jiasu-video::dola-sd-2.5",
    videoModel: "jiasu-video::dola-sd-2.5",
    videoSeconds: "5",
    vquality: "720p",
    size: "16:9",
} }).config;
useConfigStore.setState({ config });
useUserStore.setState({ storageMode: "local" });
useCanvasThemeStore.setState({ active: true });

function Harness() {
    const [node, setNode] = useState<CanvasNodeData>(() => JSON.parse(localStorage.getItem("test-jiasu-node") || "null") || { id: "video", title: "佳速视频节点", type: CanvasNodeType.Video, width: 420, height: 240, position: { x: 0, y: 0 }, metadata: { model: "jiasu-video::dola-sd-2.5", prompt: "离线测试" } });
    Object.assign(window, { jiasuHarness: { node: () => node, config: () => useConfigStore.getState().config, request: () => backendProviderConfig(buildGenerationConfig(useConfigStore.getState().config, node, "video"), "video") } });
    return <App><div style={{ padding: 40, width: 620 }}>
        <button onClick={() => useCanvasThemeStore.getState().setTheme("light")}>浅色</button>
        <button onClick={() => useCanvasThemeStore.getState().setTheme("dark")}>深色</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "jiasu-video::minimax-h3" } }))}>H3 模型</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "jiasu-video::sd-2.5-J3-doubao" } }))}>J3 模型</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "sd2::sd-2.5-D" } }))}>SD2 渠道</button>
        <CanvasNodePromptPanel projectId="fixture" node={node} isRunning={false} onPromptChange={() => {}} onGenerate={() => { throw new Error("Real generation must not run"); }} onConfigChange={(_id, patch) => setNode((current) => {
            const next = { ...current, metadata: { ...current.metadata, ...patch } };
            localStorage.setItem("test-jiasu-node", JSON.stringify(next));
            return next;
        })} />
    </div></App>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
