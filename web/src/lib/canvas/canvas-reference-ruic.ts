import type { CanvasReferenceTemplate, ReferenceTemplateRole, ReferenceTemplateSourceImage } from './canvas-reference-templates';

export const RUIC_REFERENCE_BASE_URL = 'https://hruiccc.github.io/RuiC-PoseAtlas/';
export const RUIC_REFERENCE_SOURCES = [
    { title: 'RuiC 姿势图鉴', url: RUIC_REFERENCE_BASE_URL },
    { title: 'RuiC 衣装图鉴', url: RUIC_REFERENCE_BASE_URL + 'costume.html' },
    { title: 'RuiC 人像图鉴', url: RUIC_REFERENCE_BASE_URL + 'face.html' },
];

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const entries = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : [];
const label = (value: unknown) => String(record(value).zh || record(value).en || '');
const names = (value: unknown) => new Map(entries(value).map(item => [String(item.key), label(item.names)]));

function imageUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('RuiC 参考图片地址缺失');
    const url = new URL(value, RUIC_REFERENCE_BASE_URL);
    const allowed = url.origin === 'https://hruiccc.github.io' && url.pathname.startsWith('/RuiC-PoseAtlas/') || url.origin === 'https://ai-portrait-gallery.pages.dev' && url.pathname.startsWith('/img/');
    if (!allowed || url.username || url.password || url.search || url.hash || !/\.(?:png|jpe?g|webp)$/i.test(url.pathname)) throw new Error('RuiC 参考图片地址无效');
    return url.href;
}

export function validateRuiCReferenceImage(image: ReferenceTemplateSourceImage) {
    imageUrl(image.url);
    imageUrl(image.thumbnailUrl);
}

export function isRuiCReferenceTemplate(row: CanvasReferenceTemplate) {
    return row.source === 'ruic';
}

export function normalizeRuiCReferenceCatalog(role: ReferenceTemplateRole, input: unknown): CanvasReferenceTemplate[] {
    const catalog = record(input);
    const date = typeof catalog.generatedAt === 'string' ? catalog.generatedAt : '2026-10-29';
    const angles = names(catalog.angles);
    const series = names(catalog.series);
    const categories = names(catalog.categories);
    const groups = names(catalog.groups);
    const sections = names(catalog.sections);
    const hairs = names(catalog.hairs);
    const rows: CanvasReferenceTemplate[] = [];
    const add = (id: string, title: string, tags: string[], angle: string, image: ReferenceTemplateSourceImage) => {
        validateRuiCReferenceImage(image);
        const mediaId = 'ruic-reference:' + role + ':' + id;
        const instruction = role === 'pose' ? '仅参考原图人台的姿态、重心、关节及镜头视角；保留主体角色的身份、面容和服装，不复制人台材质。' : role === 'costume' ? '仅参考原图衣装的款式、颜色、材质、层次与搭配；保留原角色身份、面容、体型及指定姿势，不生成人台。' : '以此虚构人像原图作为角色身份与面部参考；服装、姿势及场景遵循主体提示词；已有角色原图时仅按用户明确要求调整。';
        rows.push({ id: mediaId, source: 'ruic', title: title.slice(0, 100), kind: role, tags: ['RuiC 原图库', ...tags.filter(Boolean)], items: [{ mediaId, role, angle, instruction, sourceImage: image }], sourceUrl: RUIC_REFERENCE_SOURCES[role === 'pose' ? 0 : role === 'costume' ? 1 : 2].url, favorite: false, createdAt: date, updatedAt: date });
    };
    if (role === 'pose') {
        if (!Array.isArray(catalog.poses)) throw new Error('RuiC 姿势目录格式无效');
        for (const pose of entries(catalog.poses)) {
            for (const variant of entries(pose.variants)) {
                const angle = angles.get(String(variant.angle)) || String(variant.angle);
                add(String(pose.id) + ':' + variant.angle, (label(pose.names) || String(pose.id)) + ' · ' + angle, [series.get(String(pose.series)) || '', String(pose.category || ''), String(pose.id)], angle, { thumbnailUrl: imageUrl(variant.thumb), url: imageUrl(variant.full), width: 900, height: 1200 });
            }
        }
    } else if (role === 'costume') {
        if (!Array.isArray(catalog.costumes)) throw new Error('RuiC 衣装目录格式无效');
        for (const costume of entries(catalog.costumes)) {
            const category = categories.get(String(costume.cat)) || String(costume.cat);
            const group = groups.get(String(costume.group)) || String(costume.group);
            const tags = Array.isArray(costume.tags) ? costume.tags.filter((tag): tag is string => typeof tag === 'string') : [];
            add(String(costume.id), [category, group, costume.id].join(' · '), [category, group, ...tags], '正面衣装', { thumbnailUrl: imageUrl(costume.thumb), url: imageUrl(costume.image), width: 1366, height: 2048 });
        }
    } else {
        if (!Array.isArray(catalog.images)) throw new Error('RuiC 人像目录格式无效');
        for (const face of entries(catalog.images)) {
            const section = sections.get(String(face.sec)) || String(face.sec);
            const hair = hairs.get(String(face.hair)) || String(face.hair);
            add(String(face.id), [section, hair, face.id].join(' · '), [section, hair, String(face.style || '')], face.sec === 'face' ? '正面人像' : '人物造型', { thumbnailUrl: imageUrl(face.thumb_remote || face.thumb), url: imageUrl(face.full_remote || face.full), width: Number(face.w), height: Number(face.h) });
        }
    }
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('RuiC 目录含重复图片标识');
    return rows;
}

export async function loadRuiCReferenceTemplates(signal?: AbortSignal, request: typeof fetch = fetch) {
    const catalogs = [['pose', 'poses'], ['costume', 'costumes'], ['character', 'faces']] as const;
    const rows = await Promise.all(catalogs.map(async ([role, file]) => {
        const response = await request(RUIC_REFERENCE_BASE_URL + 'data/' + file + '.json', { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('RuiC 图库目录加载失败（HTTP ' + response.status + '），可重试或打开原站');
        return normalizeRuiCReferenceCatalog(role, await response.json());
    }));
    signal?.throwIfAborted();
    return rows.flat();
}

export async function fetchRuiCReferenceImage(image: ReferenceTemplateSourceImage, signal?: AbortSignal): Promise<Blob> {
    validateRuiCReferenceImage(image);
    const response = await fetch(image.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('RuiC 原图读取失败（HTTP ' + response.status + '），未使用缩略图或示意图替代');
    const blob = await response.blob();
    if (!blob.size || !/^image\/(png|jpeg|webp)(?:;|$)/i.test(blob.type)) throw new Error('RuiC 原图返回的不是有效图片');
    return blob;
}
