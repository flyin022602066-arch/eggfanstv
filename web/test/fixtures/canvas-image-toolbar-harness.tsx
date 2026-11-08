import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { CanvasNodeToolbar } from "@/components/canvas/canvas-node-toolbar";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { defaultConfig } from "@/stores/use-config-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const dark = new URLSearchParams(location.search).get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
useCanvasThemeStore.setState({ theme: dark ? "dark" : "light" });
const nodes: CanvasNodeData[] = ["image-a", "image-b"].map((id, index) => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 60 + index * 420, y: 180 }, width: 360, height: 220, metadata: { content: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220"><rect width="360" height="220" fill="teal"/></svg>'), nodeRole: "result", prompt: "测试图片" } }));
function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState(-1);
    useEffect(() => setSelected(0), []);
    const [assistant, setAssistant] = useState(true);
    const [settingsMounted, setSettingsMounted] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [action, setAction] = useState("");
    const [config, setConfig] = useState({ ...defaultConfig, model: "gpt-image-1", imageModel: "gpt-image-1" });
    const callbacks = Object.fromEntries(["onKeep", "onLeave", "onInfo", "onEditText", "onDecreaseFont", "onIncreaseFont", "onToggleDialog", "onAnnotate", "onGenerateImage", "onUpload", "onUploadToUguu", "onDownload", "onSaveAsset", "onMaskEdit", "onEmotion", "onPortraitTexture", "onCrop", "onSplit", "onUpscale", "onSuperResolve", "onAngle", "onLighting", "onPanorama", "onViewImage", "onExtractVideoFrames", "onExtractAudioFromVideo", "onTrimVideoSegments", "onDepthCapture", "onSubtitles", "onTimeline", "onReversePrompt", "onRetry", "onToggleFreeResize", "onToggleLocked", "onDelete"].map(name => [name, (node?: CanvasNodeData) => { if (node?.id) setAction(name + ":" + node.id); }]));
    return <main className="min-h-screen bg-background text-foreground">
        <button onClick={() => setAssistant(value => !value)}>切换 Agent</button>
        <button onClick={() => setSettingsMounted(value => !value)}>切换设置挂载</button>
        <button onClick={() => setSelected(value => 1 - value)}>切换图片</button>
        <output aria-label="设置状态">{settingsOpen ? "open" : "closed"}</output>
        <output aria-label="最近操作">{action}</output>
        <div ref={containerRef} style={{ position: "relative", height: 700, width: "100%" }}>
            {nodes.map((node, index) => <button key={node.id} data-node-id={node.id} aria-label={node.id} onClick={() => setSelected(index)} style={{ position: "absolute", left: node.position.x, top: node.position.y, width: node.width, height: node.height, border: selected === index ? "2px solid teal" : "none" }}><img src={node.metadata!.content} alt={node.title} /></button>)}
            {assistant ? <aside className="canvas-agent-panel" style={{ position: "absolute", right: 0, top: 0, width: 300, height: 600 }}>Agent</aside> : null}
            <CanvasNodeToolbar {...callbacks as ComponentProps<typeof CanvasNodeToolbar>} node={settingsOpen ? null : nodes[selected]} viewport={{ x: 0, y: 0, k: 1 }} containerRef={containerRef} extractingVideoFrames={false} extractingAudio={false} trimmingVideo={false} />
            <div style={{ position: "absolute", top: 450, left: 80 }}>
                {settingsMounted ? <CanvasImageSettingsPopover key={selected} config={config} onConfigChange={(key, value) => setConfig(current => ({ ...current, [key]: value }))} onOpenChange={setSettingsOpen} /> : null}
            </div>
        </div>
    </main>;
}
createRoot(document.getElementById("root")!).render(<ConfigProvider theme={getAntThemeConfig(dark)}><App><Harness /></App></ConfigProvider>);
