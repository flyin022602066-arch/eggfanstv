import { describe, expect, test } from 'bun:test';
import { normalizeRuiCReferenceCatalog, loadRuiCReferenceTemplates, validateRuiCReferenceImage } from '../src/lib/canvas/canvas-reference-ruic';

const poses = { generatedAt: '2026-10-28', angles: [{ key: 'front', names: { zh: '正面' } }, { key: 'side', names: { zh: '侧面' } }], series: [{ key: 'full_std', names: { zh: '全身标准' } }], poses: [{ id: 'full_std_P001', series: 'full_std', category: '站姿', names: { zh: '自然站姿' }, variants: [{ angle: 'front', thumb: 'thumbs/full_std_P001_front.jpg', full: 'img/full_std_P001_front.png' }, { angle: 'side', thumb: 'thumbs/full_std_P001_side.jpg', full: 'img/full_std_P001_side.png' }] }] };

describe('RuiC original reference catalogs', () => {
    test('uses the original thumbnails and full-size images for every pose angle, never substitute diagrams', () => {
        const rows = normalizeRuiCReferenceCatalog('pose', poses);
        expect(rows).toHaveLength(2);
        expect(rows[0].title).toBe('自然站姿 · 正面');
        expect(rows[1].items[0].angle).toBe('侧面');
        expect(rows[0].items[0].sourceImage?.thumbnailUrl).toBe('https://hruiccc.github.io/RuiC-PoseAtlas/thumbs/full_std_P001_front.jpg');
        expect(rows[0].items[0].sourceImage?.url).toBe('https://hruiccc.github.io/RuiC-PoseAtlas/img/full_std_P001_front.png');
        expect(rows[0].tags).toContain('全身标准');
    });
    test('keeps costume originals and portrait full_remote, with the correct reference purposes', () => {
        const costume = normalizeRuiCReferenceCatalog('costume', { categories: [{ key: 'spring', names: { zh: '春' } }], groups: [{ key: 'top', names: { zh: '上装' } }], costumes: [{ id: 'SPR-0001', cat: 'spring', group: 'top', tags: ['ivory', 'knit'], thumb: 'costume/thumbs/SPR-0001.webp', image: 'costume/img/SPR-0001.webp' }] })[0];
        const face = normalizeRuiCReferenceCatalog('character', { sections: [{ key: 'face', names: { zh: '脸部' } }], hairs: [{ key: 'short', names: { zh: '短发' } }], images: [{ id: 'f71f980dde3', sec: 'face', hair: 'short', w: 1122, h: 1402, thumb: 'portrait/thumbs/f71f980dde3.webp', full_remote: 'https://ai-portrait-gallery.pages.dev/img/full/f71f980dde3.png' }] })[0];
        expect(costume.items[0].sourceImage?.url).toEndWith('/costume/img/SPR-0001.webp');
        expect(face.items[0].sourceImage?.url).toBe('https://ai-portrait-gallery.pages.dev/img/full/f71f980dde3.png');
        expect(face.items[0].instruction).toContain('身份');
        expect(face.items[0].sourceImage?.width).toBe(1122);
    });
    test('loads all three catalogs without downloading their media or contacting model APIs', async () => {
        const urls: string[] = [];
        const rows = await loadRuiCReferenceTemplates(undefined, async input => {
            urls.push(String(input));
            const value = String(input).endsWith('/poses.json') ? poses : String(input).endsWith('/costumes.json') ? { costumes: [] } : { images: [] };
            return Response.json(value);
        });
        expect(rows).toHaveLength(2);
        expect(urls).toHaveLength(3);
        expect(urls.every(url => url.endsWith('.json'))).toBe(true);
    });
    test('rejects failed catalogs and untrusted or credential-bearing image links instead of silently replacing them', async () => {
        await expect(loadRuiCReferenceTemplates(undefined, async () => new Response('', { status: 503 }))).rejects.toThrow('503');
        expect(() => normalizeRuiCReferenceCatalog('pose', { poses: [{ ...poses.poses[0], variants: [{ angle: 'front', thumb: 'https://evil.invalid/a.jpg', full: 'img/a.png' }] }] })).toThrow();
        for (const url of ['http://127.0.0.1/a.png', 'https://evil.invalid/a.png', 'https://hruiccc.github.io/RuiC-PoseAtlas/img/a.png?key=secret']) {
            expect(() => validateRuiCReferenceImage({ url, thumbnailUrl: url })).toThrow();
        }
    });
});
