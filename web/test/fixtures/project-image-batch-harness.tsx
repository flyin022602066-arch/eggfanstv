import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectAssetImageBatchModal } from "@/pages/projects/detail/project-asset-image-batch-modal";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { Project } from "@/services/api/projects";

setActiveUserScope("image-batch-offline-test");
useUserStore.setState({ storageMode: "local", user: null });
configureApiRuntime("/api", "offline-test");
const channel = createModelChannel({ id: "offline", name: "离线图片测试", baseUrl: "https://example.invalid", apiKey: "offline-only", interfaceType: "openai-image", models: ["gpt-image-2"], modelProfiles: [{ model: "gpt-image-2", capability: "image" }] });
const model = encodeChannelModel(channel.id, "gpt-image-2");
useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model, imageModel: model } });
const project = { id: "batch-project", name: "离线批量生图", aspectRatio: "16:9", defaultImageModel: model } as Project;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness() {
    const [open, setOpen] = useState(false);
    const [dark, setDark] = useState(true);
    const [refreshes, setRefreshes] = useState(0);
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App>
        <button onClick={() => setOpen(true)}>打开角色批量生图</button>
        <button onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark); }}>切换主题</button>
        <output aria-label="批次完成回调">{refreshes}</output>
        {open ? <ProjectAssetImageBatchModal project={project} category="character" onClose={() => setOpen(false)} onSettings={() => undefined} onTasksChanged={async () => { setRefreshes((value) => value + 1); await client.invalidateQueries({ queryKey: ["project", project.id] }); }} /> : null}
    </App></ConfigProvider>;
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
