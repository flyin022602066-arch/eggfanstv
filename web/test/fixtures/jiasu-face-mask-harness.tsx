import { App, ConfigProvider, theme as antdTheme } from "antd";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig, buildVideoGenerationMetadata } from "@/lib/canvas/canvas-project-generation";
import { renderJiasuFaceMask } from "@/lib/jiasu-face-mask";
import { inspectJiasuFaceMask } from "@/services/jiasu-face-mask";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "@/styles/globals.css";

const models = ["dola-sd-2.5", "dola-sd-2.0", "minimax-h3", "sd-2.5-j2-V"];
const initialModel = new URLSearchParams(location.search).has("jiasu-j2") ? "jiasu::sd-2.5-j2-V" : "jiasu::dola-sd-2.5";
const config = normalizeConfigSnapshot({ config: {
    ...defaultConfig,
    videoJiasuFaceMask: useConfigStore.getState().config.videoJiasuFaceMask,
    videoSd2FaceMask: useConfigStore.getState().config.videoSd2FaceMask,
    videoNativeFace: "true",
    channels: [createModelChannel({ id: "jiasu", interfaceType: "jiasu-video", apiKey: "synthetic-jiasu-key", models, modelProfiles: models.map((model) => ({ model, capability: "video", protocol: "jiasu-video" })) }), createModelChannel({ id: "sd2", interfaceType: "eggfans-sd2-video", apiKey: "synthetic-sd2-key", models: ["sd-2.5-C", "sd-2.5-D"], modelProfiles: ["sd-2.5-C", "sd-2.5-D"].map((model) => ({ model, capability: "video", protocol: "eggfans-sd2-video" })) })],
    model: initialModel, videoModel: initialModel, videoSeconds: "5", size: "16:9", vquality: "720p",
} }).config;
useConfigStore.setState({ config });
useUserStore.setState({ storageMode: "local" });
useCanvasThemeStore.setState({ active: true });

const references = [{ id: "portrait", name: "图片1", type: "image/png", dataUrl: "", storageKey: "resource:source-portrait" }, { id: "sheet", name: "图片2", type: "image/png", dataUrl: "", storageKey: "resource:source-sheet" }];
const assetReferences = new URLSearchParams(location.search).has("assets");

function Harness() {
    const [node, setNode] = useState<CanvasNodeData>(() => JSON.parse(localStorage.getItem("mask-node") || "null") || { id: "video", title: "佳速 SD 视频节点", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 420, height: 240, metadata: { model: initialModel, prompt: "@图片1 @图片2 演绎角色" } });
    const [status, setStatus] = useState("");
    const [dark, setDark] = useState(false);
    useEffect(() => { useCanvasThemeStore.getState().setTheme(dark ? "dark" : "light"); document.documentElement.classList.toggle("dark", dark); }, [dark]);
    const theme = dark ? canvasThemes.dark : canvasThemes.light;
    const submit = async () => {
        setStatus("正在处理参考图…");
        try {
            const generationConfig = buildGenerationConfig(useConfigStore.getState().config, node, "video");
            const task = await submitBackendGenerationTask({ mode: "video", prompt: "@图片1 @图片2 演绎角色", config: generationConfig, referenceImages: references, metadata: buildVideoGenerationMetadata(node, undefined, generationConfig) });
            setStatus(`已提交 ${task.id}`);
        } catch (cause) {
            setStatus(cause instanceof Error ? cause.message : "提交失败");
        }
    };
    const submitWithMode = (mode: string, signal?: AbortSignal) => {
        const built = buildGenerationConfig(useConfigStore.getState().config, node, "video");
        const generationConfig = { ...built, ...(built.model === "sd2::sd-2.5-D" ? { videoSd2FaceMask: mode } : { videoJiasuFaceMask: mode }) };
        return submitBackendGenerationTask({ mode: "video", prompt: "@图片1 @图片2 演绎角色", config: generationConfig, referenceImages: references, metadata: buildVideoGenerationMetadata(node, undefined, generationConfig), signal });
    };
    Object.assign(window, { faceMaskHarness: { node: () => node, config: () => useConfigStore.getState().config, references, inspect: inspectJiasuFaceMask, render: renderJiasuFaceMask, submitWithMode, submit } });
    return <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorText: theme.node.text, colorBgElevated: theme.node.panel } }}><App><main style={{ padding: 32, minHeight: "100vh", background: theme.canvas.background, color: theme.node.text }}>
        <button onClick={() => setDark(!dark)}>切换明暗</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "jiasu::minimax-h3" } }))}>H3 模型</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "sd2::sd-2.5-C" } }))}>SD2 渠道</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "sd2::sd-2.5-D" } }))}>SD2 D 模型</button>
        <button onClick={() => setNode((current) => ({ ...current, metadata: { ...current.metadata, model: "jiasu::dola-sd-2.5" } }))}>佳速 SD</button>
        <div style={{ width: 620, maxWidth: "100%", marginTop: 24 }}><CanvasNodePromptPanel projectId="fixture" node={node} isRunning={false} onPromptChange={() => {}} onGenerate={() => { void submit(); }} mentionReferences={references.map((reference, index) => ({ id: assetReferences ? `asset:${reference.id}` : reference.id, nodeId: assetReferences ? "" : reference.id, assetId: assetReferences ? reference.id : undefined, kind: "image", label: `图片${index + 1}`, title: reference.name, active: true, previewUrl: `/samples/${reference.id}.png`, storageKey: reference.storageKey }))} onConfigChange={(_id, patch) => setNode((current) => { const next = { ...current, metadata: { ...current.metadata, ...patch } }; localStorage.setItem("mask-node", JSON.stringify(next)); return next; })} /></div>
        <p role="status">{status}</p>
    </main></App></ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
