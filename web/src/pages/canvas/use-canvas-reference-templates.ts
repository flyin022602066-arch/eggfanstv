import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { nanoid } from 'nanoid';
import { App } from 'antd';
import { applyCanvasReferenceTemplate, removeCanvasReferenceTemplate, type CanvasReferenceTemplate } from '@/lib/canvas/canvas-reference-templates';
import { captureUserScope, assertUserScope } from '@/lib/user-scope-guard';
import { referenceTemplateRepository } from '@/services/canvas-reference-templates';
import { buildNodeGenerationContext } from '@/components/canvas/canvas-node-generation';
import { buildGenerationConfig, assertCanvasImageReferenceLimit } from '@/lib/canvas/canvas-project-generation';
import { useEffectiveConfig } from '@/stores/use-config-store';
import { isCanvasNodeGenerating } from '@/lib/canvas/canvas-node-task-state';
import { applyCanvasConnectionPromptSync } from '@/lib/canvas/canvas-resource-references';
import type { CanvasConnection, CanvasNodeData } from '@/types/canvas';
import type { Asset } from '@/stores/use-asset-store';

type Options = { projectId: string; assets?: Asset[]; nodesRef: MutableRefObject<CanvasNodeData[]>; connectionsRef: MutableRefObject<CanvasConnection[]>; setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>; setConnections: Dispatch<SetStateAction<CanvasConnection[]>>; enabled: boolean };
export function useCanvasReferenceTemplates({ projectId, assets = [], nodesRef, connectionsRef, setNodes, setConnections, enabled }: Options) {
    const config = useEffectiveConfig();
    const configRef = useRef(config); configRef.current = config;
    const assetsRef = useRef(assets); assetsRef.current = assets;
    const { message } = App.useApp();
    const live = useRef({ projectId, enabled, epoch: 0 });
    if (live.current.projectId !== projectId || live.current.enabled !== enabled) live.current = { projectId, enabled, epoch: live.current.epoch + 1 };
    useEffect(() => {
        live.current = { projectId, enabled, epoch: live.current.epoch + 1 };
        return () => { live.current = { projectId: '', enabled: false, epoch: live.current.epoch + 1 }; };
    }, [projectId, enabled]);
    const apply = useCallback(async (nodeId: string, template: CanvasReferenceTemplate, signal: AbortSignal) => {
        const scope = captureUserScope();
        const epoch = live.current.epoch;
        const check = () => {
            assertUserScope(scope); signal.throwIfAborted();
            if (!live.current.enabled || live.current.projectId !== projectId || live.current.epoch !== epoch) throw new Error('画布已切换，本次应用已停止');
            const node = nodesRef.current.find(node => node.id === nodeId);
            if (!node) throw new Error('目标节点已删除');
            if (node.metadata?.locked) throw new Error('锁定的节点不能替换参考模板');
            if (isCanvasNodeGenerating(node, null)) throw new Error('生成中的节点不能替换参考模板');
            return node;
        };
        const verifyLimit = (graph: { nodes: CanvasNodeData[]; connections: CanvasConnection[] }) => {
            const node = graph.nodes.find(node => node.id === nodeId)!;
            const context = buildNodeGenerationContext(nodeId, graph.nodes, graph.connections, node.metadata?.composerContent ?? node.metadata?.prompt ?? '', assetsRef.current);
            const generationConfig = buildGenerationConfig(configRef.current, node, 'image');
            const selectedModel = node.metadata?.model || configRef.current.imageModel || generationConfig.model;
            assertCanvasImageReferenceLimit({ ...generationConfig, model: selectedModel, imageModel: selectedModel }, context.referenceImages);
        };
        check();
        const previews = template.items.map(item => {
            const existing = nodesRef.current.find(node => node.id !== nodeId && node.metadata?.referenceTemplateMediaId === item.mediaId && node.metadata.storageKey && node.metadata.content);
            return { mediaId: item.mediaId, storageKey: existing?.metadata?.storageKey || 'preview:' + item.mediaId, url: existing?.metadata?.content || 'data:image/png;base64,', width: 1, height: 1, mimeType: 'image/png', bytes: 1 };
        });
        verifyLimit(applyCanvasReferenceTemplate({ nodes: nodesRef.current, connections: connectionsRef.current, targetNodeId: nodeId, template, images: previews, createId: nanoid }));
        const images = await referenceTemplateRepository.materialize(template, scope, signal);
        check();
        const graph = applyCanvasReferenceTemplate({ nodes: nodesRef.current, connections: connectionsRef.current, targetNodeId: nodeId, template, images, createId: nanoid });
        verifyLimit(graph);
        check();
        setNodes(graph.nodes); setConnections(graph.connections);
        message.success(images.some(image => image.pendingRemoteUpload) ? '模板已应用；图片暂存本机，尚未写入资源服务' : '参考模板已应用到当前节点');
        try { await referenceTemplateRepository.markUsed(template.id, scope); }
        catch { if (!signal.aborted) message.warning('模板已应用，但最近使用记录保存失败'); }
    }, [config, projectId, nodesRef, connectionsRef, setNodes, setConnections, message]);
    const remove = useCallback((nodeId: string, kind: CanvasReferenceTemplate['kind']) => {
        if (!live.current.enabled || live.current.projectId !== projectId) return;
        const target = nodesRef.current.find(node => node.id === nodeId);
        if (target?.metadata?.locked) { message.warning('锁定的节点不能移除参考模板'); return; }
        if (!target || isCanvasNodeGenerating(target, null)) { message.warning('生成中的节点不能移除参考模板'); return; }
        const graph = removeCanvasReferenceTemplate(nodesRef.current, connectionsRef.current, nodeId, kind);
        const nodes = applyCanvasConnectionPromptSync(nodesRef.current, connectionsRef.current, graph.nodes, graph.connections);
        setNodes(nodes); setConnections(graph.connections);
    }, [projectId, nodesRef, connectionsRef, setNodes, setConnections, message]);
    return { applyReferenceTemplate: apply, removeReferenceTemplate: remove };
}
