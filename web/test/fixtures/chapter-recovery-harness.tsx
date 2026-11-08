import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import ProjectChaptersView from "@/pages/projects/detail/chapters";
import type { ProjectDetail } from "@/services/api/projects";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { getAntThemeConfig } from "@/lib/app-theme";

setActiveUserScope("chapter-recovery-offline");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
const detail = {
    project: { id: "p", name: "离线分镜回填", revision: 10, status: "active" },
    units: [{ id: "u", title: "第21章", sourceText: "苏卉走向窗前。", position: 0, wordCount: 8 }],
    shots: [], shotRevisions: [], shotReferences: [], shotArtifacts: [], assetCandidates: [], assets: [],
    workflows: [], assetFolders: [], canvases: [], canvasUnitLinks: [],
} as unknown as ProjectDetail;
function AssetsDestination() {
    return <h1>资产写入后已跳转{useLocation().search}</h1>;
}
createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConfigProvider theme={getAntThemeConfig(true)}><App>
            <MemoryRouter initialEntries={["/projects/p/chapters/u"]}><Routes>
                <Route path="/projects/:projectId/chapters/:chapterId" element={<div style={{ height: "100vh" }}><ProjectChaptersView detail={detail} refreshProject={() => {}} /></div>} />
                <Route path="/projects/:projectId/workflow/:unitId/video" element={<h1>分镜写入后已跳转</h1>} />
                <Route path="/projects/:projectId/assets" element={<AssetsDestination />} />
            </Routes></MemoryRouter>
        </App></ConfigProvider>
    </QueryClientProvider>,
);
