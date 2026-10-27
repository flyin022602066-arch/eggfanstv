import { describe, expect, test } from "bun:test";
import { buildAssetWorkflows, collectWorkflowAssets } from "@/lib/asset-workflows";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const timestamp = "2026-10-19T00:00:00.000Z";
const text = (id: string, metadata: Record<string, unknown> = {}): Asset => ({ id, kind: "text", title: id, coverUrl: "", tags: [], data: { content: "已保存正文" }, metadata, createdAt: timestamp, updatedAt: timestamp });
const node = (id: string, metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({ id, type: CanvasNodeType.Text, title: id, position: { x: 0, y: 0 }, width: 300, height: 180, metadata });
const canvas = (id: string, title: string, nodes: CanvasNodeData[]): CanvasProject => ({ id, title, nodes, connections: [], chatSessions: [], activeChatId: null, createdAt: timestamp, updatedAt: timestamp, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [] });

describe("workflow asset classification", () => {
    test("uses stable workflow IDs, current names and existing node bindings", () => {
        const assets = [text("old", { canvasId: "one", canvasName: "旧名称" }), text("shared"), text("public")];
        const groups = buildAssetWorkflows(assets, [canvas("one", "同名项目", [node("n1", { assetId: "shared" })]), canvas("two", "同名项目", [node("n2", { assetId: "shared" })])]);
        expect(groups.find((group) => group.id === "one")).toMatchObject({ name: "同名项目", assetIds: ["old", "shared"] });
        expect(groups.find((group) => group.id === "two")?.assetIds).toEqual(["shared"]);
        expect(groups.flatMap((group) => group.assetIds)).not.toContain("public");
    });

    test("classifies old generated assets by their resource binding", () => {
        const image: Asset = { ...text("image"), kind: "image", data: { dataUrl: "", storageKey: "resource:original", width: 4096, height: 2160, bytes: 123, mimeType: "image/png" } };
        const workflow = canvas("legacy", "历史项目", [{ ...node("media", { storageKey: "resource:original" }), type: CanvasNodeType.Image }]);
        expect(buildAssetWorkflows([image], [workflow])[0].assetIds).toEqual([image.id]);
    });

    test("keeps imported workflow collections without a canvas", () => {
        expect(buildAssetWorkflows([text("imported", { workflowId: "archive-1", workflowName: "外部项目" })], [])[0]).toEqual({ id: "archive-1", name: "外部项目", assetIds: ["imported"] });
    });

    test("exports current text and unsaved nodes without changing the library", () => {
        const saved = text("saved", { canvasId: "flow", nodeId: "original" });
        const unrelated = text("other", { canvasId: "other" });
        const project = canvas("flow", "小说工作流", [node("original", { content: "修改后的完整正文", assetId: saved.id }), node("unsaved", { content: "尚未手动保存的剧本" })]);
        const group = buildAssetWorkflows([saved, unrelated], [project]).find((item) => item.id === project.id)!;
        const result = collectWorkflowAssets(group, [saved, unrelated]);
        expect(result).toHaveLength(2);
        expect(result.every((asset) => asset.kind === "text")).toBe(true);
        expect(result.map((asset) => asset.kind === "text" && asset.data.content)).toEqual(["修改后的完整正文", "尚未手动保存的剧本"]);
        expect(saved.kind === "text" && saved.data.content).toBe("已保存正文");
        expect(result.some((asset) => asset.id === unrelated.id)).toBe(false);
    });
});
