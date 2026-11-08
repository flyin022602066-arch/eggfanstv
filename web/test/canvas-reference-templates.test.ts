import { describe, expect, test } from 'bun:test';
import { applyCanvasReferenceTemplate, removeCanvasReferenceTemplate, filterReferenceTemplates, templateReferenceInstructions, type CanvasReferenceTemplate } from '../src/lib/canvas/canvas-reference-templates';
import { CanvasNodeType, type CanvasNodeData } from '../src/types/canvas';
import { buildNodeGenerationContext } from '../src/components/canvas/canvas-node-generation';

const target: CanvasNodeData = { id: 'target', type: CanvasNodeType.Image, title: '生图', position: { x: 500, y: 0 }, width: 320, height: 240, metadata: { nodeRole: 'generator', composerContent: '主角走在街上', model: 'keep-model' } };
const template = (id = 'pose', role: 'pose' | 'costume' = 'pose'): CanvasReferenceTemplate => ({ id, title: id, kind: role, tags: ['站姿'], favorite: false, createdAt: '2026-11-02', updatedAt: '2026-11-02', items: [{ mediaId: id, role, instruction: '', angle: '正面' }] });
const media = (id: string) => ({ mediaId: id, storageKey: 'resource:' + id, url: 'data:image/png;base64,a', width: 600, height: 900, mimeType: 'image/png', bytes: 99 });
const apply = (nodes = [target], connections: Parameters<typeof applyCanvasReferenceTemplate>[0]['connections'] = [], t = template()) => applyCanvasReferenceTemplate({ nodes, connections, targetNodeId: target.id, template: t, images: [media(t.items[0].mediaId)], createId: (() => { let id = 0; return () => t.id + '-' + (++id); })() });

