import { describe, expect, test } from "bun:test";
import { filterCanvasProjectAssets } from "@/lib/canvas/canvas-asset-library";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";
const timestamp = "2026-10-31T00:00:00.000Z";
const asset = (id: string, metadata: Record<string, unknown> = {}): Asset => ({ id, title: id, kind: "text", coverUrl: "", tags: [], data: { content: id }, metadata, createdAt: timestamp, updatedAt: timestamp });
const canvas = (id: string, workspaceProjectId?: string, projectId?: string): CanvasProject => ({ id, workspaceProjectId, projectId, title: "Same title", createdAt: timestamp, updatedAt: timestamp, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: true, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [] });
describe("canvas project asset scope", () => {
    test("includes sibling canvases and shared bindings but excludes other projects and unassigned assets", () => {
        const projects = [canvas("a", "group-a"), canvas("a2", "group-a"), canvas("b", "group-b")];
        projects[1].nodes = [{ id: "bound", type: CanvasNodeType.Text, title: "Bound", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { assetId: "shared" } }];
        const rows = [asset("a", { canvasId: "a" }), asset("sibling", { canvasIds: ["a2"] }), asset("b", { canvasId: "b" }), asset("shared", { canvasId: "b" }), asset("public"), { ...asset("archived", { canvasId: "a" }), status: "archived" as const }];
        expect(filterCanvasProjectAssets(rows, projects, "a").map((item) => item.id)).toEqual(["a", "sibling", "shared"]);
    });
    test("uses stable domain project IDs instead of duplicate titles", () => {
        const rows = [asset("domain", { projectIds: ["domain-a"] }), asset("foreign", { projectIds: ["domain-b"], projectName: "Same title" })];
        expect(filterCanvasProjectAssets(rows, [canvas("a", undefined, "domain-a")], "a").map((item) => item.id)).toEqual(["domain"]);
    });
    test("keeps legacy canvases isolated and fails closed before the canvas loads", () => {
        const rows = [asset("legacy-a", { workflowId: "a" }), asset("legacy-b", { canvasId: "b" }), asset("public")];
        expect(filterCanvasProjectAssets(rows, [canvas("a"), canvas("b")], "a").map((item) => item.id)).toEqual(["legacy-a"]);
        expect(filterCanvasProjectAssets(rows, [], "missing")).toEqual([]);
    });
    test("recognizes historical media by the current project's resource binding", () => {
        const project = canvas("a");
        project.nodes = [{ id: "image", type: CanvasNodeType.Image, title: "Image", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey: "resource:owned" } }];
        const image: Asset = { ...asset("media"), kind: "image", data: { dataUrl: "", storageKey: "resource:owned", width: 300, height: 200, bytes: 1, mimeType: "image/png" } };
        expect(filterCanvasProjectAssets([image], [project], "a")).toEqual([image]);
    });
});
