import { fitNodeSize } from '@/lib/canvas/canvas-node-size';
import { applyCanvasConnectionPromptSync } from '@/lib/canvas/canvas-resource-references';
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from '@/types/canvas';

export type ReferenceTemplateRole = 'pose' | 'costume' | 'character';
export type ReferenceTemplateItem = { mediaId: string; role: ReferenceTemplateRole; instruction: string; angle?: string };
export type CanvasReferenceTemplate = { id: string; title: string; kind: ReferenceTemplateRole | 'combination'; tags: string[]; items: ReferenceTemplateItem[]; favorite: boolean; createdAt: string; updatedAt: string; lastUsedAt?: string; sourceUrl?: string };
export type ReferenceTemplateImage = { mediaId: string; storageKey: string; url: string; width: number; height: number; mimeType: string; bytes: number; pendingRemoteUpload?: boolean };
export type CanvasReferenceTemplateBinding = { id: string; title: string; kind: CanvasReferenceTemplate['kind']; connectionIds: string[]; items: Array<ReferenceTemplateItem & { nodeId: string }> };

export const REFERENCE_TEMPLATE_LABELS = { pose: '姿势', costume: '服装', character: '角色', combination: '组合' } as const;
export const REFERENCE_TEMPLATE_SOURCES = [
    { title: '姿势原站', url: 'https://ai-pose-gallery.pages.dev/' },
    { title: '服装原站', url: 'https://ai-costume-gallery.pages.dev/' },
    { title: 'RuiC 图鉴', url: 'https://github.com/HRuiCcc/RuiC-PoseAtlas' },
];

export function templateReferenceInstructions(role: ReferenceTemplateRole) {
    return role === 'pose' ? '仅参考人物姿势、身体动作及构图，不复制人台的脸、肤色或服装。' : role === 'costume' ? '仅参考服装款式、颜色、材质及搭配，不改变角色身份、脸部和体型。' : '参考角色身份、面部特征及外貌，服装与姿势遵循其他参考和主体描述。';
}

export function filterReferenceTemplates(rows: CanvasReferenceTemplate[], options: { kind?: string; query?: string; favorites?: boolean; recent?: boolean } = {}) {
    const query = options.query?.trim().toLocaleLowerCase() || '';
    return rows.filter(row => (!options.kind || options.kind === 'all' || row.kind === options.kind) && (!options.favorites || row.favorite) && (!options.recent || row.lastUsedAt) && (!query || [row.title, ...row.tags, ...row.items.map(item => item.angle || '')].join(' ').toLocaleLowerCase().includes(query)))
        .sort((a, b) => (options.recent ? b.lastUsedAt || '' : b.updatedAt).localeCompare(options.recent ? a.lastUsedAt || '' : a.updatedAt));
}

export function validateReferenceTemplate(row: CanvasReferenceTemplate) {
    if (!row.id.trim() || !row.title.trim() || row.title.length > 100) throw new Error('请输入 1–100 字的模板名称');
    if (!['pose', 'costume', 'character', 'combination'].includes(row.kind)) throw new Error('模板分类无效');
    if (!row.items.length || row.items.length > 3 || new Set(row.items.map(item => item.role)).size !== row.items.length) throw new Error('每个模板最多各选一张姿势、服装和角色参考');
    if (row.kind !== 'combination' && (row.items.length !== 1 || row.items[0].role !== row.kind)) throw new Error('模板分类与参考用途不一致');
    if (row.items.some(item => !item.mediaId || !['pose', 'costume', 'character'].includes(item.role) || item.instruction.length > 2000)) throw new Error('参考图片或用途说明无效');
    if (row.sourceUrl) {
        let url: URL;
        try { url = new URL(row.sourceUrl); } catch { throw new Error('来源请使用不含参数的 HTTPS 页面地址'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('来源请使用不含参数的 HTTPS 页面地址');
    }
}

export function removeCanvasReferenceTemplate(nodes: CanvasNodeData[], connections: CanvasConnection[], targetNodeId: string, kind?: CanvasReferenceTemplate['kind']) {
    const target = nodes.find(node => node.id === targetNodeId);
    const bindings = target?.metadata?.referenceTemplates || [];
    const removed = bindings.filter(binding => !kind || binding.kind === kind);
    const edges = new Set(removed.flatMap(binding => binding.connectionIds));
    const kept = bindings.filter(binding => !removed.includes(binding)).map(binding => {
        const shared = connections.filter(edge => edges.has(edge.id) && edge.toNodeId === targetNodeId && binding.items.some(item => item.nodeId === edge.fromNodeId));
        return { ...binding, connectionIds: [...new Set([...binding.connectionIds, ...shared.map(edge => edge.id)])] };
    });
    const retainedEdges = new Set(kept.flatMap(binding => binding.connectionIds));
    return { nodes: nodes.map(node => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, referenceTemplates: kept } } : node), connections: connections.filter(edge => !edges.has(edge.id) || retainedEdges.has(edge.id)) };
}

