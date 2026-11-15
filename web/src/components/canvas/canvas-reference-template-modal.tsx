import { App, Button, Input, Spin } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { AppModal } from '@/components/ui/product/app-modal';
import { filterReferenceTemplates, REFERENCE_TEMPLATE_LABELS, REFERENCE_TEMPLATE_SOURCES, type CanvasReferenceTemplate, type ReferenceTemplateItem, type ReferenceTemplateRole } from '@/lib/canvas/canvas-reference-templates';
import { captureUserScope, userScopeMatches } from '@/lib/user-scope-guard';
import { referenceTemplateRepository } from '@/services/canvas-reference-templates';
import { ReferenceTemplateThumbnail, useReferenceTemplateLibrary } from './use-reference-template-library';
import { isBuiltinReferenceTemplate } from '@/lib/canvas/canvas-reference-builtins';
import { isRuiCReferenceTemplate, RUIC_REFERENCE_SOURCES } from '@/lib/canvas/canvas-reference-ruic';

const roles: ReferenceTemplateRole[] = ['pose', 'costume', 'character'];
const controlClass = 'h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs text-foreground';
type Editor = { row?: CanvasReferenceTemplate; combination: boolean };

export function CanvasReferenceTemplateModal({ open, targetKey, initialKind = 'all', sourceNotice = false, onClose, onApply }: { open: boolean; targetKey: string; initialKind?: string; sourceNotice?: boolean; onClose: () => void; onApply: (row: CanvasReferenceTemplate, signal: AbortSignal) => Promise<void> }) {
    const { message } = App.useApp();
    const { rows, loading, error, refresh, epoch, onlineLoading, onlineError, retryOnline } = useReferenceTemplateLibrary(open);
    const [tab, setTab] = useState('all');
    const [source, setSource] = useState('ruic');
    const [query, setQuery] = useState('');
    const [tag, setTag] = useState('');
    const [angle, setAngle] = useState('');
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string>();
    const [editor, setEditor] = useState<Editor>();
    const [deleting, setDeleting] = useState<CanvasReferenceTemplate>();
    const [busy, setBusy] = useState(false);
    const [operationError, setOperationError] = useState('');
    const operation = useRef<AbortController | null>(null);
    const generation = useRef(0);
    useEffect(() => {
        generation.current++;
        operation.current?.abort(); setBusy(false); setOperationError(''); setSelectedId(undefined); setEditor(undefined); setDeleting(undefined);
        return () => { generation.current++; operation.current?.abort(); };
    }, [open, targetKey, epoch]);
    useEffect(() => { if (open) { setTab(initialKind); setSource('ruic'); setQuery(''); setTag(''); setAngle(''); } }, [open, targetKey, initialKind]);
    useEffect(() => setPage(1), [tab, source, query, tag, angle]);
    const filtered = useMemo(() => filterReferenceTemplates(rows, { kind: ['favorite', 'recent'].includes(tab) ? 'all' : tab, query, favorites: tab === 'favorite', recent: tab === 'recent' }).filter(row => (source === 'builtin' ? isBuiltinReferenceTemplate(row.id) : source === 'ruic' ? isRuiCReferenceTemplate(row) : source === 'custom' ? !isBuiltinReferenceTemplate(row.id) && !isRuiCReferenceTemplate(row) : !isBuiltinReferenceTemplate(row.id)) && (!tag || row.tags.includes(tag)) && (!angle || row.items.some(item => item.angle === angle))), [rows, tab, source, query, tag, angle]);
    const selected = rows.find(row => row.id === selectedId);
    const selectedReadOnly = Boolean(selected && (isBuiltinReferenceTemplate(selected.id) || isRuiCReferenceTemplate(selected)));
    useEffect(() => setPage(value => Math.min(value, Math.max(1, Math.ceil(filtered.length / 18)))), [filtered.length]);
    const tags = [...new Set(rows.flatMap(row => row.tags))].sort();
    const angles = [...new Set(rows.flatMap(row => row.items.map(item => item.angle).filter((value): value is string => Boolean(value))))].sort();
    const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
        if (operation.current && !operation.current.signal.aborted) return;
        const controller = new AbortController(); operation.current = controller;
        const currentGeneration = generation.current;
        const scope = captureUserScope();
        setBusy(true); setOperationError('');
        try { await action(controller.signal); if (!controller.signal.aborted && userScopeMatches(scope)) await refresh(); }
        catch (cause) { if (!controller.signal.aborted && userScopeMatches(scope)) { const text = cause instanceof Error ? cause.message : '模板操作失败'; setOperationError(text); message.error(text); } }
        finally { if (currentGeneration === generation.current) { operation.current = null; setBusy(false); } }
    };
    const close = () => { operation.current?.abort(); onClose(); };
    return <>
        <AppModal open={open} onCancel={close} title={null} footer={null} closable={false} flush width={1060} centered>
            <section data-canvas-no-zoom data-canvas-wheel-scroll className="flex max-h-[85dvh] min-h-0 flex-col bg-background text-foreground" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                <header className="flex items-center gap-3 border-b border-border p-4"><div className="min-w-0 flex-1"><h2 className="text-base font-semibold">参考模板库</h2><p className="mt-1 text-xs text-muted-foreground">RuiC 原图库：多角度姿势 · 完整衣装 · 虚构人像。浏览缩略图，应用原图。</p></div><Button onClick={close} aria-label="关闭参考模板库">关闭</Button></header>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                    <Button onClick={() => setEditor({ combination: false })} disabled={busy}>导入参考图</Button>
                    <Button onClick={() => setEditor({ combination: true })} disabled={busy || !rows.some(row => row.kind !== 'combination')}>新建组合</Button>
                    <span className="ml-auto text-xs text-muted-foreground">原站 {rows.filter(isRuiCReferenceTemplate).length} 张参考；我的模板保存在本机</span>
                </div>
                {sourceNotice ? <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">应用后会新建“参考编辑”生图节点，并将当前图片作为原图连入；不会覆盖或修改原图，也不会自动生成。</p> : null}
                <div className="flex flex-wrap gap-2 px-4 pt-3">{[['all', '全部'], ['pose', '姿势'], ['costume', '服装'], ['character', '人脸 / 角色'], ['combination', '组合'], ['favorite', '收藏'], ['recent', '最近']].map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} className="rounded-md border border-border px-3 py-1.5 text-xs aria-pressed:bg-muted aria-pressed:font-semibold focus-visible:outline" onClick={() => { setTab(key); setSelectedId(undefined); }}>{label}</button>)}</div>
                <div className="flex flex-wrap gap-2 px-4 pt-3">{[['ruic', 'RuiC 原图库'], ['all', '所有来源'], ['custom', '我的模板'], ['builtin', '内置示意']].map(([key, label]) => <button key={key} type="button" aria-pressed={source === key} className="rounded-md border border-border px-2 py-1 text-xs aria-pressed:bg-muted focus-visible:outline" onClick={() => { setSource(key); setSelectedId(undefined); }}>{label}</button>)}</div>
                {onlineLoading ? <p role="status" className="px-4 pt-2 text-xs text-muted-foreground">正在加载 RuiC 原图库目录，不会提交生成任务…</p> : null}
                {onlineError ? <div role="alert" className="px-4 pt-2 text-sm text-destructive">{onlineError}<Button size="small" onClick={retryOnline}>重试原图库</Button></div> : null}
                {source === 'builtin' ? <p role="status" className="px-4 pt-2 text-xs text-muted-foreground">这些是旧版本地结构示意，不是 RuiC 原图库图片。</p> : null}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3"><Input aria-label="搜索参考模板" placeholder="搜索名称、标签、视角" value={query} onChange={event => setQuery(event.target.value)} className="!w-60" allowClear /><select aria-label="筛选标签" className={controlClass} value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(value => <option key={value}>{value}</option>)}</select><select aria-label="筛选视角" className={controlClass} value={angle} onChange={event => setAngle(event.target.value)}><option value="">全部视角</option>{angles.map(value => <option key={value}>{value}</option>)}</select><span className="text-xs text-muted-foreground">{filtered.length} 个模板</span></div>
                {error ? <div role="alert" className="px-4 pb-2 text-destructive">{error}<Button size="small" onClick={() => void refresh()}>重试</Button></div> : null}
                {operationError ? <p role="alert" className="px-4 pb-2 text-sm text-destructive">{operationError}</p> : null}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border md:flex-row">
                    <div className="w-full min-w-0 shrink-0 p-4 md:w-auto md:flex-1">
                        {loading ? <Spin /> : null}
                        {!loading && !onlineLoading && !filtered.length ? <p className="py-12 text-center text-sm text-muted-foreground">{source === 'custom' && !rows.some(row => !isBuiltinReferenceTemplate(row.id) && !isRuiCReferenceTemplate(row)) ? '还没有模板。先导入一张参考图，即可保存和反复调用。' : '没有匹配的模板，可清除筛选、重试原图库或导入自己的参考图。'}</p> : null}
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{filtered.slice((page - 1) * 18, page * 18).map(row => <article key={row.id} className="overflow-hidden rounded-lg border border-border">
                            <button type="button" aria-label={`查看模板：${row.title}`} className="grid h-40 w-full place-items-center bg-muted focus-visible:outline" onClick={() => setSelectedId(row.id)}><ReferenceTemplateThumbnail mediaId={row.items[0].mediaId} title={row.title} sourceUrl={row.items[0].sourceImage?.thumbnailUrl} /></button>
                            <div className="space-y-2 p-2"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span><button type="button" aria-label={`收藏模板：${row.title}`} aria-pressed={row.favorite} onClick={() => void perform(async () => { await referenceTemplateRepository.toggleFavorite(row.id); })} disabled={busy} className="px-1 text-sm focus-visible:outline">{row.favorite ? '★' : '☆'}</button></div><p className="truncate text-xs text-muted-foreground">{REFERENCE_TEMPLATE_LABELS[row.kind]} · {row.items.map(item => item.angle).filter(Boolean).join(' / ') || row.tags.join(' · ') || '自建模板'}</p><Button size="small" onClick={() => setSelectedId(row.id)}>查看与应用</Button></div>
                        </article>)}</div>
                        {filtered.length > 18 ? <div className="mt-4 flex items-center justify-center gap-3"><Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span className="text-xs">{page} / {Math.ceil(filtered.length / 18)}</span><Button disabled={page * 18 >= filtered.length} onClick={() => setPage(value => value + 1)}>下一页</Button></div> : null}
                    </div>
                    {selected ? <aside className="w-full shrink-0 space-y-3 border-t border-border p-4 md:w-72 md:border-t-0 md:border-l">
                        <h3 className="break-words font-semibold">{selected.title}</h3><p className="text-xs text-muted-foreground">{selected.tags.join(' · ')}</p>
                        {selected.items.map(item => <div key={item.role} className="space-y-1"><div className="grid h-64 place-items-center rounded-md bg-muted"><ReferenceTemplateThumbnail mediaId={item.mediaId} title={selected.title + REFERENCE_TEMPLATE_LABELS[item.role]} sourceUrl={item.sourceImage?.thumbnailUrl} /></div><p className="text-xs">{REFERENCE_TEMPLATE_LABELS[item.role]}{item.angle ? ` · ${item.angle}` : ''}</p><p className="whitespace-pre-wrap text-xs text-muted-foreground">{item.instruction}</p>{item.sourceImage ? <a href={item.sourceImage.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">查看原始大图</a> : null}</div>)}
                        <Button type="primary" block loading={busy} onClick={() => void perform(signal => onApply(selected, signal))}>应用到当前节点</Button>
                        <div className="flex flex-wrap gap-2"><Button size="small" disabled={busy} onClick={() => setEditor({ row: selectedReadOnly ? { ...selected, id: nanoid(), source: undefined, title: selected.title.slice(0, 90) + ' · 我的设定', favorite: false, lastUsedAt: undefined } : selected, combination: selected.kind === 'combination' })}>{selectedReadOnly ? '另存为我的模板' : '编辑模板'}</Button>{!selectedReadOnly ? <Button size="small" danger disabled={busy} onClick={() => setDeleting(selected)}>删除模板</Button> : null}</div>
                        <p className="text-xs text-muted-foreground">应用原图，不会用缩略图代替；不会启动生成或覆盖主体提示词。实际效果取决于模型的参考编辑能力。</p>
                    </aside> : null}
                </div>
                <footer className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground"><p>图库图片在线引用；只在应用时读取所选原图，不随安装包再分发整库。版权归原作者，请遵守原站创作使用规则。</p><div className="flex flex-wrap gap-4">{[...RUIC_REFERENCE_SOURCES, ...REFERENCE_TEMPLATE_SOURCES].map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.title}</a>)}</div></footer>
            </section>
        </AppModal>
        {editor && open ? <ReferenceTemplateEditor key={`${editor.row?.id || 'new'}-${editor.combination}`} editor={editor} rows={rows} onClose={() => setEditor(undefined)} onSaved={async row => { setSelectedId(row.id); setTab(row.kind); setSource('custom'); setQuery(''); setTag(''); setAngle(''); setEditor(undefined); await refresh(); }} /> : null}
        <AppModal open={Boolean(deleting) && open} title="删除参考模板" onCancel={() => setDeleting(undefined)} okText="删除模板" cancelText="取消" okButtonProps={{ danger: true, loading: busy }} onOk={() => void perform(async () => { if (deleting) await referenceTemplateRepository.remove(deleting.id); setDeleting(undefined); })}><p>删除“{deleting?.title}”？已经应用到项目的图片和引用会保留。</p></AppModal>
    </>;
}

function ReferenceTemplateEditor({ editor, rows, onClose, onSaved }: { editor: Editor; rows: CanvasReferenceTemplate[]; onClose: () => void; onSaved: (row: CanvasReferenceTemplate) => Promise<void> }) {
    const [title, setTitle] = useState(editor.row?.title || '');
    const [tags, setTags] = useState(editor.row?.tags.join('，') || '');
    const [role, setRole] = useState<ReferenceTemplateRole>((editor.row?.items[0]?.role) || 'pose');
    const [angle, setAngle] = useState(editor.row?.items[0]?.angle || '');
    const [instruction, setInstruction] = useState(editor.row?.items[0]?.instruction || '');
    const [sourceUrl, setSourceUrl] = useState(editor.row?.sourceUrl || '');
    const [file, setFile] = useState<File>();
    const [items, setItems] = useState<ReferenceTemplateItem[]>(editor.row?.items || []);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef(new AbortController());
    useEffect(() => () => controller.current.abort(), []);
    const save = async () => {
        const scope = captureUserScope();
        setBusy(true); setError('');
        try {
            let row: CanvasReferenceTemplate;
            if (!editor.combination && !editor.row) {
                if (!file) throw new Error('请选择一张参考图');
                row = await referenceTemplateRepository.importImage(file, { title, tags: tags.split(/[,，、]/), role, angle, instruction, sourceUrl }, scope, controller.current.signal);
            } else {
                const now = new Date().toISOString();
                row = { id: editor.row?.id || nanoid(), title: title.trim(), tags: tags.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).slice(0, 20), kind: editor.combination ? 'combination' : role, items: editor.combination ? items : [{ ...editor.row!.items[0], role, angle, instruction }], sourceUrl: sourceUrl.trim() || undefined, favorite: editor.row?.favorite || false, createdAt: editor.row?.createdAt || now, updatedAt: now, lastUsedAt: editor.row?.lastUsedAt };
                await referenceTemplateRepository.save(row, scope, controller.current.signal);
            }
            if (!controller.current.signal.aborted && userScopeMatches(scope)) await onSaved(row);
        } catch (cause) { if (!controller.current.signal.aborted && userScopeMatches(scope)) setError(cause instanceof Error ? cause.message : '模板保存失败'); }
        finally { if (!controller.current.signal.aborted && userScopeMatches(scope)) setBusy(false); }
    };
    return <AppModal open title={editor.combination ? '组合参考模板' : editor.row ? '编辑参考模板' : '导入参考图'} onCancel={onClose} onOk={() => void save()} okText="保存到本机模板库" cancelText="取消" confirmLoading={busy} width={520}>
        <div data-canvas-no-zoom data-canvas-wheel-scroll className="max-h-[65dvh] space-y-3 overflow-y-auto" onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <label className="block space-y-1 text-xs"><span>模板名称</span><Input aria-label="模板名称" value={title} maxLength={100} onChange={event => setTitle(event.target.value)} /></label>
            <label className="block space-y-1 text-xs"><span>标签（用逗号分隔，可填季节、品类、颜色）</span><Input aria-label="模板标签" value={tags} maxLength={500} onChange={event => setTags(event.target.value)} /></label>
            {!editor.combination ? <>
                <label className="block space-y-1 text-xs"><span>参考用途</span><select aria-label="参考用途" className={controlClass + ' w-full'} value={role} onChange={event => setRole(event.target.value as ReferenceTemplateRole)}>{roles.map(value => <option value={value} key={value}>{REFERENCE_TEMPLATE_LABELS[value]}</option>)}</select></label>
                {!editor.row ? <label className="block space-y-1 text-xs"><span>图片（PNG、JPEG、WebP，单张不超过 12MB）</span><input aria-label="参考图片文件" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const next = event.target.files?.[0]; setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, '')); }} /></label> : null}
                <label className="block space-y-1 text-xs"><span>视角</span><Input aria-label="模板视角" placeholder="如正面、侧面、俯视" value={angle} maxLength={60} onChange={event => setAngle(event.target.value)} /></label>
                <label className="block space-y-1 text-xs"><span>补充用途说明</span><Input.TextArea aria-label="模板用途说明" rows={3} maxLength={2000} value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
            </> : roles.map(value => { const current = items.find(item => item.role === value); return <div key={value} className="space-y-2 rounded-md border border-border p-3"><label className="block space-y-1 text-xs"><span>{REFERENCE_TEMPLATE_LABELS[value]}参考</span><select className={controlClass + ' w-full'} aria-label={`组合${REFERENCE_TEMPLATE_LABELS[value]}`} value={current?.mediaId || ''} onChange={event => { const chosen = rows.filter(row => row.kind === value).flatMap(row => row.items).find(item => item.mediaId === event.target.value); setItems(previous => [...previous.filter(item => item.role !== value), ...(chosen ? [{ ...chosen }] : [])]); }}><option value="">不使用</option>{current && !rows.some(row => row.kind === value && row.items[0].mediaId === current.mediaId) ? <option value={current.mediaId}>已保存的参考</option> : null}{rows.filter(row => row.kind === value).map(row => <option key={row.id} value={row.items[0].mediaId}>{row.title}{row.items[0].angle ? ` · ${row.items[0].angle}` : ''}</option>)}</select></label>{current ? <Input.TextArea aria-label={`组合${REFERENCE_TEMPLATE_LABELS[value]}说明`} rows={2} maxLength={2000} placeholder="补充用途说明" value={current.instruction} onChange={event => setItems(previous => previous.map(item => item.role === value ? { ...item, instruction: event.target.value } : item))} /> : null}</div>; })}
            <label className="block space-y-1 text-xs"><span>来源页面（可选，不填带密钥或参数的链接）</span><Input aria-label="模板来源页面" placeholder="https://" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label>
            <p className="text-xs text-muted-foreground">请导入自有或获准逐张用于创作参考的图片。这里保存的是本机模板，不代表已同步到服务端。</p>
            {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
    </AppModal>;
}
