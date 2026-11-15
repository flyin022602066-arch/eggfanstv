import { useCallback, useEffect, useState } from 'react';
import { subscribeUserScope } from '@/lib/user-scope';
import { captureUserScope, userScopeMatches } from '@/lib/user-scope-guard';
import { referenceTemplateRepository } from '@/services/canvas-reference-templates';
import type { CanvasReferenceTemplate } from '@/lib/canvas/canvas-reference-templates';

export function useReferenceTemplateLibrary(open: boolean) {
    const [rows, setRows] = useState<CanvasReferenceTemplate[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [epoch, setEpoch] = useState(0);
    const [onlineRows, setOnlineRows] = useState<CanvasReferenceTemplate[]>([]);
    const [onlineLoading, setOnlineLoading] = useState(false);
    const [onlineError, setOnlineError] = useState('');
    const [onlineRevision, setOnlineRevision] = useState(0);
    useEffect(() => subscribeUserScope(() => { setRows([]); setOnlineRows([]); setError(''); setOnlineError(''); setEpoch(value => value + 1); }), []);
    const refresh = useCallback(async () => {
        const scope = captureUserScope();
        setLoading(true);
        try { const [builtins, custom] = await Promise.all([referenceTemplateRepository.listBuiltins(scope), referenceTemplateRepository.list(scope)]); if (userScopeMatches(scope)) { setRows([...builtins, ...custom]); setError(''); } }
        catch (cause) { if (userScopeMatches(scope)) setError(cause instanceof Error ? cause.message : '模板读取失败'); }
        finally { if (userScopeMatches(scope)) setLoading(false); }
    }, []);
    useEffect(() => { if (open) void refresh(); }, [open, refresh, epoch]);
    useEffect(() => {
        if (!open) return;
        const scope = captureUserScope();
        const controller = new AbortController();
        setOnlineLoading(true); setOnlineError(''); setOnlineRows([]);
        void referenceTemplateRepository.listRuiC(scope, controller.signal).then(next => {
            if (!controller.signal.aborted && userScopeMatches(scope)) setOnlineRows(next);
        }).catch(cause => {
            if (!controller.signal.aborted && userScopeMatches(scope)) setOnlineError(cause instanceof Error ? cause.message : '原图库加载失败');
        }).finally(() => { if (!controller.signal.aborted && userScopeMatches(scope)) setOnlineLoading(false); });
        return () => controller.abort();
    }, [open, epoch, onlineRevision, rows]);
    return { rows: [...onlineRows, ...rows], loading, error, refresh, epoch, onlineLoading, onlineError, retryOnline: () => setOnlineRevision(value => value + 1) };
}

export function ReferenceTemplateThumbnail({ mediaId, title, sourceUrl }: { mediaId: string; title: string; sourceUrl?: string }) {
    const [url, setUrl] = useState('');
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let disposed = false;
        let objectUrl = '';
        const scope = captureUserScope();
        setUrl(''); setFailed(false);
        if (sourceUrl) { setUrl(sourceUrl); return () => { disposed = true; }; }
        void referenceTemplateRepository.imageBlob(mediaId, scope).then(blob => {
            if (disposed || !userScopeMatches(scope)) return;
            objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
        }).catch(() => { if (!disposed && userScopeMatches(scope)) setFailed(true); });
        return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [mediaId, sourceUrl]);
    return failed ? <span className="text-xs text-muted-foreground">图片读取失败，请重试或打开原站</span> : url ? <img src={url} alt={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full min-h-0 w-full min-w-0 object-contain" onError={() => setFailed(true)} /> : <span className="text-xs text-muted-foreground">加载中</span>;
}