export function applyCanvasReferenceTemplate(input: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; targetNodeId: string; template: CanvasReferenceTemplate; images: ReferenceTemplateImage[]; createId: () => string }) {
    const { targetNodeId, template, images, createId } = input;
    validateReferenceTemplate(template);
    const target = input.nodes.find(node => node.id === targetNodeId);
    if (!target || target.type !== CanvasNodeType.Image) throw new Error('目标生图节点已不存在');
    if (template.items.some(item => !images.some(image => image.mediaId === item.mediaId && image.storageKey && image.url))) throw new Error('模板图片缺失，请重新导入');
    const graph = removeCanvasReferenceTemplate(input.nodes, input.connections, targetNodeId, template.kind);
    const bindings = graph.nodes.find(node => node.id === targetNodeId)?.metadata?.referenceTemplates || [];
    const binding: CanvasReferenceTemplateBinding = { id: template.id, title: template.title, kind: template.kind, connectionIds: [], items: [] };
    for (const [index, item] of template.items.entries()) {
        const image = images.find(value => value.mediaId === item.mediaId)!;
        let node = graph.nodes.find(value => value.id !== targetNodeId && value.type === CanvasNodeType.Image && value.metadata?.referenceTemplateMediaId === item.mediaId && (value.metadata.referenceTemplateStorageKey || image.storageKey) === value.metadata.storageKey);
        if (!node) {
            const size = fitNodeSize(image.width, image.height);
            node = { id: createId(), type: CanvasNodeType.Image, title: `${REFERENCE_TEMPLATE_LABELS[item.role]} · ${template.title}`, position: { x: target.position.x - size.width - 80, y: target.position.y + index * (size.height + 40) }, ...size, metadata: { nodeRole: 'result', resultOrigin: 'upload', content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, mimeType: image.mimeType, bytes: image.bytes, referenceTemplateMediaId: item.mediaId, referenceTemplateStorageKey: image.storageKey } };
            graph.nodes.push(node);
        } else if (node.metadata?.storageKey !== image.storageKey || node.metadata.content !== image.url) {
            node = { ...node, metadata: { ...node.metadata, storageKey: image.storageKey, content: image.url, referenceTemplateStorageKey: image.storageKey } };
            graph.nodes = graph.nodes.map(value => value.id === node!.id ? node! : value);
        }
        const existing = graph.connections.find(edge => edge.fromNodeId === node.id && edge.toNodeId === targetNodeId);
        if (!existing) {
            const id = createId();
            graph.connections.push({ id, fromNodeId: node.id, toNodeId: targetNodeId });
            binding.connectionIds.push(id);
        } else if (bindings.some(value => value.connectionIds.includes(existing.id))) {
            binding.connectionIds.push(existing.id);
        }
        binding.items.push({ ...item, nodeId: node.id });
    }
    graph.nodes = graph.nodes.map(node => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, referenceTemplates: [...bindings, binding] } } : node);
    graph.nodes = applyCanvasConnectionPromptSync(input.nodes, input.connections, graph.nodes, graph.connections);
    return graph;
}
