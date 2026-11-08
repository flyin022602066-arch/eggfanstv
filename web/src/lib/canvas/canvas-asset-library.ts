import { buildAssetWorkflows } from "@/lib/asset-workflows";
import { canvasWorkspaceProjectId } from "@/lib/canvas/canvas-workspace-project";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export function filterCanvasProjectAssets(assets: Asset[], canvases: CanvasProject[], canvasId: string): Asset[] {
    const current = canvases.find((canvas) => canvas.id === canvasId);
    if (!current) return [];
    const workspaceId = canvasWorkspaceProjectId(current);
    const siblings = canvases.filter((canvas) => canvasWorkspaceProjectId(canvas) === workspaceId || Boolean(current.projectId && canvas.projectId === current.projectId));
    const active = assets.filter((asset) => asset.status !== "archived");
    const boundIds = new Set(buildAssetWorkflows(active, siblings).filter((workflow) => siblings.some((canvas) => canvas.id === workflow.id)).flatMap((workflow) => workflow.assetIds));
    return active.filter((asset) => {
        if (boundIds.has(asset.id)) return true;
        const metadata = asset.metadata || {};
        if (metadata.workspaceProjectId === workspaceId) return true;
        return Boolean(current.projectId && (metadata.projectId === current.projectId || (Array.isArray(metadata.projectIds) && metadata.projectIds.includes(current.projectId))));
    });
}
