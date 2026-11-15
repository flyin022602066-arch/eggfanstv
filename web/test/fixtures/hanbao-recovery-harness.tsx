import { useEffect, useRef, useState } from "react";
import { CanvasProjectStatusDialogs } from "@/pages/canvas/canvas-project-status-dialogs";
import { useCanvasGeneration } from "@/pages/canvas/use-canvas-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import { CanvasNodeContent } from "@/components/canvas/canvas-node-content";

export function HanbaoRecoveryHarness() {
    const params = new URLSearchParams(location.search);
    const scenario = params.get("scenario") || "missing";
    const reason = "憨包text2video：画布连续 1 次生成失败（生成失败，请重试）：这条先跳过，可稍后重试或换个账号";
    const initial: GenerationTask = {
        id: "hanbao-recovery-fixture", projectId: "canvas-fixture", type: "canvas_video", model: "hanbao::seedance_v2.5",
        status: "failed", stage: scenario === "confirmed" ? "生成失败" : "submission_unknown", prompt: "离线测试",
        providerRequestId: ["pending", "failed"].includes(scenario) ? "hanbao:original-opaque-receipt" : undefined,
        error: scenario === "confirmed" ? reason : "提交结果尚未确认", attempts: 1,
        errorCode: scenario === "confirmed" ? "async_failed" : "submission_uncertain",
        createdAt: "2026-11-08T19:21:32+08:00", updatedAt: "2026-11-08T19:22:32+08:00",
        failureDiagnostics: { source: scenario === "confirmed" ? "upstream_response" : "local_runtime", summary: scenario === "confirmed" ? reason : "组件未返回完整回执", executionResult: scenario === "confirmed" ? "failed" : "pending" },
    };
    const activeStage = params.get("stage");
    if (activeStage) {
        initial.status = "running";
        initial.stage = activeStage;
        initial.error = "";
        initial.errorCode = "";
        initial.progress = 0;
        initial.providerRequestId = "hanbao:original-opaque-receipt";
    }
    const [nodes, setNodes] = useState<CanvasNodeData[]>([{ id: "video-fixture", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { taskId: initial.id, taskStage: initial.stage, status: "error" } }]);
    const nodesRef = useRef(nodes);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    nodesRef.current = nodes;
    const generation = useCanvasGeneration({ projectId: initial.projectId!, projectLoaded: false, nodes, nodesRef, setNodes });
    useEffect(() => { generation.setTaskDetail(initial); }, []);
    return <>
        <output aria-label="画布任务状态">{JSON.stringify(nodes[0].metadata)}</output>
        {activeStage ? <div aria-label="视频节点状态" style={{ height: 400, width: "100%" }}>
            <CanvasNodeContent node={{ ...nodes[0], metadata: { ...nodes[0].metadata, model: initial.model, taskId: initial.id, taskStatus: initial.status, taskStage: initial.stage, taskProgress: 0, status: "loading" } }}
                theme={params.get("theme") === "dark" ? canvasThemes.dark : canvasThemes.light}
                isEditingContent={false} textareaRef={textareaRef} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false}
                onContentChange={() => {}} onStopEditing={() => {}} mentionReferences={[]} />
        </div> : null}
        <CanvasProjectStatusDialogs
            theme={params.get("theme") === "dark" ? canvasThemes.dark : canvasThemes.light}
            task={generation.taskDetail} taskLogs={generation.taskDetailLogs} taskLoading={generation.taskDetailLoading}
            onCloseTask={() => generation.setTaskDetail(null)} onRetrieveTask={(task) => void generation.retrieveTaskResult(task)} retrievingTaskId={generation.retrievingTaskId}
            superResolveNode={null} onCloseSuperResolve={() => {}} onUseLocalUpscale={() => {}}
            previewNode={null} onClosePreview={() => {}} clearConfirmOpen={false} onCancelClear={() => {}} onConfirmClear={() => {}}
        />
    </>;
}
