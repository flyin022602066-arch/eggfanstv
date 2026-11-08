import { afterEach, describe, expect, test } from 'bun:test';
import { createReferenceTemplateRepository } from '../src/services/canvas-reference-templates';
import { setActiveUserScope } from '../src/lib/user-scope';
import { captureUserScope } from '../src/lib/user-scope-guard';

const png = () => new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,1,2])], 'pose.png', { type: 'image/png' });
const draft = { title: '站姿', role: 'pose' as const, tags: ['正面'] };
function fixture() {
    const values = new Map<string, unknown>();
    let fail = false; let uploadCount = 0; let pending = false;
    const store = { async getItem<T>(key: string) { return (values.get(key) as T) || null; }, async setItem<T>(key: string, value: T) { if (fail) throw new Error('disk full'); values.set(key, value); return value; } };
    const deps = { store, dimensions: async () => ({ width: 100, height: 200 }), upload: async () => { uploadCount++; return { storageKey: 'resource:stored', url: '/api/resources/stored/file', width: 100, height: 200, mimeType: 'image/png', bytes: 11, pendingRemoteUpload: pending }; }, resolve: async () => '/api/resources/stored/file' };
    const repository = createReferenceTemplateRepository(deps);
    return { repository, deps, values, get uploadCount() { return uploadCount; }, fail: () => { fail = true; }, pending: () => { pending = true; } };
}
afterEach(() => setActiveUserScope(null));
describe('reference template repository', () => {
    test('persists metadata and blobs across repository instances, without uploading on import', async () => {
        setActiveUserScope('a'); const f = fixture();
        const row = await f.repository.importImage(png(), draft);
        const reopened = createReferenceTemplateRepository(f.deps);
        expect(await reopened.list()).toHaveLength(1);
        expect((await reopened.imageBlob(row.items[0].mediaId)).size).toBe(png().size);
        expect(f.uploadCount).toBe(0);
        expect(f.values.size).toBe(2);
    });
    test('deduplicates image bytes, reuses uploaded resources and keeps project image after template removal', async () => {
        const f = fixture(); const a = await f.repository.importImage(png(), draft); const b = await f.repository.importImage(png(), { ...draft, title: '另一模板' });
        expect(a.items[0].mediaId).toBe(b.items[0].mediaId);
        await f.repository.materialize(a); await f.repository.materialize(b);
        expect(f.uploadCount).toBe(1);
        await f.repository.remove(a.id);
        expect(await f.repository.list()).toHaveLength(1);
        expect(await f.repository.imageBlob(a.items[0].mediaId)).toBeDefined();
    });
    test('serializes favorite and recent writes without losing either update', async () => {
        const f = fixture(); const a = await f.repository.importImage(png(), draft);
        await Promise.all([f.repository.toggleFavorite(a.id), f.repository.markUsed(a.id)]);
        const [saved] = await f.repository.list();
        expect(saved.favorite).toBe(true); expect(saved.lastUsedAt).toBeDefined();
    });
    test('isolates both catalog and images by active account', async () => {
        const f = fixture(); setActiveUserScope('a');
        const a = await f.repository.importImage(png(), draft);
        setActiveUserScope('b');
        expect(await f.repository.list()).toHaveLength(0);
        await expect(f.repository.imageBlob(a.items[0].mediaId)).rejects.toThrow('缺失');
        setActiveUserScope('a'); expect(await f.repository.list()).toHaveLength(1);
    });
    test('abandoned scope and canceled import do not save or upload', async () => {
        const f = fixture(); setActiveUserScope('a'); const scope = captureUserScope(); setActiveUserScope('b');
        await expect(f.repository.importImage(png(), draft, scope)).rejects.toThrow('账号已切换');
        const controller = new AbortController(); controller.abort();
        await expect(f.repository.importImage(png(), draft, captureUserScope(), controller.signal)).rejects.toThrow();
        expect(f.values.size).toBe(0); expect(f.uploadCount).toBe(0);
    });
    test('rejects invalid MIME, forged image, oversize and empty title', async () => {
        const f = fixture();
        await expect(f.repository.importImage(new File(['svg'], 'a.svg', { type: 'image/svg+xml' }), draft)).rejects.toThrow('仅支持');
        await expect(f.repository.importImage(new File(['not png'], 'a.png', { type: 'image/png' }), draft)).rejects.toThrow('内容');
        await expect(f.repository.importImage(new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }), draft)).rejects.toThrow('12MB');
        await expect(f.repository.importImage(png(), { ...draft, title: '' })).rejects.toThrow('名称');
        expect(f.values.size).toBe(0);
    });
    test('write failures propagate, catalog never claims saved', async () => {
        const f = fixture(); f.fail();
        await expect(f.repository.importImage(png(), draft)).rejects.toThrow('disk full');
        expect(await f.repository.list()).toHaveLength(0);
    });
    test('a saved combination survives deleting its source template', async () => {
        const f = fixture(); const row = await f.repository.importImage(png(), draft);
        await f.repository.save({ ...row, id: 'combo', kind: 'combination', title: '组合' });
        await f.repository.remove(row.id);
        expect((await f.repository.materialize((await f.repository.list())[0]))).toHaveLength(1);
    });
    test('pending backend upload is explicitly marked and not cached as a durable remote resource', async () => {
        const f = fixture(); f.pending(); const row = await f.repository.importImage(png(), draft);
        expect((await f.repository.materialize(row))[0].pendingRemoteUpload).toBe(true);
        await f.repository.materialize(row); expect(f.uploadCount).toBe(2);
    });
    test('canceling during image persistence leaves no template catalog entry', async () => {
        const f = fixture(); const controller = new AbortController();
        const original = f.deps.store.setItem;
        f.deps.store.setItem = async (key, value) => { const result = await original(key, value); controller.abort(); return result; };
        await expect(f.repository.importImage(png(), draft, captureUserScope(), controller.signal)).rejects.toThrow();
        expect(await f.repository.list()).toHaveLength(0);
    });
    test('switching accounts during upload never writes a resource binding for either account', async () => {
        setActiveUserScope('a'); const f = fixture(); const row = await f.repository.importImage(png(), draft);
        f.deps.upload = async () => { setActiveUserScope('b'); return { storageKey: 'resource:wrong-scope', url: '/file', width: 1, height: 1, mimeType: 'image/png', bytes: 1, pendingRemoteUpload: false }; };
        await expect(f.repository.materialize(row)).rejects.toThrow('账号已切换');
        expect(await f.repository.list()).toHaveLength(0);
        expect([...f.values.values()].some(value => typeof value === 'object' && value !== null && 'resource' in value)).toBe(false);
    });
});