describe('canvas reference templates', () => {
    test('applies image inputs without replacing prompt or model; repeated apply reuses graph', () => {
        const first = apply();
        const second = apply(first.nodes, first.connections);
        expect(second.nodes.length).toBe(first.nodes.length);
        expect(second.connections.length).toBe(1);
        expect(second.nodes.find(n => n.id === target.id)?.metadata?.composerContent).toBe('主角走在街上');
        expect(second.nodes.find(n => n.id === target.id)?.metadata?.model).toBe('keep-model');
        const context = buildNodeGenerationContext(target.id, second.nodes, second.connections, '主角走在街上', []);
        expect(context.referenceImages).toHaveLength(1);
        expect(context.prompt).toContain('@图片1');
        expect(context.prompt).toContain('姿势');
    });
    test('replaces the same role and removes only owned edges', () => {
        const original: CanvasNodeData = { ...target, id: 'user-image', metadata: { content: 'data:image/png;base64,b', storageKey: 'resource:user' } };
        const first = apply([target, original], [{ id: 'manual', fromNodeId: original.id, toNodeId: target.id }]);
        const costume = apply(first.nodes, first.connections, template('shirt', 'costume'));
        const replacement = apply(costume.nodes, costume.connections, template('other'));
        expect(replacement.connections).toHaveLength(3);
        const removed = removeCanvasReferenceTemplate(replacement.nodes, replacement.connections, target.id, 'pose');
        expect(removed.connections).toHaveLength(2);
        expect(removed.connections.find(c => c.id === 'manual')).toBeDefined();
        expect(removed.nodes.find(n => n.id === original.id)).toBeDefined();
    });
    test('explicit user mentions retain template inputs and actual image numbering', () => {
        const existing: CanvasNodeData = { ...target, id: 'manual-image', metadata: { content: 'data:image/png;base64,b' } };
        const graph = apply([existing, target], [{ id: 'manual', fromNodeId: existing.id, toNodeId: target.id }]);
        const context = buildNodeGenerationContext(target.id, graph.nodes, graph.connections, '以 @图片1 为角色', []);
        expect(context.referenceImages).toHaveLength(2);
        expect(context.prompt).toContain('@图片2');
        expect(context.referenceImages[0].id).toBe(existing.id);
    });
    test('missing image refuses the entire graph change', () => {
        expect(() => applyCanvasReferenceTemplate({ nodes: [target], connections: [], targetNodeId: target.id, template: template(), images: [], createId: () => 'id' })).toThrow('图片');
        expect(target.metadata?.referenceTemplates).toBeUndefined();
    });
    test('shared template edges survive either removal and disappear after the final removal', () => {
        for (const removedKind of ['pose', 'combination'] as const) {
            const first = apply();
            const combination = { ...template('combo'), kind: 'combination' as const, items: template().items };
            const shared = apply(first.nodes, first.connections, combination);
            expect(shared.connections).toHaveLength(1);
            const removed = removeCanvasReferenceTemplate(shared.nodes, shared.connections, target.id, removedKind);
            expect(removed.connections).toHaveLength(1);
            const context = buildNodeGenerationContext(target.id, removed.nodes, removed.connections, '主角', []);
            expect(context.referenceImages).toHaveLength(1);
            expect(removeCanvasReferenceTemplate(removed.nodes, removed.connections, target.id).connections).toHaveLength(0);
        }
    });
    test('manually connected template images remain after all bindings are removed', () => {
        const first = apply();
        const nodes = first.nodes.map(node => node.id === target.id ? { ...node, metadata: { ...node.metadata, referenceTemplates: [] } } : node);
        const shared = apply(nodes, first.connections);
        expect(removeCanvasReferenceTemplate(shared.nodes, shared.connections, target.id).connections).toEqual(first.connections);
    });
    test('replacing a template preserves the identity of explicit manual image mentions', () => {
        const first = apply();
        const manual: CanvasNodeData = { ...target, id: 'manual-image', metadata: { content: 'data:image/png;base64,b' } };
        const nodes = [...first.nodes.map(node => node.id === target.id ? { ...node, metadata: { ...node.metadata, composerContent: '以 @图片2 为角色，保留原描述' } } : node), manual];
        const replacement = apply(nodes, [...first.connections, { id: 'manual', fromNodeId: manual.id, toNodeId: target.id }], template('replacement'));
        expect(replacement.nodes.find(node => node.id === target.id)?.metadata?.composerContent).toBe('以 @图片1 为角色，保留原描述');
        const context = buildNodeGenerationContext(target.id, replacement.nodes, replacement.connections, replacement.nodes.find(node => node.id === target.id)!.metadata!.composerContent!, []);
        expect(context.referenceImages[0].id).toBe(manual.id);
        expect(context.prompt).toContain('@图片2');
    });
    test('disconnected references are not silently submitted', () => {
        const graph = apply();
        const context = buildNodeGenerationContext(target.id, graph.nodes, [], '主角', []);
        expect(context.referenceImages).toHaveLength(0);
        expect(context.prompt).not.toContain('模板');
    });
    test('pending uploads with a new storage key reuse the original unmodified template node', () => {
        const first = apply();
        const next = applyCanvasReferenceTemplate({ ...first, targetNodeId: target.id, template: template(), images: [{ ...media('pose'), storageKey: 'image:retry', url: 'blob:retry' }], createId: () => 'retry-edge' });
        expect(next.nodes).toHaveLength(2); expect(next.connections).toHaveLength(1);
        expect(next.nodes.find(node => node.id !== target.id)?.metadata?.storageKey).toBe('image:retry');
        const edited = next.nodes.map(node => node.id === target.id ? node : { ...node, metadata: { ...node.metadata, storageKey: 'resource:manually-replaced' } });
        expect(apply(edited, next.connections).nodes).toHaveLength(3);
    });
    test('template images remain inputs when an attached config provides other reference images', () => {
        const config: CanvasNodeData = { ...target, id: 'config', type: CanvasNodeType.Config };
        const manual: CanvasNodeData = { ...target, id: 'manual', metadata: { content: 'data:image/png;base64,b' } };
        const graph = apply([target, config, manual], [{ id: 'config-edge', fromNodeId: target.id, toNodeId: config.id }, { id: 'manual-edge', fromNodeId: manual.id, toNodeId: config.id }]);
        const context = buildNodeGenerationContext(target.id, graph.nodes, graph.connections, '主角', []);
        expect(context.referenceImages).toHaveLength(2); expect(context.prompt).toContain('@图片2');
    });
    test('filters names, tags, role, favorites and angle', () => {
        const rows = [template(), { ...template('shirt', 'costume'), favorite: true }];
        expect(filterReferenceTemplates(rows, { kind: 'pose', query: '正面' })).toHaveLength(1);
        expect(filterReferenceTemplates(rows, { favorites: true }).map(x => x.id)).toEqual(['shirt']);
        expect(templateReferenceInstructions('costume')).toContain('服装');
    });
});
