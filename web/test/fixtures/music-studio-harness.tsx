import { App, ConfigProvider } from "antd";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { SUNO_OPERATIONS, sunoDefaultValues } from "@/lib/suno-contract";
import MusicPage from "@/pages/music";
import { createModelChannel, defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { flushSunoStudioPersistence, useSunoStudioStore } from "@/stores/use-suno-studio-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasAudioSettingsPopover } from "@/components/canvas/canvas-audio-settings-popover";
import { backendProviderConfig } from "@/services/api/generation-task";
import "@/styles/globals.css";

useUserStore.setState({ storageMode: "local" });
useConfigStore.setState({ config: { ...defaultConfig, channels: [
    createModelChannel({ id: "suno-fixture", name: "Eggfans 离线测试", baseUrl: "https://api.eggfans.com/v1", apiKey: "synthetic-suno-fixture", apiFormat: "openai", models: [] }),
    createModelChannel({ id: "jiasu-video", name: "佳速隔离", interfaceType: "jiasu-video", apiKey: "synthetic-jiasu-fixture", models: [] }),
] } });
document.documentElement.classList.add("dark");

function Harness() {
    const [dark, setDark] = useState(true);
    const [canvas, setCanvas] = useState(sessionStorage.getItem("suno-canvas-view") === "true");
    const [nodeConfig, setNodeConfig] = useState(() => ({ ...useConfigStore.getState().config, model: "suno-fixture::suno_music_open", audioSunoParams: sessionStorage.getItem("suno-canvas-params") || "" }));
    Object.assign(window, { sunoHarness: {
        state: () => useSunoStudioStore.getState(),
        flush: flushSunoStudioPersistence,
        operation: (id: string, values: Record<string, unknown> = {}) => useSunoStudioStore.getState().setDraft({ operationId: id, values: { ...sunoDefaultValues(id), ...values } }),
        operations: SUNO_OPERATIONS.map((operation) => ({ id: operation.id, group: operation.group, path: operation.path })),
        theme: (value: boolean) => { document.documentElement.classList.toggle("dark", value); setDark(value); },
        canvas: () => { sessionStorage.setItem("suno-canvas-view", "true"); setCanvas(true); },
        nodeConfig: () => nodeConfig,
        canvasPayload: () => backendProviderConfig(nodeConfig, "audio", "[Verse] 这是离线测试歌词"),
    } });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App style={{ height: "100dvh", display: "flex" }}><MemoryRouter>{canvas ? <div style={{ padding: 100 }}><CanvasAudioSettingsPopover config={nodeConfig} placement="bottomLeft" onConfigChange={(key, value) => { setNodeConfig((current) => ({ ...current, [key]: value })); if (key === "audioSunoParams") sessionStorage.setItem("suno-canvas-params", value); }} /></div> : <MusicPage />}</MemoryRouter></App></ConfigProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
