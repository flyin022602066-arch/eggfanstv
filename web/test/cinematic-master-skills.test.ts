import { expect, spyOn, test } from 'bun:test';
import { storyboardRowsFromTask } from '../src/lib/canvas/canvas-project-domain';
import { reviewChapterDirectorTiming } from '../src/lib/chapter-director-script';
import { storyboardRowsToProjectShots } from '../src/pages/projects/detail/chapter-storyboard-production';
import { buildWorkflowVideoPrompt } from '../src/pages/projects/detail/workflow-video-prompt';
import { generateChapterStoryboard } from '../src/pages/projects/detail/project-chapter-ai';
import { createSkillRuntime, skillRuntime } from '../src/services/skill-runtime';
import * as taskApi from '../src/services/api/task-center';
import type { GenerationTask } from '../src/services/api/task-center';
import type { Skill, SkillPackageFileContent } from '../src/services/api/skills';
import { useConfigStore } from '../src/stores/use-config-store';

const definitions = [
    { slug: 'chixie-rusong-action-master', name: '持械入宋·打戏动作导演大师版1.0', reference: 'references/action-direction.md' },
    { slug: 'chixie-rusong-fantasy-vfx-master', name: '持械入宋·玄幻奇观特效导演大师版1.0', reference: 'references/fantasy-vfx-direction.md' },
];
const packages = await Promise.all(definitions.map(async (definition) => {
    const paths = ['SKILL.md', 'references/director-optics-dialogue.md', definition.reference, 'references/video-generation.md'];
    const files = new Map<string, SkillPackageFileContent>();
    for (const path of paths) {
        const content = await Bun.file(new URL('../../skill-packages/short-drama-editing/' + definition.slug + '/' + path, import.meta.url)).text();
        files.set(path, { file: { path, kind: 'markdown', mimeType: 'text/markdown', size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex') }, content, binary: false });
    }
    return { ...definition, files, skill: { skillId: definition.slug, skillName: definition.name, versionId: 'offline-' + definition.slug, version: '1.0.0', isAdded: true, status: 1 } as Skill };
}));
const offlineRuntime = () => createSkillRuntime({
    listFiles: async (id) => ({ files: [...(packages.find((p) => p.skill.skillId === id)?.files.values() || [])].map((f) => f.file) }),
    getFile: async (id, path) => ({ file: packages.find((p) => p.skill.skillId === id)?.files.get(path) || { file: { path, kind: 'markdown', mimeType: 'text/markdown', size: 7 }, content: '# Rules', binary: false } }),
});

const originalDirector = await Bun.file(new URL('../../skill-packages/short-drama-editing/chixie-rusong-plus-v2/references/director-optics-dialogue.md', import.meta.url)).text();
const originalVideo = await Bun.file(new URL('../../skill-packages/short-drama-editing/chixie-rusong-plus-v2/references/video-generation.md', import.meta.url)).text();
for (const pkg of packages) {
    test(pkg.slug + ': inherits the full 2.3 references within the worst-case budget', () => {
        expect(pkg.files.get('references/director-optics-dialogue.md')!.content).toBe(originalDirector);
        expect(pkg.files.get('references/video-generation.md')!.content).toContain(originalVideo.slice(originalVideo.indexOf('\n') + 1).trim());
        expect([...pkg.files.values()].reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(8000);
    });
    for (const [profile, count] of [['shortDrama', 5], ['canvas', 4]] as const) {
        test(pkg.slug + ': all required references reach ' + profile + ' at full skill capacity', async () => {
            const skills = [pkg.skill, ...Array.from({ length: count - 1 }, (_, i) => ({ ...pkg.skill, skillId: 'filler-' + i, skillName: 'filler-' + i }))];
            const loaded = await offlineRuntime().prepare({ profile, prompt: '第九章：林默说：“退后。”', skills, selectedSkillIds: skills.map((s) => s.skillId) });
            for (const path of ['SKILL.md', 'references/director-optics-dialogue.md', pkg.reference]) expect(loaded.prompt).toContain(pkg.files.get(path)!.content);
            expect(loaded.metadata.skillLoadReport?.find((r) => r.skillId === pkg.skill.skillId)).toMatchObject({ status: 'loaded', truncated: false });
        });
    }
    test(pkg.slug + ': video rules preserve the authored script', async () => {
        const prompt = '林默在门内原位，接前段落幅；没有新增台词。';
        const loaded = await offlineRuntime().prepare({ profile: 'shortDrama', purpose: 'video', prompt, skills: [pkg.skill], selectedSkillIds: [pkg.skill.skillId] });
        expect(loaded.prompt).toContain(prompt);
        expect(loaded.prompt).toContain(pkg.files.get('references/video-generation.md')!.content.trim());
        expect(loaded.metadata.skillLoadReport).toEqual([{ skillId: pkg.skill.skillId, skillName: pkg.name, version: '1.0.0', status: 'loaded', files: ['references/video-generation.md'], truncated: false }]);
    });
}

test('action and effects can both load at five-skill capacity without losing specialized rules', async () => {
    const skills = [...packages.map((p) => p.skill), ...Array.from({ length: 3 }, (_, i) => ({ ...packages[0]!.skill, skillId: 'filler-' + i, skillName: 'filler-' + i }))];
    const result = await offlineRuntime().prepare({ profile: 'shortDrama', prompt: '第九章', skills, selectedSkillIds: skills.map((s) => s.skillId) });
    for (const pkg of packages) {
        for (const path of ['SKILL.md', 'references/director-optics-dialogue.md', pkg.reference]) expect(result.prompt).toContain(pkg.files.get(path)!.content);
        expect(result.metadata.skillLoadReport?.find((r) => r.skillId === pkg.skill.skillId)).toMatchObject({ status: 'loaded', truncated: false });
    }
});

// Authored data tests transport and persistence, not a model's choreography quality.
const script = {
    setting: '空间锁定：林默在门内、对手在通道尽端，摄影机在交锋轴同侧；已有能量源照向石地。',
    shots: Array.from({ length: 12 }, (_, i) => ({ durationSeconds: i % 2 ? 3 : 2, camera: '同侧中景沿进路短移。', start: '接当前兵器与能量前缘相位。', performance: '林默沿已建立来向卸力，目光追随对手。', focusAndLight: '接触位置清晰；源点亮度随释放衰减，暗侧肤质仍可读。', end: '落幅保持当前持物及能量残留。', sound: i ? '同一声轨延续，余响衰减。' : '林默压低声音说：“退后。”' })),
    ending: '空间交接：林默仍在门内，持剑右手，烟尘在通道内衰减。',
};
const continuityOut = script.ending;
const completed = { id: 'offline-cinematic-masters', type: 'canvas_text', status: 'succeeded', prompt: '', attempts: 1, createdAt: '', updatedAt: '', resultJson: JSON.stringify({ rows: [{ shotNumber: 1, durationSeconds: 30, directorScript: script, dialogue: '林默：“退后。”', continuityOut, imageGenerationPrompt: script.setting, characters: [], assetBindings: [] }] }) } as GenerationTask;
for (const selected of [[packages[0]!], [packages[1]!], packages]) {
    test('actual chapter submission carries complete rules for ' + selected.map((p) => p.slug).join(' + '), async () => {
        const create = spyOn(taskApi, 'createGenerationTask').mockResolvedValue({ ...completed, status: 'queued', resultJson: undefined });
        const wait = spyOn(taskApi, 'waitForGenerationTask').mockResolvedValue(completed);
        const runtime = offlineRuntime();
        const prepare = spyOn(skillRuntime, 'prepare').mockImplementation((input) => runtime.prepare(input));
        try {
            await generateChapterStoryboard({ projectId: 'offline-project', chapterId: 'offline-chapter', chapterTitle: '交锋', sourceText: '林默说：“退后。”', projectStyle: { presetId: 'fantasy', title: '玄幻写实', prompt: '玄幻写实' }, characters: [], assets: [], config: { ...useConfigStore.getInitialState().config, model: 'offline-text', textModel: 'offline-text' }, skills: selected.map((p) => p.skill), selectedSkillIds: selected.map((p) => p.skill.skillId), storyboardMode: 'continuous_30s', dialogueConstraintMode: 'unrestricted', approvedRevision: 1, approvedShotIds: [] });
            expect(create).toHaveBeenCalledTimes(1);
            const submitted = create.mock.calls[0]![0];
            for (const pkg of selected) for (const path of ['SKILL.md', 'references/director-optics-dialogue.md', pkg.reference]) expect(submitted.prompt).toContain(pkg.files.get(path)!.content);
            expect(submitted.input?.metadata).toMatchObject({ skillIds: selected.map((p) => p.skill.skillId), storyboardExecution: 'planned-director-v1', storyboardPromptReview: { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000, directorFormat: 'shots-v1' } });
        } finally {
            prepare.mockRestore(); wait.mockRestore(); create.mockRestore();
        }
    });
}

test('all authored microshots and continuity survive parse, revision and final video prompt', () => {
    expect(reviewChapterDirectorTiming(script, 30, 4)).toEqual([]);
    const rows = storyboardRowsFromTask(completed).rows;
    const saved = storyboardRowsToProjectShots(rows);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.revision.continuityNotes).toBe(continuityOut);
    const final = buildWorkflowVideoPrompt(saved[0]!.revision, { assetReferences: [], mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [] }).prompt;
    expect(final.match(/镜头[0-9]+：/gu)).toHaveLength(12);
    for (const shot of script.shots) for (const field of ['camera', 'start', 'performance', 'focusAndLight', 'end', 'sound'] as const) expect(final).toContain(shot[field]);
    expect(final).toContain(script.ending);
});
