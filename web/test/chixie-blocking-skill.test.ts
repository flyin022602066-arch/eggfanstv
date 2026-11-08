import { expect, spyOn, test } from 'bun:test';
import { storyboardRowsFromTask } from '../src/lib/canvas/canvas-project-domain';
import { reviewChapterDirectorTiming } from '../src/lib/chapter-director-script';
import { storyboardRowsToProjectShots } from '../src/pages/projects/detail/chapter-storyboard-production';
import { buildWorkflowVideoPrompt } from '../src/pages/projects/detail/workflow-video-prompt';
import { createSkillRuntime, skillRuntime } from '../src/services/skill-runtime';
import { generateChapterStoryboard } from '../src/pages/projects/detail/project-chapter-ai';
import * as taskApi from '../src/services/api/task-center';
import { useConfigStore } from '../src/stores/use-config-store';
import type { Skill, SkillPackageFileContent } from '../src/services/api/skills';
import type { GenerationTask } from '../src/services/api/task-center';

const root = new URL('../../skill-packages/short-drama-editing/chixie-rusong-plus-v2-blocking/', import.meta.url);
const paths = ['SKILL.md', 'references/director-optics-dialogue.md', 'references/spatial-continuity.md', 'references/video-generation.md'];
const contents = new Map<string, SkillPackageFileContent>();
for (const path of paths) {
    const content = await Bun.file(new URL(path, root)).text();
    contents.set(path, { file: { path, kind: 'markdown', mimeType: 'text/markdown', size: new TextEncoder().encode(content).length, sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex') }, content, binary: false });
}
const skill = { skillId: 'offline-blocking', skillName: '持械入宋plus第二版·站位连续2.4', isAdded: true, status: 1, versionId: 'offline-v2', version: '2.4.1' } as Skill;
function runtime() {
    return createSkillRuntime({
        listFiles: async (id) => ({ files: id === skill.skillId ? [...contents.values()].map((item) => item.file) : [] }),
        getFile: async (id, path) => ({ file: id === skill.skillId ? contents.get(path)! : { file: { path, kind: 'markdown', mimeType: 'text/markdown', size: 7 }, content: '# Rules', binary: false } }),
    });
}

test('full directing reference is inherited byte for byte from the protected 2.3 source', async () => {
    const original = await Bun.file(new URL('../../skill-packages/short-drama-editing/chixie-rusong-plus-v2/references/director-optics-dialogue.md', import.meta.url)).arrayBuffer();
    const inherited = await Bun.file(new URL('references/director-optics-dialogue.md', root)).arrayBuffer();
    expect(new Uint8Array(inherited)).toEqual(new Uint8Array(original));
    expect([...contents.values()].reduce((n, item) => n + item.content.length, 0)).toBeLessThanOrEqual(8000);
});

test('video execution contains every original 2.3 rule paragraph before the spatial addition', async () => {
    const original = await Bun.file(new URL('../../skill-packages/short-drama-editing/chixie-rusong-plus-v2/references/video-generation.md', import.meta.url)).text();
    expect(contents.get('references/video-generation.md')!.content).toContain(original.slice(original.indexOf('\n') + 1).trim());
});

for (const [profile, count] of [['canvas', 4], ['shortDrama', 5]] as const) {
    test(`${profile} loads both required guides without truncation at its selection limit`, async () => {
        const others = Array.from({ length: count - 1 }, (_, i) => ({ ...skill, skillId: `other-${i}`, skillName: `other-${i}` }));
        const skills = [skill, ...others];
        const result = await runtime().prepare({ profile, prompt: '第七章：林默说：“等我回来。”', skills, selectedSkillIds: skills.map((s) => s.skillId) });
        expect(result.selectedSkills).toHaveLength(count);
        for (const path of ['SKILL.md', 'references/director-optics-dialogue.md', 'references/spatial-continuity.md']) expect(result.prompt).toContain(contents.get(path)!.content);
        expect(result.metadata.skillLoadReport?.find((r) => r.skillId === skill.skillId)).toMatchObject({ status: 'loaded', truncated: false });
    });
}

test('video execution carries the confirmed script unchanged and receives its own spatial rules', async () => {
    const prompt = '承接起幅：林默仍在左、柳青仍在右；同一摄影侧。镜头1：沿当前眼线微推。';
    const result = await runtime().prepare({ profile: 'shortDrama', purpose: 'video', prompt, skills: [skill], selectedSkillIds: [skill.skillId] });
    expect(result.prompt).toContain(prompt);
    expect(result.prompt).toContain(contents.get('references/video-generation.md')!.content.trim());
    expect(result.metadata.skillLoadReport).toEqual([{ skillId: skill.skillId, skillName: skill.skillName, version: '2.4.1', status: 'loaded', files: ['references/video-generation.md'], truncated: false }]);
});

test('a chapter using only the new skill submits both inherited and spatial rules to the actual task boundary', async () => {
    const sourceText = '林默说：“等我回来。”';
    const directorScript = { setting: '空间锁定：林默在桌左、柳青在桌右，摄影机在初始轴同侧。', shots: Array.from({ length: 12 }, (_, i) => ({ durationSeconds: i % 2 ? 3 : 2, camera: '同侧中近景微推。', start: '承接起幅：林默在左、柳青在右。', performance: '林默看向柳青的眼睛。', focusAndLight: '眼睛清晰，侧光塑出颧骨。', end: '接当前目光。', sound: i === 0 ? sourceText : '原声延续。' })), ending: '空间交接：林默仍在左、柳青仍在右。' };
    const completed = { id: 'offline-spatial-submit', type: 'canvas_text', status: 'succeeded', prompt: '', attempts: 1, createdAt: '', updatedAt: '', resultJson: JSON.stringify({ rows: [{ shotNumber: 1, durationSeconds: 30, directorScript, dialogue: sourceText, characters: [], assetBindings: [] }] }) } as GenerationTask;
    const create = spyOn(taskApi, 'createGenerationTask').mockResolvedValue({ ...completed, status: 'queued', resultJson: undefined });
    const wait = spyOn(taskApi, 'waitForGenerationTask').mockResolvedValue(completed);
    const offline = runtime();
    const prepare = spyOn(skillRuntime, 'prepare').mockImplementation((input) => offline.prepare(input));
    try {
        await generateChapterStoryboard({ projectId: 'offline-project', chapterId: 'offline-chapter', chapterTitle: '交接', sourceText, projectStyle: { presetId: 'historical', title: '历史写实', prompt: '历史写实' }, characters: [], assets: [], config: { ...useConfigStore.getInitialState().config, model: 'offline-text', textModel: 'offline-text' }, skills: [skill], selectedSkillIds: [skill.skillId], storyboardMode: 'continuous_30s', dialogueConstraintMode: 'unrestricted', approvedRevision: 1, approvedShotIds: [] });
        expect(create).toHaveBeenCalledTimes(1);
        const submitted = create.mock.calls[0]![0];
        for (const path of ['SKILL.md', 'references/director-optics-dialogue.md', 'references/spatial-continuity.md']) expect(submitted.prompt).toContain(contents.get(path)!.content);
        expect(submitted.input?.metadata).toMatchObject({ skillIds: [skill.skillId], storyboardExecution: 'planned-director-v1', storyboardPromptReview: { maxInternalShotSeconds: 4, minDirectorScriptChars: 1000, directorFormat: 'shots-v1' } });
        expect(submitted.prompt).toContain(sourceText);
        expect(submitted.prompt).toContain('【首次拆解：结构化逐镜详稿】');
    } finally {
        prepare.mockRestore(); wait.mockRestore(); create.mockRestore();
    }
});

const cases = [
    ['same scene', '林默画面左、柳青画面右，同在桌前原位；摄影机留在交谈轴南侧。'],
    ['offscreen listener', '林默近景在左；柳青出画仍在桌右原位，目光对画外林默；摄影机在轴南侧。'],
    ['visible crossing', '林默已沿镜内可见桌前路径绕过柳青，到桌右；柳青仍在桌左；摄影机在轴南侧。'],
    ['real transition', '原文明确转场至院内：林默在已建立院门内侧，柳青在他身后，重新建立轴线。'],
] as const;
for (const [name, state] of cases) {
    test(`${name}: authored handoff and first frame survive parsing, persistence and final prompt`, () => {
        const makeScript = (startState: string, endState: string) => ({
            setting: `空间锁定：${startState}`,
            shots: Array.from({ length: 12 }, (_, i) => ({ durationSeconds: i % 2 ? 3 : 2, camera: `同侧角度${i + 1}，随当前表演微推进，稳住眼线。`, start: i === 0 ? `承接起幅：${startState}` : '接当前目光与手势相位。', performance: '林默看向柳青的眼睛；柳青沿既定方向接收，不抢口型。', focusAndLight: '近侧眼睛清晰，背景锚点可辨；原光源塑出颧骨明暗转折。', end: i === 11 ? endState : '保持当前动作相位，沿反馈切角。', sound: i === 0 ? '林默低声说：“等我回来。”' : '沿用当前声轨与现场底噪，不重读。' })),
            ending: `空间交接：${endState}`,
        });
        const scripts = [makeScript('林默在左，柳青在右；桌前同侧。', state), makeScript(state, state)];
        scripts.forEach((script) => expect(reviewChapterDirectorTiming(script, 30, 4)).toEqual([]));
        const task = { id: 'offline-spatial', type: 'canvas_text', status: 'succeeded', prompt: '', attempts: 1, createdAt: '', updatedAt: '', resultJson: JSON.stringify({ rows: scripts.map((directorScript, i) => ({ shotNumber: i + 1, durationSeconds: 30, directorScript, imageGenerationPrompt: `承接起幅：${i ? state : '林默在左，柳青在右；桌前同侧。'}`, continuityOut: `空间交接：${state}`, characters: [], assetBindings: [], dialogue: '林默：“等我回来。”' })) }) } as GenerationTask;
        const rows = storyboardRowsFromTask(task).rows;
        const saved = storyboardRowsToProjectShots(rows);
        expect(saved).toHaveLength(2);
        expect(saved[0]!.revision.continuityNotes).toBe(`空间交接：${state}`);
        expect(saved[1]!.revision.imagePrompt).toBe(`承接起幅：${state}`);
        expect(rows[1]!.directorScript?.shots[0]!.start).toBe(`承接起幅：${state}`);
        const final = buildWorkflowVideoPrompt(saved[1]!.revision, { assetReferences: [], mentionReferences: [], referenceImages: [], referenceAudios: [], resolvedCharacterVersions: [], missingImageTitles: [] }).prompt;
        for (const text of [scripts[1]!.setting, scripts[1]!.shots[0]!.start, scripts[1]!.ending]) expect(final).toContain(text);
        expect(final.match(/镜头[0-9]+：/gu)).toHaveLength(12);
        expect(final).toContain('林默低声说：“等我回来。”');
    });
}
