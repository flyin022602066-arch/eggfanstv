import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { WorkspaceBootstrapHydrator } from "@/components/workspace/workspace-bootstrap-hydrator";
import { getAntThemeConfig } from "@/lib/app-theme";
import { configureApiRuntime } from "@/services/api/request";
import { useConfigStore } from "@/stores/use-config-store";
import { ChannelSettingsPane } from "@/pages/settings/channel-settings-pane";
import ProjectChaptersView from "@/pages/projects/detail/chapters";
import type { ProjectDetail } from "@/services/api/projects";
import "@/styles/globals.css";

configureApiRuntime(window.location.origin + "/api", "offline-model-catalog-test");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const detail = {
    project: { id: "catalog-test", name: "模型目录离线测试", status: "active" },
    units: [{ id: "chapter", title: "第一章", sourceText: "青年走进庭院，停下脚步。", sourceFormat: "text", position: 0, updatedAt: "2026-10-20T00:00:00Z" }],
    assets: [], canvases: [], workflows: [], shots: [], shotRevisions: [], shotReferences: [], shotArtifacts: [], tasks: [], assetCandidates: [],
} as unknown as ProjectDetail;

function Harness() {
    const [view, setView] = useState("settings");
    const [dark, setDark] = useState(true);
    const config = useConfigStore((state) => state.config);
    return <QueryClientProvider client={queryClient}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><WorkspaceBootstrapHydrator>
        <nav className="flex gap-4 p-4"><button onClick={() => setView("settings")}>模型设置测试</button><button onClick={() => setView("chapters")}>拆解文本测试</button><button onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark); }}>切换主题</button><output data-testid="catalog-count">{config.channels.find((channel) => channel.id === "beefapi")?.models.length || 0}</output></nav>
        {view === "settings" ? <ChannelSettingsPane /> : <ProjectChaptersView detail={detail} refreshProject={async () => undefined} onCreateCanvas={() => undefined} />}
    </WorkspaceBootstrapHydrator></MemoryRouter></App></ConfigProvider></QueryClientProvider>;
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<Harness />);
