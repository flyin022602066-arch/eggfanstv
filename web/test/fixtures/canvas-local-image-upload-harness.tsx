import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodeActionContext } from "@/components/canvas/canvas-node-action-context";
import { CanvasNodeToolbar } from "@/components/canvas/canvas-node-toolbar";
import { useCanvasUpload } from "@/pages/canvas/use-canvas-upload";
import { configureApiRuntime } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode } from "@/types/canvas";
import "@/styles/globals.css";

const noop = () => {};
configureApiRuntime(`${location.origin}/api`, "synthetic-test-token");
useUserStore.setState({ storageMode: "local" });
const videoMode = new URLSearchParams(location.search).get("media") === "video";
const initialNode: CanvasNodeData = { id: "upload-target", type: videoMode ? CanvasNodeType.Video : CanvasNodeType.Image, title: videoMode ? "我的参考视频" : "我的参考图片", position: { x: 100, y: 200 }, width: 320, height: 240 };
const connections = [{ id: "existing-wire", fromNodeId: "upload-target", toNodeId: "video-target" }];
const toolbarHandlers = Object.fromEntries([
    "onKeep", "onLeave", "onInfo", "onEditText", "onDecreaseFont", "onIncreaseFont", "onToggleDialog", "onAnnotate", "onGenerateImage", "onUploadToUguu", "onDownload", "onSaveAsset", "onMaskEdit", "onEmotion", "onPortraitTexture", "onCrop", "onSplit", "onUpscale", "onSuperResolve", "onAngle", "onLighting", "onPanorama", "onViewImage", "onExtractVideoFrames", "onExtractAudioFromVideo", "onTrimVideoSegments", "onDepthCapture", "onSubtitles", "onTimeline", "onReversePrompt", "onRetry", "onToggleFreeResize", "onToggleLocked", "onDelete",
].map((name) => [name, noop])) as Pick<ComponentProps<typeof CanvasNodeToolbar>,
    "onKeep" | "onLeave" | "onInfo" | "onEditText" | "onDecreaseFont" | "onIncreaseFont" | "onToggleDialog" | "onAnnotate" | "onGenerateImage" | "onUploadToUguu" | "onDownload" | "onSaveAsset" | "onMaskEdit" | "onEmotion" | "onPortraitTexture" | "onCrop" | "onSplit" | "onUpscale" | "onSuperResolve" | "onAngle" | "onLighting" | "onPanorama" | "onViewImage" | "onExtractVideoFrames" | "onExtractAudioFromVideo" | "onTrimVideoSegments" | "onDepthCapture" | "onSubtitles" | "onTimeline" | "onReversePrompt" | "onRetry" | "onToggleFreeResize" | "onToggleLocked" | "onDelete">;

function Harness() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>(() => JSON.parse(localStorage.getItem("upload-test-nodes") || "null") || [initialNode]);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const selectedNodeIdsRef = useRef(new Set<string>());
    const containerRef = useRef<HTMLDivElement>(null);
    const [readOnly, setReadOnly] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<CanvasWorkspaceMode>("professional");
    const [dragCount, setDragCount] = useState(0);
    const upload = useCanvasUpload({ canvasId: "synthetic-upload-canvas", nodesRef, selectedNodeIdsRef, getCanvasCenter: () => ({ x: 400, y: 300 }), screenToCanvas: (x, y) => ({ x, y }), setNodes, setSelectedNodeIds: noop, setSelectedConnectionId: noop, setContextMenu: noop, setDialogNodeId: noop });
    const requestUpload = (node: CanvasNodeData) => upload.handleUploadRequest(node.id);
    useEffect(() => {
        localStorage.setItem("upload-test-nodes", JSON.stringify(nodes));
        Object.assign(window, { localImageHarness: {
            nodes: () => nodesRef.current,
            connections: () => connections,
            dragCount: () => dragCount,
            mode: setWorkspaceMode,
            readOnly: setReadOnly,
            locked: (locked: boolean) => setNodes((current) => current.map((node) => ({ ...node, metadata: { ...node.metadata, locked } }))),
            loading: (loading: boolean) => setNodes((current) => current.map((node) => ({ ...node, metadata: { ...node.metadata, status: loading ? "loading" : "success" } }))),
            theme: useCanvasThemeStore.getState().setTheme,
        } });
    }, [nodes, dragCount]);
    return <CanvasNodeActionContext.Provider value={{ upload: requestUpload }}>
        <div ref={containerRef} style={{ position: "relative", width: "100vw", height: "100vh" }}>
            <CanvasNode data={nodes[0]} scale={1} isSelected isRelated={false} isFocusRelated={false} isConnectionTarget={false} showImageInfo={false} readOnly={readOnly} onMouseDown={() => setDragCount((count) => count + 1)} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onContextMenu={noop} />
        </div>
        <CanvasNodeToolbar {...toolbarHandlers} node={nodes[0]} viewport={{ x: 0, y: 0, k: 1 }} containerRef={containerRef} readOnly={readOnly} workspaceMode={workspaceMode} onUpload={requestUpload} extractingVideoFrames={false} extractingAudio={false} trimmingVideo={false} />
        <input hidden type="file" ref={upload.imageInputRef} onChange={upload.handleImageInputChange} />
    </CanvasNodeActionContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><App><Harness /></App></QueryClientProvider>);
