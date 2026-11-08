import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { CanvasNodePromptPanel } from '@/components/canvas/canvas-node-prompt-panel';
import { buildNodeGenerationContext } from '@/components/canvas/canvas-node-generation';
import { buildCanvasResourceReferences } from '@/lib/canvas/canvas-resource-references';
import { useCanvasReferenceTemplates } from '@/pages/canvas/use-canvas-reference-templates';
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from '@/types/canvas';
import { setActiveUserScope } from '@/lib/user-scope';
import { useUserStore } from '@/stores/use-user-store';
import { useConfigStore, defaultConfig, createModelChannel, encodeChannelModel } from '@/stores/use-config-store';
import { defaultModelCapabilityConfig } from '@/lib/model-capabilities';
import { getAntThemeConfig } from '@/lib/app-theme';
import { useCanvasThemeStore } from '@/stores/canvas/use-canvas-theme-store';
import { referenceTemplateRepository } from '@/services/canvas-reference-templates';

const dark = new URLSearchParams(location.search).get('theme') !== 'light';
document.documentElement.classList.toggle('dark', dark);
setActiveUserScope('reference-template-fixture');
useUserStore.setState({ hydrated: true, storageMode: 'remote', user: { id: 'reference-template-fixture', username: 'fixture', displayName: 'Fixture', role: 'user', status: 'active' } });
const model = encodeChannelModel('reference-fixture', 'gpt-image-1');
const setLimit = (maxImages: number) => {
    const capabilities = defaultModelCapabilityConfig('openai-image', 'gpt-image-1');
    const channel = createModelChannel({ id: 'reference-fixture', name: 'Fixture', interfaceType: 'openai-image', baseUrl: 'https://example.invalid', apiKey: 'fixture-only', models: ['gpt-image-1'], modelProfiles: [{ model: 'gpt-image-1', capability: 'image', protocol: 'openai-image', capabilityConfig: { ...capabilities, image: { ...capabilities.image!, references: { ...capabilities.image!.references, maxImages } } } }] });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model, imageModel: model } });
};
setLimit(10);
let materializeStarted = 0;
let resumeMaterialize: (() => void) | undefined;
let materializeGate: Promise<void> | undefined;
const materialize = referenceTemplateRepository.materialize;
referenceTemplateRepository.materialize = async (...args) => {
    materializeStarted++;
    if (materializeGate) await materializeGate;
    return materialize(...args);
};
useCanvasThemeStore.setState({ theme: dark ? 'dark' : 'light' });
const makeTarget = (): CanvasNodeData => ({ id: 'target', type: CanvasNodeType.Image, title: '生图', position: { x: 600, y: 50 }, width: 320, height: 240, metadata: { nodeRole: 'generator', prompt: '主角走在街上', composerContent: '主角走在街上', model } });
type Graph = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
function Harness() {
    const [projectId, setProjectId] = useState('project-a');
    const [graph, setGraph] = useState<Graph>(() => JSON.parse(localStorage.getItem('fixture-graph-a') || 'null') || { nodes: [makeTarget()], connections: [] });
    const graphRef = useRef(graph); graphRef.current = graph;
    const nodesRef = useRef(graph.nodes); nodesRef.current = graph.nodes;
    const connectionsRef = useRef(graph.connections); connectionsRef.current = graph.connections;
    const setNodes = (value: React.SetStateAction<CanvasNodeData[]>) => { const next = typeof value === 'function' ? value(nodesRef.current) : value; nodesRef.current = next; graphRef.current = { ...graphRef.current, nodes: next }; setGraph(graphRef.current); };
    const setConnections = (value: React.SetStateAction<CanvasConnection[]>) => { const next = typeof value === 'function' ? value(connectionsRef.current) : value; connectionsRef.current = next; graphRef.current = { ...graphRef.current, connections: next }; setGraph(graphRef.current); };
    const actions = useCanvasReferenceTemplates({ projectId, nodesRef, connectionsRef, setNodes, setConnections, enabled: true });
    const node = graph.nodes.find(node => node.id === 'target')!;
    const [snapshot, setSnapshot] = useState('');
    Object.assign(window, { referenceFixture: {
        setLimit,
        switchProject: () => { setProjectId(value => value === 'project-a' ? 'project-b' : 'project-a'); setGraph({ nodes: [makeTarget()], connections: [] }); },
        switchUser: (scope: string) => { setActiveUserScope(scope); setGraph({ nodes: [makeTarget()], connections: [] }); },
        graph: () => graphRef.current,
        pauseMaterialize: () => { materializeGate = new Promise(resolve => { resumeMaterialize = resolve; }); },
        materializeStarted: () => materializeStarted,
        resumeMaterialize: () => { materializeGate = undefined; resumeMaterialize?.(); },
    } });
    return <main className="min-h-screen bg-background p-8 text-foreground"><h1>Reference template fixture</h1><button onClick={() => { localStorage.setItem('fixture-graph-a', JSON.stringify(graphRef.current)); setProjectId('project-b'); setGraph({ nodes: [makeTarget()], connections: [] }); }}>切换项目</button><button onClick={() => { localStorage.setItem('fixture-graph-a', JSON.stringify(graphRef.current)); }}>保存测试画布</button><button onClick={() => { const target = nodesRef.current.find(node => node.id === 'target')!; setSnapshot(JSON.stringify(buildNodeGenerationContext('target', nodesRef.current, connectionsRef.current, target.metadata?.composerContent || '', []))); }}>检查生成输入</button><output aria-label="当前测试项目">{projectId}</output><output aria-label="参考图数">{graph.connections.length}</output><output aria-label="生成输入快照">{snapshot}</output><div className="mt-8 w-[520px] max-w-full"><CanvasNodePromptPanel projectId={projectId} node={node} isRunning={false} onPromptChange={(id, prompt) => setNodes(current => current.map(row => row.id === id ? { ...row, metadata: { ...row.metadata, composerContent: prompt } } : row))} onConfigChange={() => {}} onGenerate={() => { throw new Error('Real generation forbidden'); }} mentionReferences={buildCanvasResourceReferences(graph.nodes, graph.connections)} onApplyReferenceTemplate={actions.applyReferenceTemplate} onRemoveReferenceTemplate={actions.removeReferenceTemplate} /></div></main>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><ConfigProvider theme={getAntThemeConfig(dark)}><App><Harness /></App></ConfigProvider></MemoryRouter></QueryClientProvider>);
