import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type AssetWorkflow = { id: string; name: string; assetIds: string[]; canvas?: CanvasProject };

function mediaIdentity(value: { data: Asset["data"] }) {
    return "storageKey" in value.data ? value.data.storageKey : undefined;
}

export function buildAssetWorkflows(assets: Asset[], projects: CanvasProject[]): AssetWorkflow[] {
    const groups = new Map<string, AssetWorkflow>(projects.map((canvas) => [canvas.id, { id: canvas.id, name: canvas.title, assetIds: [], canvas }]));
    const byAsset = new Map<string, Set<string>>();
    const byMedia = new Map<string, Set<string>>();
    const bind = (index: Map<string, Set<string>>, key: string | undefined, id: string) => {
        if (!key) return;
        const values = index.get(key) || new Set<string>();
        values.add(id);
        index.set(key, values);
    };
    for (const project of projects) {
        for (const node of project.nodes) {
            bind(byAsset, node.metadata?.assetId, project.id);
            bind(byMedia, node.metadata?.storageKey, project.id);
        }
    }
    for (const asset of assets) {
        const metadata = asset.metadata || {};
        const ids = new Set([...byAsset.get(asset.id) || [], ...byMedia.get(mediaIdentity(asset) || "") || []]);
        for (const id of [metadata.canvasId, metadata.workflowId, ...(Array.isArray(metadata.canvasIds) ? metadata.canvasIds : [])]) {
            if (typeof id === "string" && id) ids.add(id);
        }
        for (const id of ids) {
            let group = groups.get(id);
            if (!group) {
                const name = metadata.workflowName || metadata.canvasName || metadata.projectName;
                group = { id, name: typeof name === "string" && name.trim() ? name : "已归档工作流", assetIds: [] };
                groups.set(id, group);
            }
            if (!group.assetIds.includes(asset.id)) group.assetIds.push(asset.id);
        }
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
}

export function collectWorkflowAssets(workflow: AssetWorkflow, assets: Asset[]): Asset[] {
    const ids = new Set(workflow.assetIds);
    const collected: Asset[] = assets.filter((asset) => ids.has(asset.id)).map((asset) => ({ ...asset, metadata: { ...asset.metadata, workflowId: workflow.id, workflowName: workflow.name } }));
    for (const node of workflow.canvas?.nodes || []) {
        const input = canvasNodeToAsset(node, { canvasId: workflow.id, source: "canvas-manual" });
        if (!input) continue;
        const existing = collected.findIndex((asset) => asset.id === node.metadata?.assetId || (asset.metadata?.nodeId === node.id && asset.metadata?.canvasId === workflow.id) || (mediaIdentity(asset) && mediaIdentity(asset) === node.metadata?.storageKey));
        if (existing >= 0) {
            if (input.kind === "text") collected[existing] = { ...collected[existing], ...input, metadata: { ...collected[existing].metadata, ...input.metadata, workflowId: workflow.id, workflowName: workflow.name } } as Asset;
            continue;
        }
        collected.push({ ...input, id: `canvas-${workflow.id}-${node.id}`, createdAt: workflow.canvas!.createdAt, updatedAt: workflow.canvas!.updatedAt, metadata: { ...input.metadata, workflowId: workflow.id, workflowName: workflow.name } } as Asset);
    }
    return collected;
}

export function assetWorkflowLabel(asset: Asset, workflows: AssetWorkflow[]) {
    const names = workflows.filter((workflow) => workflow.assetIds.includes(asset.id)).map((workflow) => workflow.name);
    return names.length ? [...new Set(names)].join("、") : "公共资产";
}
