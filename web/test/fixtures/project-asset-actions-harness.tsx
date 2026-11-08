import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { configureApiRuntime } from "@/services/api/request";
import type { ProjectDetail } from "@/services/api/projects";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import ProjectAssetsView from "@/pages/projects/detail/assets";

setActiveUserScope("project-asset-actions-offline");
const libraryScenario = new URLSearchParams(location.search).get("scenario") === "library-bind";
useUserStore.setState({ hydrated: true, storageMode: libraryScenario ? "remote" : "local", user: libraryScenario ? { id: "offline-user" } as never : null });
useAssetStore.setState({ hydrated: false, assets: [] });
configureApiRuntime("/api", "offline-asset-actions-token");
const dark = new URLSearchParams(location.search).get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
const detail = { project: { id: "actions-project", name: "离线资产操作", status: "active", revision: 1 }, units: [], canvases: [], canvasUnitLinks: [], assets: [], assetFolders: [], workflows: [], shots: [], shotRevisions: [], shotArtifacts: [], shotReferences: [], assetCandidates: [], tasks: [] } as unknown as ProjectDetail;

function Harness() {
    const client = useQueryClient();
    return <main className="mx-auto max-w-5xl p-4"><ProjectAssetsView detail={detail} refreshProject={() => { void client.invalidateQueries({ queryKey: ["project", detail.project.id] }); }} onCreateCanvas={() => {}} /></main>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><Harness /></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
