import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import ProjectDetailPage from "@/pages/projects/detail";
import { appQueryClient } from "@/lib/query-client";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";

setActiveUserScope("project-read-offline-regression");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
Object.assign(window, {
    refreshProjectReads: () => appQueryClient.invalidateQueries({ queryKey: ["project", "read-project"] }),
});

createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={appQueryClient}>
        <ConfigProvider><App><MemoryRouter initialEntries={["/projects/read-project/workflow/chapter-a/video"]}>
            <Routes>
                <Route path="/projects/:projectId/workflow/:unitId/:stage" element={<ProjectDetailPage />} />
                <Route path="/projects" element={<div>项目中心测试页</div>} />
            </Routes>
        </MemoryRouter></App></ConfigProvider>
    </QueryClientProvider>,
);
