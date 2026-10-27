import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { buildNodeConfig } from "@/components/canvas/canvas-node-prompt-panel";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "@/stores/use-config-store";
import { backendProviderConfig } from "@/services/api/generation-task";
import { buildImageGenerationMetadata } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";

const model = "gemini-nano-banana-2.1";
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, model: `egg::${model}`, imageModel: `egg::${model}`, channels: [createModelChannel({ id: "egg", baseUrl: "https://api.eggfans.com", apiKey: "synthetic-test-key", models: [model], modelProfiles: [{ model, capability: "text", protocol: "chat-completion" }] })] } }).config;
function Harness() {
    const theme = useThemeStore((state) => state.theme);
    useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle("dark", theme === "dark");
    }, [theme]);
    const [metadata, setMetadata] = useState<CanvasNodeMetadata>(() => JSON.parse(localStorage.getItem("nano-banana-test-node") || "{}"));
    const node = { id: "image", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 340, height: 240, metadata };
    const nodeConfig = buildNodeConfig(config, node, "image", {});
    Object.assign(window, { nanoBananaHarness: { request: () => backendProviderConfig(nodeConfig), result: () => buildImageGenerationMetadata("generation", nodeConfig, 1, []) } });
    return <App><main className="p-8"><h1>图片节点参数验证</h1><button onClick={() => useThemeStore.getState().setTheme(theme === "dark" ? "light" : "dark")}>切换主题</button><CanvasImageSettingsPopover config={nodeConfig} placement="bottomLeft" onConfigChange={(key, value) => {
        setMetadata((previous) => {
            const next = { ...previous, [key]: value };
            localStorage.setItem("nano-banana-test-node", JSON.stringify(next));
            return next;
        });
    }} /></main></App>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
