import { App } from "antd";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodeInfoModal, CanvasNodeToolbar } from "@/components/canvas/canvas-node-toolbar";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { applyCanvasLiveViewport, applyCanvasNodeGeometryPreview } from "@/lib/canvas/canvas-live-viewport";
import { useCanvasConnectionController } from "@/pages/canvas/use-canvas-connection-controller";
import { useCanvasSelectionController } from "@/pages/canvas/use-canvas-selection-controller";
import { useCanvasViewportTransition } from "@/pages/canvas/use-canvas-viewport-transition";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { uploadResourceToUguu } from "@/services/api/resources";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const noop = () => {};
const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#487a84"/></svg>');

function Harness() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>([
        { id: "source", type: CanvasNodeType.Image, title: "参考图片", position: { x: 100, y: 120 }, width: 240, height: 160, metadata: { content: image, storageKey: "resource:fixture-image" } },
        { id: "target", type: CanvasNodeType.Image, title: "目标图片", position: { x: 700, y: 320 }, width: 240, height: 160, metadata: { content: image } },
        ...Array.from({ length: 5000 }, (_, index) => ({ id: `far-${index}`, type: CanvasNodeType.Text, title: "远处节点", position: { x: 10000 + index * 300, y: 10000 }, width: 240, height: 160 })),
    ]);
    const [connections, setConnections] = useState<CanvasConnection[]>([{ id: "test-wire", fromNodeId: "source", toNodeId: "target" }]);
    const [selected, setSelected] = useState(new Set<string>());
    const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
    const [infoOpen, setInfoOpen] = useState(false);
    const [refreshWhileZooming, setRefreshWhileZooming] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const connectionsRef = useRef(connections);
    connectionsRef.current = connections;
    const selectedNodeIdsRef = useRef(selected);
    selectedNodeIdsRef.current = selected;
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const historyPausedRef = useRef(false);
    const transition = useCanvasViewportTransition(viewportRef, (next) => {
        containerRef.current!.dataset.canvasViewportInteracting = "true";
        applyCanvasLiveViewport(containerRef.current, next);
    }, (next) => {
        delete containerRef.current?.dataset.canvasViewportInteracting;
        setViewport(next);
    });
    const renderCount = useRef(0);
    renderCount.current++;
    const screenToCanvas = (x: number, y: number) => {
        const rect = containerRef.current!.getBoundingClientRect();
        return { x: (x - rect.left - viewportRef.current.x) / viewportRef.current.k, y: (y - rect.top - viewportRef.current.y) / viewportRef.current.k };
    };
    const connectionController = useCanvasConnectionController({ containerRef, projectId: "fixture", config: useConfigStore.getState().config, defaultDrawingEngine: "excalidraw", nodesRef, connectionsRef, viewportRef, scriptScrollTopById: {}, screenToCanvas, setNodes, setConnections, setSelectedNodeIds: setSelected, setSelectedConnectionId: noop, setContextMenu: noop, setDialogNodeId: noop, setDrawingNodeId: noop });
    const selectionController = useCanvasSelectionController({ containerRef, nodesRef, viewportRef, selectedNodeIdsRef, historyPausedRef, screenToCanvas, setNodes, setSelectedNodeIds: setSelected, setSelectedConnectionId: noop, cancelPendingConnectionCreate: connectionController.cancelPendingConnectionCreate, onCanvasSelectionStart: noop, onNodeInteractionStart: noop, onNodeClick: noop, onDeselect: noop });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const uploadImageToUguu = async () => {
        await uploadResourceToUguu("fixture-image");
        setInfoOpen(true);
    };
    useLayoutEffect(() => {
        Object.assign(window, { canvasHarness: {
            renderCount: () => renderCount.current,
            nodes: () => nodesRef.current.slice(0, 2),
            connections: () => connectionsRef.current,
            setScene: (nextNodes: CanvasNodeData[], nextConnections: CanvasConnection[]) => {
                setNodes(nextNodes);
                setConnections(nextConnections);
            },
            transition: transition.transitionViewportTo,
            refreshWhileZooming: setRefreshWhileZooming,
            resize: (width: number, height: number) => {
                const source = nodesRef.current[0];
                applyCanvasNodeGeometryPreview(containerRef.current, { nodeId: source.id, width, height, position: source.position });
                const element = containerRef.current!.querySelector<HTMLElement>(`[data-node-id="${source.id}"]`)!;
                element.style.width = `${width}px`;
                element.style.height = `${height}px`;
            },
            finishResize: (width: number, height: number) => {
                setNodes((current) => current.map((node) => node.id === "source" ? { ...node, width, height } : node));
                applyCanvasNodeGeometryPreview(containerRef.current, null);
            },
        } });
    });
    return <>
        <div style={{ height: 40, display: "flex", gap: 12 }}>
            <button onClick={() => setInfoOpen(true)}>图片节点信息</button>
            {[0.5, 1, 1.5].map((scale) => <button key={scale} onClick={() => setViewport({ x: 0, y: 0, k: scale })}>{scale * 100}%</button>)}
        </div>
        <div style={{ height: "calc(100vh - 40px)" }}>
            <InfiniteCanvas containerRef={containerRef} viewport={viewport} onViewportChange={setViewport} onViewportPreviewChange={(next) => { viewportRef.current = next; if (refreshWhileZooming) setViewport(next); }} onCanvasMouseDown={selectionController.handleCanvasMouseDown} graphicsLayer={<CanvasLeaferGraphicsLayer containerRef={containerRef} viewport={viewport} theme={canvasThemes.dark} displayConnections={connections.map((connection) => ({ connection, from: nodeById.get(connection.fromNodeId)!, to: nodeById.get(connection.toNodeId)! }))} selectedConnectionId={null} relatedConnectionIds={new Set()} scriptScrollTopById={{}} connectingParams={connectionController.connectingParams} batchConnectionPreview={null} mouseWorld={connectionController.mouseWorld} connectionTargetNodeId={connectionController.connectionTargetNodeId} nodeById={nodeById} selectionBox={null} selectedNodeBounds={null} alignmentGuides={selectionController.alignmentGuides} />}>
                {nodes.slice(0, 2).map((node) => <CanvasNode key={node.id} data={node} scale={viewport.k} isSelected={selected.has(node.id)} isRelated={false} isFocusRelated={false} isConnectionTarget={connectionController.connectionTargetNodeId === node.id} connectionApproach={connectionController.connectionApproach?.point} dragOffset={selectionController.dragPreview?.nodeIds.has(node.id) ? selectionController.dragPreview : undefined} onMouseDown={selectionController.handleNodeMouseDown} onHoverStart={noop} onHoverEnd={noop} onConnectStart={connectionController.handleConnectStart} onResize={noop} onTitleChange={noop} onContentChange={noop} onContextMenu={noop} />)}
            </InfiniteCanvas>
        </div>
        <CanvasNodeToolbar
            node={nodes[0]}
            viewport={viewport}
            containerRef={containerRef}
            onKeep={noop}
            onLeave={noop}
            onInfo={() => setInfoOpen(true)}
            onEditText={noop}
            onDecreaseFont={noop}
            onIncreaseFont={noop}
            onToggleDialog={noop}
            onAnnotate={noop}
            onGenerateImage={noop}
            onUpload={noop}
            onUploadToUguu={uploadImageToUguu}
            onDownload={noop}
            onSaveAsset={noop}
            onMaskEdit={noop}
            onEmotion={noop}
            onPortraitTexture={noop}
            onCrop={noop}
            onSplit={noop}
            onUpscale={noop}
            onSuperResolve={noop}
            onAngle={noop}
            onLighting={noop}
            onPanorama={noop}
            onViewImage={noop}
            onExtractVideoFrames={noop}
            onExtractAudioFromVideo={noop}
            onTrimVideoSegments={noop}
            onDepthCapture={noop}
            onSubtitles={noop}
            onTimeline={noop}
            extractingVideoFrames={false}
            extractingAudio={false}
            trimmingVideo={false}
            onReversePrompt={noop}
            onRetry={noop}
            onToggleFreeResize={noop}
            onToggleLocked={noop}
            onDelete={noop}
        />
        <CanvasNodeInfoModal node={nodes[0]} open={infoOpen} onClose={() => setInfoOpen(false)} />
    </>;
}

export function mountCanvasInteractionHarness(host: HTMLElement) {
    useUserStore.setState({ storageMode: "local" });
    const root = createRoot(host);
    root.render(<App><Harness /></App>);
    return () => root.unmount();
}
