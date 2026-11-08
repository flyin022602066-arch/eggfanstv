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
    useEffect(() => subscribeUserScope(() => { setRows([]); setError(''); setEpoch(value => value + 1); }), []);
    const refresh = useCallback(async () => {
        const scope = captureUserScope();
        setLoading(true);
        try { const next = await referenceTemplateRepository.list(scope); if (userScopeMatches(scope)) { setRows(next); setError(''); } }
        catch (cause) { if (userScopeMatches(scope)) setError(cause instanceof Error ? cause.message : '模板读取失败'); }
        finally { if (userScopeMatches(scope)) setLoading(false); }
    }, []);
    useEffect(() => { if (open) void refresh(); }, [open, refresh, epoch]);
    return { rows, loading, error, refresh, epoch };
}

export function ReferenceTemplateThumbnail({ mediaId, title }: { mediaId: string; title: string }) {
    const [url, setUrl] = useState('');
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let disposed = false;
        let objectUrl = '';
        const scope = captureUserScope();
        setUrl(''); setFailed(false);
        void referenceTemplateRepository.imageBlob(mediaId, scope).then(blob => {
            if (disposed || !userScopeMatches(scope)) return;
            objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
        }).catch(() => { if (!disposed && userScopeMatches(scope)) setFailed(true); });
        return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [mediaId]);
    return failed ? <span className="text-xs text-muted-foreground">图片缺失</span> : url ? <img src={url} alt={title} loading="lazy" className="h-full min-h-0 w-full min-w-0 object-contain" onError={() => setFailed(true)} /> : <span className="text-xs text-muted-foreground">加载中</span>;
}
