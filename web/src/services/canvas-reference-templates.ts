import { nanoid } from 'nanoid';
import { APP_STATE_STORE_NAME, localForageInstance } from '@/lib/localforage-storage';
import { scopedStorageKey } from '@/lib/user-scope';
import { assertUserScope, captureUserScope, type CapturedUserScope } from '@/lib/user-scope-guard';
import { validateReferenceTemplate, type CanvasReferenceTemplate, type ReferenceTemplateImage, type ReferenceTemplateItem } from '@/lib/canvas/canvas-reference-templates';
import { BUILTIN_REFERENCE_TEMPLATES, isBuiltinReferenceTemplate, renderBuiltinReferenceSvg } from '@/lib/canvas/canvas-reference-builtins';
import { fetchRuiCReferenceImage, isRuiCReferenceTemplate, loadRuiCReferenceTemplates } from '@/lib/canvas/canvas-reference-ruic';

type StoredImage = { blob: Blob; width: number; height: number; mimeType: string; resource?: Omit<ReferenceTemplateImage, 'url'> };
type Store = { getItem<T>(key: string): Promise<T | null>; setItem<T>(key: string, value: T): Promise<T> };
type Dependencies = { store: Store; dimensions: (file: File) => Promise<{ width: number; height: number }>; upload: (blob: Blob, scope: CapturedUserScope) => Promise<Omit<ReferenceTemplateImage, 'mediaId'>>; resolve: (key: string) => Promise<string>; renderBuiltin?: (id: string) => Promise<Blob>; loadRuiC?: typeof loadRuiCReferenceTemplates; readSource?: typeof fetchRuiCReferenceImage };
export const REFERENCE_TEMPLATE_MAX_BYTES = 12 * 1024 * 1024;

