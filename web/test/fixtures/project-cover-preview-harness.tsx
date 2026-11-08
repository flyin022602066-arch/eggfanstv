import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import type { Project, ProjectDetail } from "@/services/api/projects";
import { useUserStore } from "@/stores/use-user-store";
import ProjectsPage from "@/pages/projects";
import ProjectSettingsView from "@/pages/projects/detail/settings";

setActiveUserScope("project-cover-offline-regression");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
configureApiRuntime("/api", "offline-cover-test");
const params = new URLSearchParams(window.location.search);
const dark = params.get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function SettingsHarness() {
    const [project, setProject] = useState<Project>({
        id: "cover-project", userId: "local", name: "封面回归项目", type: "short-drama",
        aspectRatio: "16:9", sourceType: "blank", description: "", stylePresetId: "",
        coverResourceId: "generated-cover", status: "active", revision: 1,
        createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    });
    const detail: ProjectDetail = { project, units: [], canvases: [], canvasUnitLinks: [], assets: [],
        assetFolders: [], workflows: [], shots: [], shotRevisions: [], shotArtifacts: [], shotReferences: [], assetCandidates: [], tasks: [] };
    return <><button onClick={() => setProject((current) => ({ ...current, coverResourceId: "replacement-cover" }))}>测试替换封面</button><button onClick={() => setProject((current) => ({ ...current, coverResourceId: "missing-cover" }))}>测试失效封面</button><ProjectSettingsView detail={detail} refreshProject={() => {}} onCreateCanvas={() => {}} /></>;
}

createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter initialEntries={["/projects"]}>
        {params.get("view") === "list" ? <ProjectsPage /> : <SettingsHarness />}
    </MemoryRouter></App></ConfigProvider></QueryClientProvider>,
);
