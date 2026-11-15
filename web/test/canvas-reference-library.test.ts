import { describe, expect, test } from "bun:test";
import { BUILTIN_REFERENCE_TEMPLATES, renderBuiltinReferenceSvg } from "../src/lib/canvas/canvas-reference-builtins";
import { applyCanvasReferenceTemplate, prepareCanvasReferenceTarget } from "../src/lib/canvas/canvas-reference-templates";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

describe("ready-to-use image reference library", () => {
    test("ships original pose, costume and face diagrams without remote dependencies", () => {
        expect(BUILTIN_REFERENCE_TEMPLATES.length).toBeGreaterThanOrEqual(36);
        expect(new Set(BUILTIN_REFERENCE_TEMPLATES.map(row => row.id)).size).toBe(BUILTIN_REFERENCE_TEMPLATES.length);
        for (const role of ["pose", "costume", "character"] as const) {
            expect(BUILTIN_REFERENCE_TEMPLATES.filter(row => row.kind === role).length).toBeGreaterThanOrEqual(12);
        }
        for (const row of BUILTIN_REFERENCE_TEMPLATES) {
            const svg = renderBuiltinReferenceSvg(row.id);
            expect(svg).toContain("<svg");
            expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:|<script|foreignObject|<image/u);
            expect(row.items[0].instruction.length).toBeGreaterThan(20);
            expect(row.items[0].mediaId).toBe(row.id);
        }
        expect(() => renderBuiltinReferenceSvg("missing")).toThrow();
    });
    test("uploaded images become references for a separate editing node without modifying the source", () => {
        const source: CanvasNodeData = { id: "uploaded", title: "我的人物", type: CanvasNodeType.Image, position: { x: 10, y: 20 }, width: 300, height: 500, metadata: { nodeRole: "result", resultOrigin: "upload", content: "data:image/png;base64,original", storageKey: "resource:original", model: "existing-model", prompt: "旧生成词", taskId: "old-task" } };
        const before = structuredClone(source);
        const ids = ["editor", "source-edge"];
        const graph = prepareCanvasReferenceTarget([source], [], source.id, () => ids.shift()!);
        expect(source).toEqual(before);
        expect(graph.nodes[0]).toEqual(before);
        expect(graph.targetNodeId).toBe("editor");
        const editor = graph.nodes.find(row => row.id === graph.targetNodeId)!;
        expect(editor.metadata?.nodeRole).toBe("generator");
        expect(editor.metadata?.generationType).toBe("edit");
        expect(editor.metadata?.model).toBe("existing-model");
        expect(editor.metadata?.content).toBeUndefined();
        expect(editor.metadata?.taskId).toBeUndefined();
        expect(editor.metadata?.composerContent).toContain("@图片1");
        expect(graph.connections).toEqual([{ id: "source-edge", fromNodeId: source.id, toNodeId: editor.id }]);
    });
    test("an existing generator is reused and locked or missing nodes are rejected", () => {
        const source: CanvasNodeData = { id: "generator", title: "生图", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { nodeRole: "generator", model: "keep" } };
        expect(prepareCanvasReferenceTarget([source], [], source.id, () => "unexpected").targetNodeId).toBe(source.id);
        expect(() => prepareCanvasReferenceTarget([{ ...source, metadata: { locked: true } }], [], source.id, () => "unexpected")).toThrow("锁定");
        expect(() => prepareCanvasReferenceTarget([], [], source.id, () => "unexpected")).toThrow("不存在");
    });
    test("face diagrams cannot override the original character identity in the generated request", () => {
        const original: CanvasNodeData = { id: 'original', title: '角色原图', type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 400, metadata: { nodeRole: 'result', resultOrigin: 'upload', content: 'data:image/png;base64,original' } };
        let sequence = 0;
        const createId = () => 'reference-' + (++sequence);
        const prepared = prepareCanvasReferenceTarget([original], [], original.id, createId);
        const template = BUILTIN_REFERENCE_TEMPLATES.find(row => row.kind === 'character')!;
        const graph = applyCanvasReferenceTemplate({ ...prepared, template, createId, images: [{ mediaId: template.items[0].mediaId, storageKey: 'resource:diagram', url: 'data:image/png;base64,diagram', width: 768, height: 1024, mimeType: 'image/png', bytes: 10 }] });
        const target = graph.nodes.find(row => row.id === prepared.targetNodeId)!;
        const input = buildNodeGenerationContext(target.id, graph.nodes, graph.connections, target.metadata!.composerContent!, []);
        expect(input.referenceImages.map(image => image.id)).toEqual(['original', graph.nodes.find(row => row.metadata?.referenceTemplateMediaId)!.id]);
        expect(input.prompt).toContain('优先保持原图');
        expect(input.prompt).not.toContain('参考角色身份、面部特征及外貌');
        expect(input.prompt).toContain('@图片2');
    });
    test("new editors and reference cards do not cover existing image nodes", () => {
        const source: CanvasNodeData = { id: 'source', type: CanvasNodeType.Image, title: '原图', position: { x: 0, y: 0 }, width: 320, height: 400, metadata: { nodeRole: 'result', resultOrigin: 'upload', content: 'data:image/png;base64,original' } };
        const neighbor: CanvasNodeData = { ...source, id: 'neighbor', position: { x: 416, y: 0 } };
        let sequence = 0;
        const createId = () => 'placed-' + (++sequence);
        const prepared = prepareCanvasReferenceTarget([source, neighbor], [], source.id, createId);
        const template = BUILTIN_REFERENCE_TEMPLATES[0];
        const graph = applyCanvasReferenceTemplate({ ...prepared, template, createId, images: [{ mediaId: template.items[0].mediaId, storageKey: 'resource:reference', url: 'data:image/png;base64,reference', width: 768, height: 1024, mimeType: 'image/png', bytes: 10 }] });
        for (const added of graph.nodes.filter(node => !['source', 'neighbor'].includes(node.id))) {
            for (const existing of graph.nodes.filter(node => node.id !== added.id)) {
                expect(added.position.x < existing.position.x + existing.width && added.position.x + added.width > existing.position.x && added.position.y < existing.position.y + existing.height && added.position.y + added.height > existing.position.y).toBe(false);
            }
        }
        expect(graph.nodes[0]).toEqual(source);
        expect(graph.nodes[1]).toEqual(neighbor);
    });
});
