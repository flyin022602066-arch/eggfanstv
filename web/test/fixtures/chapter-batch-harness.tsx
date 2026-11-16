import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import ProjectChaptersView from "@/pages/projects/detail/chapters";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { getProject, type ProjectDetail } from "@/services/api/projects";

const dark = new URLSearchParams(location.search).get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
setActiveUserScope("batch-browser-offline");
useUserStore.setState({ hydrated: true, storageMode: "local", user: null });
const channel = createModelChannel({ id: "batch-offline", name: "离线文本模型", baseUrl: "https://example.invalid", apiKey: "offline-test-key", interfaceType: "chat-completion", models: ["offline-text", "offline-director"], modelProfiles: [{ model: "offline-text", capability: "text" }, { model: "offline-director", capability: "text" }] });
const model = encodeChannelModel(channel.id, "offline-text");
useConfigStore.setState({ config: { ...defaultConfig, ...useConfigStore.getState().config, channels: [channel], model, textModel: model } });
const units = [1, 2, 3].map((number) => ({ id: "u" + number, projectId: "batch-p", title: "第" + number + "集", sourceText: "林夏走进旧屋，拿出旧信。", position: number - 1, wordCount: 15, status: "ready", createdAt: "", updatedAt: "" }));
const initial = { project: { id: "batch-p", name: "区间离线测试", stylePresetId: "urban-live-action", status: "active", revision: 1 }, units, assets: [], assetCandidates: [], shots: [], shotRevisions: [], shotReferences: [], shotArtifacts: [], workflows: [], canvases: [], canvasUnitLinks: [], assetFolders: [], tasks: [] } as unknown as ProjectDetail;
function Harness() {
    const [detail, setDetail] = useState(initial);
    return <><output aria-label="当前页面">{useLocation().pathname}</output><div style={{ height: "calc(100vh - 24px)" }}><ProjectChaptersView detail={detail} refreshProject={() => { void getProject("batch-p").then(setDetail); }} /></div></>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter initialEntries={["/projects/batch-p/chapters/u1"]}><Routes><Route path="/projects/:projectId/chapters/:chapterId" element={<Harness />} /><Route path="*" element={<h1>错误的强制跳转</h1>} /></Routes></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
