import { App } from "antd";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeContent } from "@/components/canvas/canvas-node-content";
import { canvasThemes } from "@/lib/canvas-theme";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { useCanvasGeneration } from "@/pages/canvas/use-canvas-generation";
import { useCanvasGenerationExecutor } from "@/pages/canvas/use-canvas-generation-executor";
import { taskWaitTimeoutMs, type GenerationTask } from "@/services/api/task-center";
import { createModelChannel, defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const task: GenerationTask = {
    id: "timeout-fixture", type: "canvas_video", status: "running", prompt: "离线测试",
    attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
useUserStore.setState({ storageMode: "local" });
useConfigStore.setState({ config: {
    ...defaultConfig,
    channels: [createModelChannel({ id: "fixture", name: "离线视频", apiKey: "synthetic-key", interfaceType: "jiasu-video", models: ["dola-sd-2.5"], modelProfiles: [{ model: "dola-sd-2.5", capability: "video", protocol: "jiasu-video" }] })],
    videoModel: "fixture::dola-sd-2.5",
} });

function Harness() {
    const initialNode: CanvasNodeData = { id: "video", title: "超时恢复测试", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 420, height: 240, metadata: { model: "fixture::dola-sd-2.5", prompt: "离线测试" } };
    const [nodes, setNodes] = useState<CanvasNodeData[]>([initialNode]);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const connectionsRef = useRef<CanvasConnection[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [, setConnections] = useState<CanvasConnection[]>([]);
    const [, setSelectedNodeIds] = useState(new Set<string>());
    const [, setSelectedConnectionId] = useState<string | null>(null);
    const [, setDialogNodeId] = useState<string | null>(null);
    const generation = useCanvasGeneration({ projectId: "fixture", projectLoaded: true, nodes, nodesRef, setNodes });
    const execute = useCanvasGenerationExecutor({ projectId: "fixture", addedSkills: [], assets: [], nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId, ...generation });
    const [waitState, setWaitState] = useState("idle");
    const start = () => {
        setWaitState("waiting");
        void execute("video", "video", "离线测试", { skipDuplicateConfirmation: true }).finally(() => setWaitState("settled"));
    };
    const reset = () => { setNodes([initialNode]); setWaitState("idle"); };
    const restoreLegacy = () => setNodes([{ ...initialNode, metadata: { ...initialNode.metadata, status: "error", errorDetails: "生成失败。请查看详情后再决定是否重试。", taskId: task.id, taskStatus: "running" } }]);
    Object.assign(window, { timeoutHarness: { start, reset, restoreLegacy, node: () => nodes[0], waitState: () => waitState, timeoutMs: taskWaitTimeoutMs(task) } });
    return <div style={{ padding: 40, width: 620 }}>
        <div data-testid="video-card" style={{ width: 420, height: 240 }}><CanvasNodeContent node={nodes[0]} theme={canvasThemes.dark} isEditingContent={false} textareaRef={textareaRef} isBatchRoot={false} batchCount={1} batchExpanded={false} batchOpening={false} batchRecovering={false} mentionReferences={[]} onContentChange={() => {}} onStopEditing={() => {}} /></div>
        <CanvasNodePromptPanel projectId="fixture" node={nodes[0]} isRunning={isCanvasNodeGenerating(nodes[0], generation.runningNodeId)} onPromptChange={() => {}} onGenerate={start} />
    </div>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><App><Harness /></App></QueryClientProvider>);
