import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { getAntThemeConfig } from "@/lib/app-theme";
import { setActiveUserScope } from "@/lib/user-scope";
import AssetsPage from "@/pages/assets";
import UserLayout from "@/layouts/user-layout";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { createAssetPackage, readAssetPackage } from "@/pages/assets/asset-transfer";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { readImageMeta } from "@/lib/image-utils";
import { CanvasNodeType } from "@/types/canvas";
import "@/styles/globals.css";

setActiveUserScope("asset-workflows-offline-fixture");
useUserStore.setState({ storageMode: "local", user: null });
await useAssetStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
const fixtureNode = { id: "fixture-text-node", type: CanvasNodeType.Text, title: "分镜剧本", position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { content: "未手动保存的最新剧本\n第二场" } };
const fixtureProject: CanvasProject = { id: "workflow-fixture-a", title: "离线工作流甲", nodes: [fixtureNode], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
useCanvasStore.setState({ projects: [fixtureProject, { ...fixtureProject, id: "workflow-fixture-b", title: "离线工作流乙", nodes: [] }] });
if (!sessionStorage.getItem("asset-workflows-seeded")) {
    useAssetStore.setState({ assets: [] });
    for (let index = 0; index < 45; index += 1) {
        useAssetStore.getState().addAsset({ kind: "text", title: `甲剧本${index + 1}`, coverUrl: "", tags: [], metadata: { canvasId: fixtureProject.id }, data: { content: `甲项目内容${index + 1}` } });
    }
    useAssetStore.getState().addAsset({ kind: "text", title: "乙剧本", coverUrl: "", tags: [], metadata: { canvasId: "workflow-fixture-b" }, data: { content: "乙项目内容" } });
    useAssetStore.getState().addAsset({ kind: "text", title: "公共台词", coverUrl: "", tags: [], data: { content: "独立台词" } });
    await flushAssetStorePersistence();
    sessionStorage.setItem("asset-workflows-seeded", "true");
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function verifyOriginalMediaTransfer() {
    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 2160;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#325fa8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const original = await new Promise<Blob>((done) => canvas.toBlob((blob) => done(blob!), "image/png"));
    const imageUrl = await setImageBlob("image:asset-workflows-fixture-original", original);
    const imageId = useAssetStore.getState().addAsset({ kind: "image", title: "4K原图往返测试", coverUrl: imageUrl, tags: [], data: { dataUrl: imageUrl, storageKey: "image:asset-workflows-fixture-original", width: 4096, height: 2160, bytes: original.size, mimeType: original.type } });
    const audioBlob = new Blob(["offline original audio fixture"], { type: "audio/mpeg" });
    const audioUrl = await setMediaBlob("file:asset-workflows-fixture-original", audioBlob);
    const audioId = useAssetStore.getState().addAsset({ kind: "audio", title: "原音频往返测试", coverUrl: "", tags: [], data: { url: audioUrl, storageKey: "file:asset-workflows-fixture-original", bytes: audioBlob.size, mimeType: audioBlob.type } });
    const assets = useAssetStore.getState().assets.filter((asset) => asset.id === imageId || asset.id === audioId);
    const zip = await createAssetPackage(assets, { workflow: { id: "original-media-fixture", name: "原始媒体测试" } });
    const imported = await readAssetPackage(new File([zip], "原始媒体.zip"));
    const image = imported.find((asset) => asset.kind === "image")!;
    const audio = imported.find((asset) => asset.kind === "audio")!;
    if (image.kind !== "image" || audio.kind !== "audio") throw new Error("Wrong media kind");
    const restoredImage = await getImageBlob(image.data.storageKey!);
    const restoredAudio = await getMediaBlob(audio.data.storageKey!);
    if (!restoredImage || !restoredAudio) throw new Error("Missing original media");
    const source = new Uint8Array(await original.arrayBuffer());
    const restored = new Uint8Array(await restoredImage.arrayBuffer());
    const unchanged = source.length === restored.length && source.every((value, index) => value === restored[index]);
    const dimensions = await readImageMeta(image.data.dataUrl);
    const storedImageId = useAssetStore.getState().addAsset(image);
    const storedAudioId = useAssetStore.getState().addAsset(audio);
    await flushAssetStorePersistence();
    return { unchanged, width: dimensions.width, height: dimensions.height, audioUnchanged: await restoredAudio.text() === await audioBlob.text(), imageId: storedImageId, audioId: storedAudioId, storageKey: image.data.storageKey };
}

function Harness() {
    const [dark, setDark] = useState(true);
    Object.assign(window, { assetHarness: {
        state: () => useAssetStore.getState().assets,
        flush: flushAssetStorePersistence,
        theme: (value: boolean) => { document.documentElement.classList.toggle("dark", value); setDark(value); },
        rename: () => useCanvasStore.setState({ projects: [{ ...fixtureProject, title: "改名后的工作流甲" }] }),
        saveText: (content: string) => ensureCanvasNodeAsset({ canvasId: fixtureProject.id, node: { ...fixtureNode, metadata: { content } }, source: "canvas-manual" }),
        verifyOriginalMediaTransfer,
        imageDimensions: async (id: string) => { const asset = useAssetStore.getState().assets.find((item) => item.id === id); if (asset?.kind !== "image") throw new Error("Missing image"); return readImageMeta(asset.data.dataUrl); },
    } });
    return <QueryClientProvider client={queryClient}><ConfigProvider theme={getAntThemeConfig(dark)}><App><MemoryRouter initialEntries={["/assets"]}><UserLayout><AssetsPage /></UserLayout></MemoryRouter></App></ConfigProvider></QueryClientProvider>;
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<Harness />);
