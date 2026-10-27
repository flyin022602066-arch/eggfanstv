import { App } from "antd";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { ChannelModelSettings } from "@/pages/settings/channel-model-settings";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";

const model = "doubao-seedance-2-0-260128";
function Harness() {
    const [channel, setChannel] = useState(() => createModelChannel(JSON.parse(localStorage.getItem("mints-test-channel") || "null") || { id: "mints-seedance", name: "Mints", baseUrl: "https://mints.example", apiKey: "synthetic-key", interfaceType: "mints-seedance-video", models: [model], modelProfiles: [{ model, protocol: "mints-seedance-video", capability: "video" }] }));
    const [dark, setDark] = useState(false);
    const config = { ...defaultConfig, channels: [channel], model: `mints-seedance::${model}`, videoModel: `mints-seedance::${model}`, videoSeconds: "18", size: "9:16", vquality: "720p" };
    Object.assign(window, { mintsHarness: { channel: () => channel, request: () => prepareBackendGenerationTask({ config, mode: "video", prompt: "@图片1 行走", referenceImages: [{ id: "image", name: "图片1", type: "image/png", storageKey: "resource:original", arkAssetId: "another-channel-asset" }] }) } });
    return <App><main className="mx-auto max-w-4xl space-y-6 p-6" data-theme={dark ? "dark" : "light"}>
        <button onClick={() => setDark((value) => !value)}>切换主题</button>
        <VideoSettingsPanel config={config} theme={dark ? canvasThemes.dark : canvasThemes.light} onConfigChange={() => {}} />
        <ChannelModelSettings channel={channel} onChange={(modelProfiles) => {
            const next = { ...channel, modelProfiles };
            setChannel(next);
            localStorage.setItem("mints-test-channel", JSON.stringify(next));
        }} />
    </main></App>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