export function createReferenceTemplateRepository(deps: Dependencies) {
    const queues = new Map<string, Promise<unknown>>();
    const uploads = new Map<string, Promise<ReferenceTemplateImage[]>>();
    let ruicCatalog: CanvasReferenceTemplate[] | undefined;
    const key = (name: string, scope: CapturedUserScope) => scopedStorageKey(`canvas-reference-templates:${name}`, scope.userScope);
    const check = (scope: CapturedUserScope, signal?: AbortSignal) => { assertUserScope(scope); signal?.throwIfAborted(); };
    const list = async (scope = captureUserScope()) => {
        check(scope);
        const rows = await deps.store.getItem<CanvasReferenceTemplate[]>(key('catalog', scope)) || [];
        check(scope);
        rows.forEach(validateReferenceTemplate);
        return rows;
    };
    async function mutate(update: (rows: CanvasReferenceTemplate[]) => CanvasReferenceTemplate[], scope: CapturedUserScope, signal?: AbortSignal) {
        const queueKey = key('catalog', scope);
        const previous = queues.get(queueKey) || Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            check(scope, signal);
            const rows = update(await list(scope));
            check(scope, signal);
            await deps.store.setItem(queueKey, rows);
            check(scope);
            return rows;
        });
        queues.set(queueKey, operation);
        try { return await operation; } finally { if (queues.get(queueKey) === operation) queues.delete(queueKey); }
    }
    async function save(row: CanvasReferenceTemplate, scope = captureUserScope(), signal?: AbortSignal) {
        validateReferenceTemplate(row);
        if (isBuiltinReferenceTemplate(row.id)) throw new Error('内置模板不能覆盖，请另存为我的模板');
        if (isRuiCReferenceTemplate(row)) throw new Error('原站模板不能覆盖，请另存为我的模板');
        for (const item of row.items) {
            check(scope, signal);
            if (!item.sourceImage && !isBuiltinReferenceTemplate(item.mediaId) && !await deps.store.getItem<StoredImage>(key('image:' + item.mediaId, scope))) throw new Error('参考图片不存在，请重新导入');
        }
        check(scope, signal);
        return mutate(rows => [row, ...rows.filter(value => value.id !== row.id)], scope, signal);
    }
    async function importImage(file: File, draft: { title: string; tags: string[]; role: ReferenceTemplateItem['role']; angle?: string; instruction?: string; sourceUrl?: string }, scope = captureUserScope(), signal?: AbortSignal) {
        check(scope, signal);
        if (!file.size || file.size > REFERENCE_TEMPLATE_MAX_BYTES) throw new Error('参考图大小必须在 0–12MB 之间');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
        if (!(file.type === 'image/png' && png || file.type === 'image/jpeg' && jpeg || file.type === 'image/webp' && webp)) throw new Error('图片内容与文件类型不符');
        check(scope, signal);
        const size = await deps.dimensions(file);
        if (!(size.width > 0 && size.height > 0) || size.width * size.height > 50_000_000) throw new Error('参考图尺寸无效或超过 5000 万像素');
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const mediaId = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
        const now = new Date().toISOString();
        const row: CanvasReferenceTemplate = { id: nanoid(), title: draft.title.trim(), tags: draft.tags.map(tag => tag.trim()).filter(Boolean).slice(0, 20), kind: draft.role, items: [{ mediaId, role: draft.role, angle: draft.angle?.trim(), instruction: draft.instruction?.trim() || '' }], sourceUrl: draft.sourceUrl?.trim() || undefined, favorite: false, createdAt: now, updatedAt: now };
        validateReferenceTemplate(row);
        check(scope, signal);
        const imageKey = key('image:' + mediaId, scope);
        if (!await deps.store.getItem<StoredImage>(imageKey)) {
            check(scope, signal);
            await deps.store.setItem<StoredImage>(imageKey, { blob: file, ...size, mimeType: file.type });
        }
        check(scope, signal);
        await save(row, scope, signal);
        return row;
    }
    async function materialize(row: CanvasReferenceTemplate, scope = captureUserScope(), signal?: AbortSignal): Promise<ReferenceTemplateImage[]> {
        check(scope, signal);
        validateReferenceTemplate(row);
        const output: ReferenceTemplateImage[] = [];
        for (const item of row.items) {
            check(scope, signal);
            const imageKey = key('image:' + item.mediaId, scope);
            const flightKey = imageKey + ':' + scope.epoch + (item.sourceImage ? ':' + item.sourceImage.url : '');
            let flight = uploads.get(flightKey);
            if (!flight) {
                flight = (async () => {
                    let image = await deps.store.getItem<StoredImage>(imageKey);
                    if (!image && item.sourceImage) {
                        const blob = await (deps.readSource || fetchRuiCReferenceImage)(item.sourceImage, signal);
                        check(scope, signal);
                        const dimensions = await deps.dimensions(new File([blob], 'ruic-reference', { type: blob.type }));
                        check(scope, signal);
                        if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error('RuiC 原图尺寸无效');
                        image = { blob, ...dimensions, mimeType: blob.type };
                        await deps.store.setItem(imageKey, image);
                    }
                    if (!image && isBuiltinReferenceTemplate(item.mediaId)) {
                        const blob = await (deps.renderBuiltin || rasterizeBuiltinReference)(item.mediaId);
                        check(scope);
                        image = { blob, width: 768, height: 1024, mimeType: 'image/png' };
                        await deps.store.setItem(imageKey, image);
                    }
                    check(scope, signal);
                    if (!image) throw new Error('模板图片已缺失，请重新导入');
                    if (image.resource) {
                        const url = await deps.resolve(image.resource.storageKey);
                        check(scope);
                        if (!url) throw new Error('模板项目资源无法读取，请稍后重试');
                        return [{ ...image.resource, mediaId: item.mediaId, url }];
                    }
                    check(scope, signal);
                    const uploaded = await deps.upload(image.blob, scope);
                    check(scope);
                    const result: ReferenceTemplateImage = { ...uploaded, mediaId: item.mediaId };
                    if (!uploaded.pendingRemoteUpload) {
                        const { url: _url, ...resource } = result;
                        await deps.store.setItem<StoredImage>(imageKey, { ...image, resource });
                        check(scope);
                    }
                    return [result];
                })();
                uploads.set(flightKey, flight);
            }
            try { output.push(...await flight); } finally { if (uploads.get(flightKey) === flight) uploads.delete(flightKey); }
        }
        check(scope, signal);
        return output;
    }
    const withBuiltin = (rows: CanvasReferenceTemplate[], id: string) => {
        if (rows.some(row => row.id === id)) return rows;
        const definition = BUILTIN_REFERENCE_TEMPLATES.find(row => row.id === id) || ruicCatalog?.find(row => row.id === id);
        return definition ? [...rows, definition] : rows;
    };
    return { list: async (scope = captureUserScope()) => (await list(scope)).filter(row => !isBuiltinReferenceTemplate(row.id) && !isRuiCReferenceTemplate(row)), save, importImage, materialize,
        async listRuiC(scope = captureUserScope(), signal?: AbortSignal) {
            check(scope, signal);
            if (!ruicCatalog) ruicCatalog = await (deps.loadRuiC || loadRuiCReferenceTemplates)(signal);
            check(scope, signal);
            ruicCatalog.forEach(validateReferenceTemplate);
            const saved = new Map((await list(scope)).map(row => [row.id, row]));
            check(scope, signal);
            return ruicCatalog.map(row => ({ ...row, favorite: saved.get(row.id)?.favorite || false, lastUsedAt: saved.get(row.id)?.lastUsedAt }));
        },
        async listBuiltins(scope = captureUserScope()) { const saved = new Map((await list(scope)).map(row => [row.id, row])); return BUILTIN_REFERENCE_TEMPLATES.map(row => ({ ...row, favorite: saved.get(row.id)?.favorite || false, lastUsedAt: saved.get(row.id)?.lastUsedAt })); },
        async imageBlob(mediaId: string, scope = captureUserScope()) { check(scope); if (isBuiltinReferenceTemplate(mediaId)) return new Blob([renderBuiltinReferenceSvg(mediaId)], { type: 'image/svg+xml' }); const value = await deps.store.getItem<StoredImage>(key('image:' + mediaId, scope)); check(scope); if (!value) throw new Error('模板图片缺失'); return value.blob; },
        async remove(id: string, scope = captureUserScope()) { if (isBuiltinReferenceTemplate(id)) throw new Error('内置模板不能删除，可另存为我的模板后编辑'); return mutate(rows => rows.filter(row => row.id !== id), scope); },
        toggleFavorite: (id: string, scope = captureUserScope()) => mutate(rows => withBuiltin(rows, id).map(row => row.id === id ? { ...row, favorite: !row.favorite } : row), scope),
        markUsed: (id: string, scope = captureUserScope()) => mutate(rows => withBuiltin(rows, id).map(row => row.id === id ? { ...row, lastUsedAt: new Date().toISOString() } : row), scope),
    };
}

async function rasterizeBuiltinReference(id: string): Promise<Blob> {
    const url = URL.createObjectURL(new Blob([renderBuiltinReferenceSvg(id)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('内置参考图加载失败')); image.src = url; });
        const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 1024;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法准备内置参考图片');
        context.drawImage(image, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('内置参考图片转换失败')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
}

export const referenceTemplateRepository = createReferenceTemplateRepository({
    store: localForageInstance(APP_STATE_STORE_NAME),
    dimensions: async file => (await import('@/lib/canvas/canvas-file-upload')).readUploadImageSize(file),
    upload: async (blob, scope) => { const { uploadImage } = await import('@/services/image-storage'); const value = await uploadImage(blob, undefined, scope); return { ...value, mimeType: value.mimeType }; },
    resolve: async key => (await import('@/services/image-storage')).resolveImageUrl(key),
});
