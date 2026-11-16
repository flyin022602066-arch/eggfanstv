import { assertUserScope, isUserScopeAbandonedError, type CapturedUserScope } from "@/lib/user-scope-guard";
import { CanvasStaleScopeError } from "@/services/canvas-revision-conflict";
import { persistCanvasDocument } from "@/services/local-workspace-repository";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasGenerationTargetSaveError } from "./canvas-generation-errors";
import { bindCanvasNodeResourceAsset, canvasNodesMissingResourceAssetBinding } from "@/lib/canvas/canvas-node-asset";
import { explainGenerationError } from "@/lib/generation-error";
import { notifyCanvasRefresh } from "@/services/local-workspace-sync";

export async function persistCanvasGenerationTarget(input: {
    projectId: string;
    nodeId: string;
    signal?: AbortSignal;
    expectedScope: CapturedUserScope;
}, persist: typeof persistCanvasDocument = persistCanvasDocument, ensureBindings: typeof import("./project-asset-sync").ensureCanvasResourceAssetBindings = async options => (await import("./project-asset-sync")).ensureCanvasResourceAssetBindings(options)) {
    const assertCurrent = () => {
        if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        assertUserScope(input.expectedScope);
    };
    assertCurrent();
    const project = useCanvasStore.getState().openProject(input.projectId);
    if (!project?.nodes.some((node) => node.id === input.nodeId)) throw new CanvasGenerationTargetSaveError(undefined, "生成节点已不存在，未开始生成");
    try {
        const bound = canvasNodesMissingResourceAssetBinding(project.nodes).length
            ? await ensureBindings({ canvasId: input.projectId, domainProjectId: project.projectId, nodes: project.nodes, signal: input.signal, expectedScope: input.expectedScope })
            : project.nodes;
        assertCurrent();
        const latest = useCanvasStore.getState().openProject(input.projectId);
        if (!latest?.nodes.some(node => node.id === input.nodeId)) throw new CanvasGenerationTargetSaveError(undefined, "生成节点已不存在，未开始生成");
        const nodes = latest.nodes.map(node => bindCanvasNodeResourceAsset(node, bound, []));
        if (nodes.some((node, index) => node !== latest.nodes[index])) {
            useCanvasStore.getState().updateProject(input.projectId, { nodes });
            const updated = useCanvasStore.getState().openProject(input.projectId);
            if (updated) notifyCanvasRefresh(updated, latest);
        }
        await persist(input.projectId, { nodes, connections: latest.connections }, input.expectedScope);
    } catch (error) {
        if (isUserScopeAbandonedError(error) || error instanceof CanvasStaleScopeError || (error instanceof Error && error.name === "AbortError")) throw error;
        if (error instanceof CanvasGenerationTargetSaveError) throw error;
        throw new CanvasGenerationTargetSaveError(error, `画布尚未保存，未开始生成。${explainGenerationError(error).summary || explainGenerationError(error).reason}`);
    }
    assertCurrent();
    const current = useCanvasStore.getState().openProject(input.projectId);
    if (!current?.nodes.some((node) => node.id === input.nodeId)) {
        // 保存期间的删除也必须提交；旧快照的回执不能让节点在下次打开时重现。
        if (current) await persist(input.projectId, { nodes: current.nodes, connections: current.connections }, input.expectedScope);
        throw new CanvasGenerationTargetSaveError(undefined, "生成节点已不存在，未开始生成");
    }
}
