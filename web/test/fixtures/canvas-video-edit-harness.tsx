import { App } from "antd";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { canOpenCanvasNodePromptPanel } from "@/lib/canvas/canvas-node-semantics";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { useCanvasGenerationExecutor } from "@/pages/canvas/use-canvas-generation-executor";
import { useCanvasSelectionController } from "@/pages/canvas/use-canvas-selection-controller";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const noop = () => {};
const initialNode: CanvasNodeData = {
    id: "generated-video", type: CanvasNodeType.Video, title: "已生成视频编辑测试", position: { x: 70, y: 70 }, width: 480, height: 270,
    metadata: { nodeRole: "result", resultOrigin: "generated", status: "success", taskId: "previous-task", taskStatus: "succeeded", content: "/fixture.mp4", mimeType: "video/mp4", prompt: "original generation prompt", composerContent: "\n", model: "jiasu-video::dola-sd-2.5", seconds: "30", size: "16:9", vquality: "720p" },
};

function Harness() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>(() => JSON.parse(localStorage.getItem("video-edit-fixture") || "null") || [initialNode]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [selected, setSelected] = useState(new Set<string>());
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
    const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
    const containerRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selected);
    const viewportRef = useRef(viewport);
    const historyPausedRef = useRef(false);
    nodesRef.current = nodes;
    connectionsRef.current = connections;
    selectedNodeIdsRef.current = selected;
    viewportRef.current = viewport;
    const generation = useCanvasGenerationExecutor({
        projectId: "fixture", addedSkills: [], assets: [], nodesRef, connectionsRef, setNodes, setConnections,
        setSelectedNodeIds: setSelected, setSelectedConnectionId: noop, setDialogNodeId, setRunningNodeId,
        startGenerationRequest: (_target, _origin, _running, controller) => controller || new AbortController(),
        finishGenerationRequest: noop,
        bindGenerationTask: (nodeId, task) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, taskId: task.id, taskStatus: task.status } } : node)),
        applyGenerationTaskResult: async (nodeId, task) => {
            const result = JSON.parse(task.resultJson || "{}");
            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: "success", content: result.video.url, taskId: task.id, taskStatus: task.status } } : node));
        },
    });
    const selection = useCanvasSelectionController({
        containerRef, nodesRef, viewportRef, selectedNodeIdsRef, historyPausedRef,
        screenToCanvas: (clientX, clientY) => { const bounds = containerRef.current!.getBoundingClientRect(); return { x: (clientX - bounds.left - viewportRef.current.x) / viewportRef.current.k, y: (clientY - bounds.top - viewportRef.current.y) / viewportRef.current.k }; },
        setNodes, setSelectedNodeIds: setSelected, setSelectedConnectionId: noop, cancelPendingConnectionCreate: noop,
        onCanvasSelectionStart: () => setDialogNodeId(null), onNodeInteractionStart: noop, onDeselect: () => setDialogNodeId(null),
        onNodeClick: (node) => setDialogNodeId(canOpenCanvasNodePromptPanel(node) ? node.id : null),
    });
    const candidate = nodes.find((node) => node.id === dialogNodeId);
    const dialogNode = canOpenCanvasNodePromptPanel(candidate) ? candidate : undefined;
    useLayoutEffect(() => {
        localStorage.setItem("video-edit-fixture", JSON.stringify(nodes));
        Object.assign(window, { videoEditHarness: { nodes: () => nodesRef.current, connections: () => connectionsRef.current, setTheme: useCanvasThemeStore.getState().setTheme } });
    });
    return <div style={{ height: "100vh" }}>
        <InfiniteCanvas containerRef={containerRef} viewport={viewport} onViewportChange={setViewport} onCanvasMouseDown={selection.handleCanvasMouseDown}>
            {nodes.map((node) => <CanvasNode key={node.id} data={node} scale={viewport.k} isSelected={selected.has(node.id)} mediaActive={activeMediaId === node.id} isRelated={false} isFocusRelated={false} isConnectionTarget={false} showImageInfo={false} onMouseDown={selection.handleNodeMouseDown} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResize={noop} onContentChange={noop} onContextMenu={noop} onMediaPlayRequest={setActiveMediaId} />)}
        </InfiniteCanvas>
        {dialogNode && !selection.isNodeDragging ? <div style={{ position: "absolute", left: 660, top: 65, width: 480 }}>
            <CanvasNodePromptPanel projectId="fixture" node={dialogNode} isRunning={runningNodeId === dialogNode.id}
                onPromptChange={(nodeId, prompt) => setNodes((current) => current.map((node) => node.id === nodeId ? writeCanvasNodePrompt(node, prompt) : node))}
                onConfigChange={(nodeId, patch) => setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))}
                onGenerate={generation} onClose={() => setDialogNodeId(null)} />
        </div> : null}
    </div>;
}

export function mountVideoEditHarness(host: HTMLElement) {
    const model = "dola-sd-2.5";
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [createModelChannel({ id: "jiasu-video", name: "佳速视频", baseUrl: "https://fixture.invalid", apiKey: "synthetic-key", interfaceType: "jiasu-video", models: [model], modelProfiles: [{ model, capability: "video", protocol: "jiasu-video", capabilityConfig: defaultModelCapabilityConfig("jiasu-video", model) }] })], model: "jiasu-video::dola-sd-2.5", videoModel: "jiasu-video::dola-sd-2.5", videoSeconds: "30", size: "16:9", vquality: "720p" } }).config;
    useConfigStore.setState({ config });
    useUserStore.setState({ storageMode: "local" });
    useCanvasThemeStore.setState({ active: true });
    createRoot(host).render(<App><Harness /></App>);
}
