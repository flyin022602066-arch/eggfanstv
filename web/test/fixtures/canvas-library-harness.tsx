import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import AssetsPage from "@/pages/assets";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { CanvasProjectAssetModal } from "@/components/canvas/canvas-project-asset-modal";
import { CanvasAssetTray } from "@/components/canvas/canvas-asset-tray";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { CanvasAssetLibraryContext, usePersonalAssetLibrary } from "@/hooks/use-personal-asset-library";
import { setActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { getAntThemeConfig } from "@/lib/app-theme";

setActiveUserScope("canvas-library-test");
useUserStore.setState({ hydrated: true, storageMode: "remote", user: { id: "canvas-library-test", username: "fixture", displayName: "Fixture", role: "user", status: "active" } });
await useAssetStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
useAssetStore.setState({ hydrated: true, assets: [] });
const timestamp = "2026-10-31T00:00:00.000Z";
const canvas = (id: string, workspaceProjectId: string) => ({ id, workspaceProjectId, title: id, createdAt: timestamp, updatedAt: timestamp, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots" as const, showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [] });
useCanvasStore.setState({ projects: [canvas("canvas-a", "project-a"), canvas("canvas-a2", "project-a"), canvas("canvas-b", "project-b")] });
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
function CanvasSurfaces() {
    const assets = usePersonalAssetLibrary();
    const [value, setValue] = useState("");
    return <><CanvasAssetTray libraryAssets={assets.filter((asset): asset is Extract<typeof asset, { kind: "text" | "image" | "video" | "audio" }> => ["text", "image", "video", "audio"].includes(asset.kind))} canvasImages={[]} onInsertAsset={() => {}} onFocusCanvasImage={() => {}} /><CanvasResourceMentionTextarea aria-label="Scoped mentions" value={value} references={[]} onChange={setValue} includeAssetLibrary /></>;
}
function Harness() {
    const [picker, setPicker] = useState(false);
    const [projectPicker, setProjectPicker] = useState(false);
    const [canvasId, setCanvasId] = useState("canvas-a");
    const dark = new URLSearchParams(location.search).get("theme") !== "light";
    document.documentElement.classList.toggle("dark", dark);
    return <QueryClientProvider client={client}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter initialEntries={["/canvas/canvas-a"]}><button onClick={() => setPicker(true)}>Open picker</button><button onClick={() => setProjectPicker(true)}>Open project assets</button><button onClick={() => setCanvasId("canvas-b")}>Switch project</button><AssetsPage /><CanvasAssetLibraryContext.Provider value={canvasId}><CanvasSurfaces /><AssetPickerModal open={picker} onClose={() => setPicker(false)} onInsert={() => setPicker(false)} /><CanvasProjectAssetModal open={projectPicker} onClose={() => setProjectPicker(false)} onInsert={() => setProjectPicker(false)} /></CanvasAssetLibraryContext.Provider></MemoryRouter></App></ConfigProvider></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
