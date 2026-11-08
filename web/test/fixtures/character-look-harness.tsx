import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";
import { WorkflowCharacterReferences } from "@/pages/projects/detail/workflow-character-references";
import WorkflowProductionWorkbench from "@/pages/projects/detail/workflow-production-workbench";
import { getProjectUnitWorkspace, type ProjectDetail } from "@/services/api/projects";
import { buildShotAssetReferenceContext } from "@/pages/projects/detail/workflow-shot-references";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import ProjectAssetsView from "@/pages/projects/detail/assets";
import { useAssetStore } from "@/stores/use-asset-store";

setActiveUserScope("character-looks-offline-browser");
const assetWorkspace = new URLSearchParams(location.search).has("assets");
useUserStore.setState({ hydrated: true, storageMode: assetWorkspace ? "remote" : "local", user: assetWorkspace ? { id: "fixture" } as never : null });
if (assetWorkspace) useAssetStore.setState({ hydrated: true, assets: [] });
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.classList.toggle("dark", dark);
const detail = { project: { id: "p", name: "造型离线测试", aspectRatio: "16:9", status: "active" }, shots: [], shotReferences: [] } as unknown as ProjectDetail;
const timestamp = "2026-11-02T00:00:00Z";
const character = { versionId: "v0", version: 1, definition: { clothing: "白衣日常" }, visualStatus: "ready", voiceStatus: "missing", representations: [{ id: "rep0", resourceId: "img0", mediaType: "image", role: "primary" }] };
const asset = { id: "hero", title: "苏卉", category: "character", mediaType: "entity", primaryVersionId: "v0", character, versionCount: 2, position: 0, usages: [], status: "confirmed" };
const integratedDetail = {
    ...detail, project: { ...detail.project, revision: 1 }, units: [{ id: "u", title: "桃园初会", position: 0, sourceText: "苏卉穿白衣" }], assets: [asset],
    shots: [{ id: "s", projectId: "p", unitId: "u", title: "镜头1", currentRevisionId: "sr", position: 0, description: "苏卉穿白衣", durationMs: 30000, status: "active", createdAt: timestamp, updatedAt: timestamp }],
    shotRevisions: [{ id: "sr", shotId: "s", version: 1, videoPrompt: "苏卉穿白衣走到窗前。", plotDescription: "苏卉穿白衣", actionBeatsJson: "[]" }],
    shotReferences: [{ id: "r", shotId: "s", assetVersionId: "v0", role: "reference", status: "linked", asset, referencedVersion: { id: "v0", assetId: "hero", version: 1, representations: character.representations } }],
    shotArtifacts: [], tasks: [], workflows: [], assetFolders: [], assetCandidates: [], canvases: [], canvasUnitLinks: [],
} as unknown as ProjectDetail;

function IntegratedHarness() {
    const [current, setCurrent] = useState(integratedDetail);
    const refresh = async () => {
        const workspace = await getProjectUnitWorkspace("p", "u");
        setCurrent((previous) => ({ ...previous, ...workspace }));
    };
    useEffect(() => { void refresh(); }, []);
    return <><output aria-label="当前提交角色参考">{JSON.stringify(buildShotAssetReferenceContext(current, "s").characterReferenceSnapshot)}</output><WorkflowProductionWorkbench activeStage="video" detail={current} projectId="p" unitId="u" selectedShot={current.shots[0]} onSelectShot={() => {}} onRefresh={refresh} onAddShot={() => {}} addingShot={false} /></>;
}

function Harness() {
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    if (new URLSearchParams(location.search).has("integrated")) return <IntegratedHarness />;
    if (new URLSearchParams(location.search).has("assets")) return <main className="p-4"><ProjectAssetsView detail={integratedDetail} refreshProject={() => {}} onCreateCanvas={() => {}} /></main>;
    return <main className="mx-auto max-w-5xl p-4"><h1>角色造型参考测试</h1><button onClick={() => setDirty(!dirty)}>切换脚本未保存</button><p aria-label="操作状态">{busy ? "正在更新" : "空闲"}</p><div className="ml-auto w-full max-w-80"><WorkflowCharacterReferences detail={detail} projectId="p" unitId="u" shotId="s" dirty={dirty} disabled={false} onRefresh={async () => {}} onBusyChange={setBusy} /></div></main>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter><Harness /></MemoryRouter></App></ConfigProvider></QueryClientProvider>);
